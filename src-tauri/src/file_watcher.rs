use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::constants::FILE_WATCHER_EVENT;
use crate::utils::get_base_dir;

const DEBOUNCE_DURATION: Duration = Duration::from_millis(500);

// --- public event structures ---

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: String, // "modify" | "delete"
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWatcherEvent {
    pub file_changes: Vec<FileChange>,
    pub directory_changes: Vec<String>,
}

// --- internal state structures ---

#[derive(Default)]
struct FileEventState {
    first_kind: String,
    last_kind: String,
    has_rename_to: bool,
}

#[derive(Default)]
struct EventAccumulator {
    /// file events keyed by relative path
    files: HashMap<String, FileEventState>,
    /// directories from directory-level events (not file events)
    dir_events: HashSet<String>,
}

impl EventAccumulator {
    fn is_empty(&self) -> bool {
        self.files.is_empty() && self.dir_events.is_empty()
    }

    fn add_file_event(&mut self, path: String, kind: &str) {
        let state = self.files.entry(path).or_default();

        if state.first_kind.is_empty() {
            state.first_kind = kind.to_string();
        }
        state.last_kind = kind.to_string();
        if kind == "rename_to" {
            state.has_rename_to = true;
        }
    }

    fn add_dir_event(&mut self, dir: String) {
        self.dir_events.insert(dir);
    }

    fn collate(self) -> FileWatcherEvent {
        let (file_changes, file_dirs) = self.collate_file_events();

        // combine directories from file events and directory events
        let mut all_dirs: HashSet<String> = self.dir_events;
        all_dirs.extend(file_dirs);

        let directory_changes = Self::dedupe_directories(all_dirs);

        FileWatcherEvent {
            file_changes,
            directory_changes,
        }
    }

    /// returns (file_changes, directories_needing_refresh)
    fn collate_file_events(&self) -> (Vec<FileChange>, HashSet<String>) {
        let mut file_changes = Vec::new();
        let mut directories = HashSet::new();

        for (path, state) in &self.files {
            let parent = get_parent_dir(path);
            let existed_before = state.first_kind != "create";
            let exists_after = state.last_kind != "delete";

            match (existed_before, exists_after) {
                (false, false) => {
                    // born and died - no net effect
                }
                (false, true) => {
                    // new file appeared - directory refresh only
                    directories.insert(parent);
                }
                (true, false) => {
                    // file was removed - file change + directory refresh
                    file_changes.push(FileChange {
                        path: path.clone(),
                        kind: "delete".to_string(),
                    });
                    directories.insert(parent);
                }
                (true, true) => {
                    // file still exists - content change (atomic save or modify)
                    file_changes.push(FileChange {
                        path: path.clone(),
                        kind: "modify".to_string(),
                    });
                    // rename-to means the file may have arrived here via rename,
                    // so the directory structure may have changed
                    if state.has_rename_to {
                        directories.insert(parent);
                    }
                }
            }
        }

        (file_changes, directories)
    }

    fn dedupe_directories(dirs: HashSet<String>) -> Vec<String> {
        // sort by length (ancestors first)
        let mut sorted: Vec<_> = dirs.into_iter().collect();
        sorted.sort_by_key(|d| d.len());

        let mut result = Vec::new();
        for dir in sorted {
            let is_covered = result.iter().any(|ancestor: &String| {
                if ancestor.is_empty() {
                    // root covers everything
                    true
                } else {
                    dir.starts_with(ancestor) && dir.chars().nth(ancestor.len()) == Some('/')
                }
            });

            if !is_covered {
                result.push(dir);
            }
        }
        result
    }
}

// --- watcher implementation ---

pub fn init_file_watcher(app_handle: AppHandle) {
    let watch_path = match get_base_dir(&app_handle) {
        Ok(path) => path,
        Err(e) => {
            log::error!("failed to get base directory for file watcher: {e}");
            return;
        }
    };

    if !watch_path.exists() {
        log::warn!("watch path does not exist: {:?}", watch_path);
        return;
    }

    std::thread::spawn(move || {
        if let Err(e) = run_watcher(app_handle, watch_path) {
            log::error!("file watcher error: {e}");
        }
    });

    log::info!("file watcher initialized");
}

fn run_watcher(
    app_handle: AppHandle,
    watch_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel();

    let config = Config::default()
        .with_poll_interval(Duration::from_secs(5))
        .with_compare_contents(false);

    let mut watcher: RecommendedWatcher = Watcher::new(tx, config)?;
    watcher.watch(&watch_path, RecursiveMode::Recursive)?;

    log::info!("watching for file changes in: {:?}", watch_path);

    let mut accumulator = EventAccumulator::default();

    loop {
        let recv_result = if accumulator.is_empty() {
            // no pending events - wait indefinitely
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            // pending events - wait with timeout for debounce
            rx.recv_timeout(DEBOUNCE_DURATION)
        };

        match recv_result {
            Ok(Ok(event)) => {
                process_event(&watch_path, event, &mut accumulator);
            }
            Ok(Err(e)) => {
                log::error!("watch error: {e}");
            }
            Err(RecvTimeoutError::Timeout) => {
                // debounce period elapsed - flush accumulated events
                flush_events(&app_handle, &mut accumulator);
            }
            Err(RecvTimeoutError::Disconnected) => {
                log::error!("watcher channel disconnected");
                break;
            }
        }
    }

    Ok(())
}

fn process_event(base_path: &Path, event: Event, accumulator: &mut EventAccumulator) {
    use notify::event::{ModifyKind, RenameMode};
    use notify::EventKind;

    match event.kind {
        EventKind::Create(_) => {
            for path in &event.paths {
                process_path(base_path, path, "create", accumulator);
            }
        }
        EventKind::Modify(ModifyKind::Data(_)) => {
            for path in &event.paths {
                process_path(base_path, path, "modify", accumulator);
            }
        }
        EventKind::Remove(_) => {
            for path in &event.paths {
                process_path(base_path, path, "delete", accumulator);
            }
        }
        EventKind::Modify(ModifyKind::Name(mode)) => match mode {
            RenameMode::From => {
                // file left this path
                for path in &event.paths {
                    process_path(base_path, path, "delete", accumulator);
                }
            }
            RenameMode::To => {
                // file arrived at this path
                for path in &event.paths {
                    process_path(base_path, path, "rename_to", accumulator);
                }
            }
            RenameMode::Both => {
                // paths[0] = source (left), paths[1] = target (arrived)
                if let Some(from) = event.paths.first() {
                    process_path(base_path, from, "delete", accumulator);
                }
                if let Some(to) = event.paths.get(1) {
                    process_path(base_path, to, "rename_to", accumulator);
                }
            }
            _ => {
                // RenameMode::Any / Other: infer direction from file existence.
                // on macOS, FSEvents can't determine rename direction, so we
                // check whether the file currently exists at the path.
                for path in &event.paths {
                    let kind = if path.exists() { "rename_to" } else { "delete" };
                    process_path(base_path, path, kind, accumulator);
                }
            }
        },
        _ => {} // ignore access, metadata, permissions, etc.
    }
}

fn process_path(base_path: &Path, path: &Path, kind: &str, accumulator: &mut EventAccumulator) {
    let relative_path = match path.strip_prefix(base_path) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return,
    };

    // skip hidden files and folders (any path component starting with .)
    if relative_path
        .split('/')
        .any(|segment| segment.starts_with('.'))
    {
        return;
    }

    if path.is_dir() {
        // directory event - add parent to directory_changes
        let parent = get_parent_dir(&relative_path);
        accumulator.add_dir_event(parent);
        log::debug!("directory {kind}: {relative_path}");
    } else if path.extension().is_some_and(|ext| ext == "md") {
        // .md file event - track for collation (directory changes determined after)
        accumulator.add_file_event(relative_path.clone(), kind);
        log::debug!("file {kind}: {relative_path}");
    }
}

fn flush_events(app_handle: &AppHandle, accumulator: &mut EventAccumulator) {
    let acc = std::mem::take(accumulator);
    let event = acc.collate();

    // skip if nothing to emit
    if event.file_changes.is_empty() && event.directory_changes.is_empty() {
        return;
    }

    log::info!(
        "emitting file watcher event: {} file changes, {} directory changes",
        event.file_changes.len(),
        event.directory_changes.len()
    );

    for change in &event.file_changes {
        log::info!("file {}: {}", change.kind, change.path);
    }
    for dir in &event.directory_changes {
        log::info!(
            "dir refresh: {}",
            if dir.is_empty() { "(root)" } else { dir }
        );
    }

    if let Err(e) = app_handle.emit(FILE_WATCHER_EVENT, event) {
        log::error!("failed to emit file watcher event: {e}");
    }
}

fn get_parent_dir(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}
