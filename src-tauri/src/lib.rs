use tauri::menu::{Menu, MenuId, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

mod command;
mod constants;
mod file_watcher;
mod nb;
mod utils;

use constants::WORKSPACE_WINDOW_LABEL_PREFIX;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level_for("notify", log::LevelFilter::Warn)
                .build(),
        )
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            command::set_traffic_lights_visible,
            command::create_workspace_window,
            command::create_dir,
            command::list_dir,
            command::delete_dir,
            command::rename_dir,
            command::create_file,
            command::read_file,
            command::update_file,
            command::delete_file,
            command::rename_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } => {
                log::info!("exit requested, quitting");
            }
            RunEvent::MenuEvent(menu_event) => {
                let menu_id = menu_event.id();

                if menu_id == &MenuId::new(QUIT_MENU_ID) {
                    log::info!("quit menu clicked, exiting");
                    app_handle.exit(0);
                } else if menu_id == &MenuId::new(NEW_WINDOW_MENU_ID) {
                    log::info!("new window menu clicked");
                    let _ = command::create_workspace_window(app_handle.clone());
                } else if menu_id == &MenuId::new(CLOSE_WINDOW_MENU_ID) {
                    log::info!("close window menu clicked");
                    if let Some(window) = app_handle.get_focused_window() {
                        let _ = window.close();
                    }
                }
            }
            RunEvent::Reopen { .. } => {
                log::info!("app reopen event received");
                command::show_or_create_workspace_window(app_handle);
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } => {
                // when a workspace window is destroyed, check if we need to hide from dock
                if label.starts_with(WORKSPACE_WINDOW_LABEL_PREFIX) {
                    log::info!("workspace window destroyed: {label}");
                    command::update_activation_policy_for_workspace(app_handle);
                }
            }
            _ => {}
        });
}

const QUIT_MENU_ID: &str = "quit";
const NEW_WINDOW_MENU_ID: &str = "new-window";
const CLOSE_WINDOW_MENU_ID: &str = "close-window";

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

    // create initial workspace window
    let _ = command::create_workspace_window(app.handle().clone());
    log::info!("opened workspace window on start");

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
    let new_window_item = MenuItem::with_id(
        handle,
        NEW_WINDOW_MENU_ID,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let close_window_item = MenuItem::with_id(
        handle,
        CLOSE_WINDOW_MENU_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+W"),
    )?;

    let file_submenu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &new_window_item,
            &PredefinedMenuItem::separator(handle)?,
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
