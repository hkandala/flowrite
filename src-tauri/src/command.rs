#![allow(deprecated)]

use cocoa::base::{id, BOOL, YES};
use objc::{msg_send, sel, sel_impl};
use serde::Serialize;
use tauri::{
    utils::config::WindowEffectsConfig,
    window::{Effect, EffectState},
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::fs;

use crate::{
    constants::{
        WORKSPACE_WINDOW_HEIGHT, WORKSPACE_WINDOW_LABEL_PREFIX, WORKSPACE_WINDOW_MIN_HEIGHT,
        WORKSPACE_WINDOW_MIN_WIDTH, WORKSPACE_WINDOW_WIDTH,
    },
    nb,
    utils::resolve_path,
    PendingFiles,
};

#[derive(Serialize)]
pub struct FSEntry {
    // relative path from base directory
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub created_time_ms: u64,
    pub modified_time_ms: u64,
}

// -----------------------------------------
// traffic lights
// -----------------------------------------

#[allow(deprecated)]
#[tauri::command]
pub fn set_traffic_lights_visible(window: WebviewWindow, visible: bool) {
    let Ok(ns_win) = window.ns_window() else {
        return;
    };
    let ns_window: id = ns_win as _;
    let hidden: BOOL = if visible { cocoa::base::NO } else { YES };

    unsafe {
        for i in 0..3usize {
            let button: id = msg_send![ns_window, standardWindowButton: i];
            if !button.is_null() {
                let _: () = msg_send![button, setHidden: hidden];
            }
        }
    }
}

// -----------------------------------------
// workspace window commands
// -----------------------------------------

/// creates a new workspace window with a unique label
#[tauri::command]
pub fn create_workspace_window(app_handle: AppHandle) -> Result<String, String> {
    let label = generate_workspace_label();
    log::info!("creating workspace window: {label}");

    WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("#/workspace".into()))
        .title("flowrite")
        .inner_size(WORKSPACE_WINDOW_WIDTH, WORKSPACE_WINDOW_HEIGHT)
        .min_inner_size(WORKSPACE_WINDOW_MIN_WIDTH, WORKSPACE_WINDOW_MIN_HEIGHT)
        .center()
        .resizable(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .transparent(true)
        .disable_drag_drop_handler() // disable native drag and drop to allow HTML5 dnd (dockview)
        .effects(WindowEffectsConfig {
            effects: vec![Effect::HudWindow],
            state: Some(EffectState::FollowsWindowActiveState),
            radius: Some(20.0),
            color: None,
        })
        .build()
        .map_err(|e| format!("failed to create workspace window: {e}"))?;

    log::info!("created workspace window: {label}");

    Ok(label)
}

/// generates a unique workspace window label using timestamp
fn generate_workspace_label() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{}-{}", WORKSPACE_WINDOW_LABEL_PREFIX, timestamp)
}

/// shows an existing workspace window or creates a new one if none exist
pub fn show_or_create_workspace_window(app_handle: &AppHandle) {
    // find any existing workspace window
    let existing_workspace = app_handle
        .webview_windows()
        .into_iter()
        .find(|(label, _)| label.starts_with(WORKSPACE_WINDOW_LABEL_PREFIX));

    if let Some((label, window)) = existing_workspace {
        log::info!("showing existing workspace window: {label}");
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        // no workspace window exists, create one
        let _ = create_workspace_window(app_handle.clone());
    }
}

/// drains and returns any file paths buffered from macOS file association
/// open events that arrived before the frontend was ready
#[tauri::command]
pub fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

// -----------------------------------------
// file management commands
// -----------------------------------------

#[tauri::command]
pub async fn create_dir(app_handle: AppHandle, path: String) -> Result<(), String> {
    log::info!("creating directory: {path}");

    let dir_path = resolve_path(&app_handle, &path)?;

    fs::create_dir_all(&dir_path)
        .await
        .map_err(|e| format!("failed to create directory '{path}': {e}"))?;

    log::info!("created directory: {path}");

    Ok(())
}

#[tauri::command]
pub async fn list_dir(
    app_handle: AppHandle,
    path: String,
    recursive: Option<bool>,
) -> Result<Vec<FSEntry>, String> {
    let recursive = recursive.unwrap_or(false);
    log::info!("listing directory: {path} (recursive: {recursive})");

    let dir_path = resolve_path(&app_handle, &path)?;

    if !dir_path.exists() {
        return Err(format!("directory '{path}' does not exist"));
    }

    let mut files = Vec::new();
    list_dir_inner(&dir_path, &path, recursive, &mut files).await?;

    log::info!("listed {} entries in '{path}'", files.len());

    Ok(files)
}

/// internal recursive directory listing helper
async fn list_dir_inner(
    dir_path: &std::path::Path,
    relative_prefix: &str,
    recursive: bool,
    files: &mut Vec<FSEntry>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(dir_path)
        .await
        .map_err(|e| format!("failed to read directory '{}': {e}", relative_prefix))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("failed to read directory entry: {e}"))?
    {
        let entry_path = entry.path();
        if let Some(name) = entry_path.file_name().and_then(|s| s.to_str()) {
            // skip hidden files/directories (starting with .)
            if name.starts_with('.') {
                continue;
            }

            let metadata = fs::metadata(&entry_path)
                .await
                .map_err(|e| format!("failed to read metadata for '{name}': {e}"))?;

            let is_dir = metadata.is_dir();

            // skip non-.md files (only show markdown files and directories)
            if !is_dir && !name.ends_with(".md") {
                continue;
            }

            let size_bytes = metadata.len();

            let created = metadata
                .created()
                .map_err(|e| format!("failed to get creation time for '{name}': {e}"))?;
            let created_time_ms = created
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| format!("failed to convert creation time for '{name}': {e}"))?
                .as_millis() as u64;

            let modified = metadata
                .modified()
                .map_err(|e| format!("failed to get modification time for '{name}': {e}"))?;
            let modified_time_ms = modified
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| format!("failed to convert modification time for '{name}': {e}"))?
                .as_millis() as u64;

            // construct full relative path
            let entry_relative_path = if relative_prefix.is_empty() {
                name.to_string()
            } else {
                format!("{}/{}", relative_prefix, name)
            };

            files.push(FSEntry {
                path: entry_relative_path.clone(),
                is_dir,
                size_bytes,
                created_time_ms,
                modified_time_ms,
            });

            // recurse into subdirectories if recursive flag is set
            if recursive && is_dir {
                Box::pin(list_dir_inner(
                    &entry_path,
                    &entry_relative_path,
                    true,
                    files,
                ))
                .await?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_dir(app_handle: AppHandle, path: String) -> Result<(), String> {
    log::info!("deleting directory: {path}");

    nb::delete(&app_handle, &path).await?;

    log::info!("deleted directory: {path}");

    Ok(())
}

#[tauri::command]
pub async fn rename_dir(
    app_handle: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    log::info!("renaming directory: {old_path} -> {new_path}");

    nb::rename(&app_handle, &old_path, &new_path).await?;

    log::info!("renamed directory: {old_path} -> {new_path}");

    Ok(())
}

#[tauri::command]
pub async fn create_file(
    app_handle: AppHandle,
    path: String,
    content: Option<String>,
) -> Result<FSEntry, String> {
    log::info!("creating file: {path}");

    let file_path = resolve_path(&app_handle, &path)?;

    // check if file already exists
    if file_path.exists() {
        return Err(format!("file '{path}' already exists"));
    }

    let initial_content = content.unwrap_or_default();
    nb::create_file(&app_handle, &path, &initial_content).await?;

    // get metadata from filesystem
    let metadata = fs::metadata(&file_path)
        .await
        .map_err(|e| format!("failed to get metadata: {e}"))?;

    let created = metadata
        .created()
        .map_err(|e| format!("failed to get creation time: {e}"))?;
    let created_time_ms = created
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("failed to convert creation time: {e}"))?
        .as_millis() as u64;

    let modified = metadata
        .modified()
        .map_err(|e| format!("failed to get modification time: {e}"))?;
    let modified_time_ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("failed to convert modification time: {e}"))?
        .as_millis() as u64;

    log::info!("created file: {path}");

    Ok(FSEntry {
        path,
        is_dir: false,
        size_bytes: 0,
        created_time_ms,
        modified_time_ms,
    })
}

#[tauri::command]
pub async fn read_file(app_handle: AppHandle, path: String) -> Result<String, String> {
    log::info!("reading file: {path}");

    let content = nb::read_file(&app_handle, &path).await?;

    log::info!("read file: {path}");

    Ok(content)
}

#[tauri::command]
pub async fn update_file(
    app_handle: AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    log::info!("updating file: {path}");

    nb::update_file(&app_handle, &path, &content).await?;

    log::info!("updated file: {path}");

    Ok(())
}

#[tauri::command]
pub async fn delete_file(app_handle: AppHandle, path: String) -> Result<(), String> {
    log::info!("deleting file: {path}");

    nb::delete(&app_handle, &path).await?;

    log::info!("deleted file: {path}");

    Ok(())
}

#[tauri::command]
pub async fn rename_file(
    app_handle: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    log::info!("renaming file: {old_path} -> {new_path}");

    nb::rename(&app_handle, &old_path, &new_path).await?;

    log::info!("renamed file: {old_path} -> {new_path}");

    Ok(())
}

// -----------------------------------------
// metadata-only file update (no git checkpoint)
// -----------------------------------------

/// Writes only the YAML frontmatter section of an internal file.
/// Reads the file, replaces (or prepends) the `---` delimited YAML header,
/// and writes back without triggering a git checkpoint.
#[tauri::command]
pub async fn write_file_metadata(
    app_handle: AppHandle,
    path: String,
    yaml: String,
) -> Result<(), String> {
    let file_path = resolve_path(&app_handle, &path)?;
    let content = fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("failed to read {path}: {e}"))?;

    let trimmed_yaml = yaml.trim();

    let new_content = if content.starts_with("---\n") {
        // find closing --- delimiter and replace everything between
        if let Some(end) = content[4..].find("\n---\n") {
            format!("---\n{}\n---\n{}", trimmed_yaml, &content[4 + end + 5..])
        } else if let Some(end) = content[4..].find("\n---") {
            // closing --- at end of file (no trailing newline after ---)
            let after = &content[4 + end + 4..];
            if after.is_empty() {
                format!("---\n{}\n---\n", trimmed_yaml)
            } else {
                format!("---\n{}\n---\n{}", trimmed_yaml, after)
            }
        } else {
            format!("---\n{}\n---\n{}", trimmed_yaml, &content[4..])
        }
    } else {
        format!("---\n{}\n---\n{}", trimmed_yaml, content)
    };

    fs::write(&file_path, new_content)
        .await
        .map_err(|e| format!("failed to write {path}: {e}"))?;
    Ok(())
}

// -----------------------------------------
// external file commands (files outside ~/flowrite/)
// -----------------------------------------

#[tauri::command]
pub async fn create_external_file(path: String, content: Option<String>) -> Result<(), String> {
    log::info!("creating external file: {path}");

    let file_path = std::path::Path::new(&path);

    // create parent dirs if needed
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create parent directories for '{path}': {e}"))?;
    }

    let initial_content = content.unwrap_or_default();
    fs::write(&path, initial_content)
        .await
        .map_err(|e| format!("failed to create external file '{path}': {e}"))?;

    log::info!("created external file: {path}");

    Ok(())
}

#[tauri::command]
pub async fn read_external_file(path: String) -> Result<String, String> {
    log::info!("reading external file: {path}");

    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("failed to read external file '{path}': {e}"))?;

    log::info!("read external file: {path}");

    Ok(content)
}

#[tauri::command]
pub async fn update_external_file(path: String, content: String) -> Result<(), String> {
    log::info!("updating external file: {path}");

    fs::write(&path, content)
        .await
        .map_err(|e| format!("failed to update external file '{path}': {e}"))?;

    log::info!("updated external file: {path}");

    Ok(())
}

#[tauri::command]
pub async fn delete_external_file(path: String) -> Result<(), String> {
    log::info!("deleting external file (to trash): {path}");

    let path_clone = path.clone();
    tokio::task::spawn_blocking(move || {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(&path_clone)
    })
    .await
    .map_err(|e| format!("failed to trash external file '{path}': {e}"))?
    .map_err(|e| format!("failed to trash external file '{path}': {e}"))?;

    log::info!("deleted external file (to trash): {path}");

    Ok(())
}

#[tauri::command]
pub async fn rename_external_file(old_path: String, new_path: String) -> Result<(), String> {
    log::info!("renaming external file: {old_path} -> {new_path}");

    fs::rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("failed to rename external file '{old_path}' to '{new_path}': {e}"))?;

    log::info!("renamed external file: {old_path} -> {new_path}");

    Ok(())
}
