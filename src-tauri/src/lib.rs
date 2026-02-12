use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use tauri::menu::{Menu, MenuId, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Listener, Manager, RunEvent};

/// Flag to break the quit → ExitRequested → emit loop.
/// Set to `true` once the frontend confirms quit, so the second
/// ExitRequested (triggered by `app.exit(0)`) is allowed through.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

/// Tracks whether the initial workspace window has been created.
/// Prevents duplicate windows when the app is launched via file association,
/// where both RunEvent::Opened and RunEvent::MainEventsCleared could race.
static INITIAL_WINDOW_CREATED: AtomicBool = AtomicBool::new(false);

/// Stores file paths received via macOS file association open events
/// before the frontend is ready to handle them (cold launch).
pub(crate) struct PendingFiles(pub Mutex<Vec<String>>);

mod acp;
mod command;
mod constants;
mod file_watcher;
mod nb;
mod utils;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level_for("notify", log::LevelFilter::Warn)
                .build(),
        )
        .manage(acp::AcpState::default())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            command::set_traffic_lights_visible,
            command::create_workspace_window,
            command::take_pending_files,
            command::create_dir,
            command::list_dir,
            command::delete_dir,
            command::rename_dir,
            command::create_file,
            command::read_file,
            command::update_file,
            command::delete_file,
            command::rename_file,
            command::write_file_metadata,
            command::create_external_file,
            command::read_external_file,
            command::update_external_file,
            command::delete_external_file,
            command::rename_external_file,
            acp::acp_connect,
            acp::acp_new_session,
            acp::acp_prompt,
            acp::acp_respond_permission,
            acp::acp_cancel,
            acp::acp_set_mode,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                if QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    log::info!("quit confirmed, allowing exit");
                } else {
                    api.prevent_exit();
                    log::info!("exit requested, asking frontend for confirmation");
                    let _ = app_handle.emit("request-quit", ());
                }
            }
            RunEvent::MenuEvent(menu_event) => {
                let menu_id = menu_event.id();

                if menu_id == &MenuId::new(QUIT_MENU_ID) {
                    log::info!("quit menu clicked, requesting confirmation from frontend");
                    let _ = app_handle.emit("request-quit", ());
                } else if menu_id == &MenuId::new(NEW_WINDOW_MENU_ID) {
                    log::info!("new window menu clicked");
                    let _ = command::create_workspace_window(app_handle.clone());
                } else if menu_id == &MenuId::new(CLOSE_WINDOW_MENU_ID) {
                    log::info!("close window menu clicked");
                    if let Some(window) = app_handle.get_focused_window() {
                        let _ = window.close();
                    }
                } else if let Some(window) = app_handle.get_focused_window() {
                    // forward remaining menu clicks to the frontend
                    let event_name = format!("menu-{}", menu_id.0);
                    log::info!("{} menu clicked", menu_id.0);
                    let _ = window.emit(&event_name, ());
                }
            }
            RunEvent::Reopen { .. } => {
                log::info!("app reopen event received");
                INITIAL_WINDOW_CREATED.store(true, Ordering::SeqCst);
                command::show_or_create_workspace_window(app_handle);
            }
            RunEvent::Opened { urls } => {
                log::info!("app opened with {} URL(s)", urls.len());

                // mark that we received an open event (prevents default window in MainEventsCleared)
                INITIAL_WINDOW_CREATED.store(true, Ordering::SeqCst);

                // ensure a workspace window exists
                command::show_or_create_workspace_window(app_handle);

                // collect file paths from URLs
                let mut paths = Vec::new();
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path_str) = path.to_str() {
                            log::info!("opening file from OS: {}", path_str);
                            paths.push(path_str.to_string());
                        }
                    }
                }

                // always buffer for frontend pickup on mount (cold launch safety net —
                // the event below may fire before the frontend listener is registered)
                if let Some(state) = app_handle.try_state::<PendingFiles>() {
                    log::info!("buffering {} file(s) for frontend pickup", paths.len());
                    state.0.lock().unwrap().extend(paths.clone());
                }

                // also try emitting directly to the focused window for immediate
                // handling when the frontend is already loaded (warm case).
                // uses emit_to so only the targeted window opens the file.
                if let Some(window) = app_handle.get_focused_window() {
                    let target = window.label().to_string();
                    for path in &paths {
                        let _ = app_handle.emit_to(&target, "open-file-from-os", path.clone());
                    }
                }
            }
            RunEvent::MainEventsCleared => {
                // on the first event loop iteration, create a default workspace window
                // if no Opened/Reopen event has already created one (normal app launch)
                if INITIAL_WINDOW_CREATED
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    command::show_or_create_workspace_window(app_handle);
                    log::info!("opened workspace window on start");
                }
            }
            _ => {}
        });
}

const QUIT_MENU_ID: &str = "quit";
const NEW_WINDOW_MENU_ID: &str = "new-window";
const CLOSE_WINDOW_MENU_ID: &str = "close-window";
const CLOSE_EDITOR_MENU_ID: &str = "close-editor";
const SAVE_MENU_ID: &str = "save";
const SAVE_ALL_MENU_ID: &str = "save-all";
const NEW_FILE_MENU_ID: &str = "new-file";
const OPEN_FILE_MENU_ID: &str = "open-file";

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // create custom menu
    setup_app_menu(app)?;

    // initialize default directories (blocking - must succeed before app starts)
    let init_handle = app.handle().clone();
    tauri::async_runtime::block_on(async move {
        nb::init_nb(&init_handle).await?;
        Ok::<(), Box<dyn std::error::Error>>(())
    })?;

    // initialize file watcher
    file_watcher::init_file_watcher(app.handle().clone());

    // listen for quit confirmation from frontend
    let quit_handle = app.handle().clone();
    app.listen("confirm-quit", move |_event| {
        log::info!("quit confirmed by frontend, exiting");
        QUIT_CONFIRMED.store(true, Ordering::SeqCst);
        quit_handle.exit(0);
    });

    // NOTE: Window creation is deferred to the run event loop (MainEventsCleared)
    // to avoid duplicate windows when the app is launched via file association.
    // On file association launch, macOS may fire both Opened and Reopen events,
    // which would race with a window created here.

    Ok(())
}

/// create custom app menu
fn setup_app_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();

    // create custom quit menu item
    let quit_item = MenuItem::with_id(
        handle,
        QUIT_MENU_ID,
        "Quit flowrite",
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    // create app submenu with standard items + custom quit
    let app_submenu = Submenu::with_items(
        handle,
        "flowrite",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some("About flowrite"), None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, Some("Hide flowrite"))?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &quit_item,
        ],
    )?;

    // create file submenu
    // NOTE: shortcuts for New File, Open, Save, Save All, and Close Editor
    // are handled in the frontend keydown handler (not as native accelerators)
    // so that key-repeat is properly suppressed via `e.repeat`.
    let new_file_item =
        MenuItem::with_id(handle, NEW_FILE_MENU_ID, "New File", true, None::<&str>)?;
    let new_window_item = MenuItem::with_id(
        handle,
        NEW_WINDOW_MENU_ID,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let open_file_item = MenuItem::with_id(
        handle,
        OPEN_FILE_MENU_ID,
        "Open File...",
        true,
        None::<&str>,
    )?;
    let save_item = MenuItem::with_id(handle, SAVE_MENU_ID, "Save", true, None::<&str>)?;
    let save_all_item =
        MenuItem::with_id(handle, SAVE_ALL_MENU_ID, "Save All", true, None::<&str>)?;
    let close_editor_item = MenuItem::with_id(
        handle,
        CLOSE_EDITOR_MENU_ID,
        "Close Editor",
        true,
        None::<&str>,
    )?;
    let close_window_item = MenuItem::with_id(
        handle,
        CLOSE_WINDOW_MENU_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;

    let file_submenu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &new_file_item,
            &new_window_item,
            &PredefinedMenuItem::separator(handle)?,
            &open_file_item,
            &PredefinedMenuItem::separator(handle)?,
            &save_item,
            &save_all_item,
            &PredefinedMenuItem::separator(handle)?,
            &close_editor_item,
            &close_window_item,
        ],
    )?;

    // create edit submenu for standard text editing shortcuts
    let edit_submenu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    // create window submenu
    let window_submenu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
        ],
    )?;

    // build and set the menu
    let menu = Menu::with_items(
        handle,
        &[&app_submenu, &file_submenu, &edit_submenu, &window_submenu],
    )?;
    app.set_menu(menu)?;

    log::info!("custom app menu created");

    Ok(())
}
