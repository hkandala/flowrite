use std::collections::HashMap;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::fs;

use crate::constants::{NB_DATA_DIR_NAME, NB_RC_FILE_NAME};
use crate::utils::get_base_dir;

/// version of nb to download and use
const NB_VERSION: &str = "7.14.4";

/// binary name for the nb executable
const NB_BINARY_NAME: &str = "fwnb";

// -----------------------------------------
// nb binary management
// -----------------------------------------

/// returns the path where the nb binary should be stored
fn get_nb_binary_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data directory: {e}"))?;
    Ok(app_data.join("bin").join(NB_BINARY_NAME))
}

/// returns the nb data directory path (~/.fwnb)
fn get_nb_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = app_handle
        .path()
        .home_dir()
        .map_err(|e| format!("failed to get home directory: {e}"))?;
    Ok(home_dir.join(NB_DATA_DIR_NAME))
}

/// returns the nbrc config file path (~/.fwnbrc)
fn get_nbrc_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = app_handle
        .path()
        .home_dir()
        .map_err(|e| format!("failed to get home directory: {e}"))?;
    Ok(home_dir.join(NB_RC_FILE_NAME))
}

/// returns environment variables needed for nb execution
fn get_nb_env(app_handle: &AppHandle) -> Result<HashMap<String, String>, String> {
    let nb_data_dir = get_nb_data_dir(app_handle)?;
    let nb_data_dir_str = nb_data_dir
        .to_str()
        .ok_or("nb data directory path contains invalid UTF-8")?;

    let nbrc_path = get_nbrc_path(app_handle)?;
    let nbrc_path_str = nbrc_path
        .to_str()
        .ok_or("nbrc path contains invalid UTF-8")?;

    let mut env = HashMap::new();
    // use separate hidden directory for nb's internal data (home notebook, etc.)
    env.insert("NB_DIR".to_string(), nb_data_dir_str.to_string());
    // use separate hidden config file
    env.insert("NBRC_PATH".to_string(), nbrc_path_str.to_string());
    env.insert("NB_AUTO_SYNC".to_string(), "0".to_string());
    env.insert("NB_LIMIT".to_string(), "99999".to_string());
    env.insert("NB_DEFAULT_EXTENSION".to_string(), "md".to_string());
    env.insert("EDITOR".to_string(), "cat".to_string());
    // disable color output for easier parsing
    env.insert("NB_COLOR_PRIMARY".to_string(), "".to_string());
    env.insert("NB_COLOR_SECONDARY".to_string(), "".to_string());

    Ok(env)
}

/// get the installed version of nb
async fn get_installed_version(app_handle: &AppHandle) -> Option<String> {
    let binary_path = get_nb_binary_path(app_handle).ok()?;
    if !binary_path.exists() {
        return None;
    }

    let env = get_nb_env(app_handle).ok()?;
    let output = app_handle
        .shell()
        .command(&binary_path)
        .args(["version"])
        .envs(env)
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let version_output = String::from_utf8_lossy(&output.stdout);
        // nb version output format: "nb version X.X.X"
        version_output
            .split_whitespace()
            .last()
            .map(|s| s.to_string())
    } else {
        None
    }
}

/// ensure nb is installed with correct version, downloading if necessary
pub async fn ensure_nb_installed(app_handle: &AppHandle) -> Result<(), String> {
    let binary_path = get_nb_binary_path(app_handle)?;

    // check if binary exists and has correct version
    if binary_path.exists() {
        if let Some(installed_version) = get_installed_version(app_handle).await {
            if installed_version == NB_VERSION {
                log::info!("fwnb {} already installed", NB_VERSION);
                return Ok(());
            }
            log::info!(
                "fwnb version mismatch: installed={}, required={}. reinstalling...",
                installed_version,
                NB_VERSION
            );
            // delete existing binary
            fs::remove_file(&binary_path)
                .await
                .map_err(|e| format!("failed to remove old fwnb binary: {e}"))?;
        } else {
            log::warn!("could not determine installed fwnb version, reinstalling...");
            fs::remove_file(&binary_path)
                .await
                .map_err(|e| format!("failed to remove fwnb binary: {e}"))?;
        }
    }

    log::info!("downloading fwnb {}...", NB_VERSION);

    // ensure parent directory exists
    if let Some(parent) = binary_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create bin directory: {e}"))?;
    }

    // download nb using curl
    let download_url = format!(
        "https://raw.githubusercontent.com/xwmx/nb/{}/nb",
        NB_VERSION
    );

    let binary_path_str = binary_path
        .to_str()
        .ok_or("binary path contains invalid UTF-8")?;

    let output = app_handle
        .shell()
        .command("curl")
        .args(["-fsSL", "-o", binary_path_str, &download_url])
        .output()
        .await
        .map_err(|e| format!("failed to download fwnb: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("failed to download fwnb: {stderr}"));
    }

    log::info!("fwnb downloaded successfully");

    // make executable
    let output = app_handle
        .shell()
        .command("chmod")
        .args(["+x", binary_path_str])
        .output()
        .await
        .map_err(|e| format!("failed to set executable permission: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("failed to set executable permission: {stderr}"));
    }

    // verify installation
    let env = get_nb_env(app_handle)?;
    let output = app_handle
        .shell()
        .command(&binary_path)
        .args(["version"])
        .envs(env)
        .output()
        .await
        .map_err(|e| format!("failed to verify fwnb installation: {e}"))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout);
        log::info!("fwnb installed successfully: {}", version.trim());
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("fwnb verification failed: {stderr}"))
    }
}

// -----------------------------------------
// internal command execution
// -----------------------------------------

/// run an nb command with the given arguments (internal use only)
/// commands are run from within the local notebook directory (~/flowrite)
async fn run_nb_command(app_handle: &AppHandle, args: &[&str]) -> Result<String, String> {
    let fwnb = get_nb_binary_path(app_handle)?;
    let env = get_nb_env(app_handle)?;
    let base_dir = get_base_dir(app_handle)?;

    log::debug!("running fwnb command: {:?}", args);

    let output = app_handle
        .shell()
        .command(&fwnb)
        .args(args)
        .envs(env)
        .current_dir(&base_dir)
        .output()
        .await
        .map_err(|e| format!("fwnb not available: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        log::debug!("fwnb command succeeded");
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        log::error!("fwnb command failed: {}", stderr.trim());
        Err(stderr)
    }
}

// -----------------------------------------
// high-level nb operations
// -----------------------------------------

/// initialize the current directory as a local nb notebook
pub async fn init_notebook(app_handle: &AppHandle) -> Result<(), String> {
    run_nb_command(app_handle, &["notebooks", "init", "-y"]).await?;
    Ok(())
}

/// reconcile nb index to catch external file changes (adds/removes entries in .index)
pub async fn reconcile_index(app_handle: &AppHandle) -> Result<(), String> {
    run_nb_command(app_handle, &["index", "reconcile", "-y"]).await?;
    Ok(())
}

/// git checkpoint: stage all changes and commit with message
/// message format follows nb convention: "[nb] Action: path"
pub async fn git_checkpoint(app_handle: &AppHandle, message: &str) -> Result<(), String> {
    run_nb_command(app_handle, &["git", "checkpoint", message]).await?;
    Ok(())
}

/// create a new note file with initial content
/// uses direct fs write because nb's --content flag can't handle long markdown
pub async fn create_file(app_handle: &AppHandle, path: &str, content: &str) -> Result<(), String> {
    let base_dir = get_base_dir(app_handle)?;
    let file_path = base_dir.join(path);

    // ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create parent directory: {e}"))?;
    }

    // write file with initial content
    fs::write(&file_path, content)
        .await
        .map_err(|e| format!("failed to create file {}: {e}", path))?;

    // reconcile nb index to track the new file (adds to .index)
    reconcile_index(app_handle).await?;

    // git checkpoint to commit the new file
    git_checkpoint(app_handle, &format!("[nb] Add: {}", path)).await?;

    Ok(())
}

/// read a note file, returning raw content (direct filesystem read for speed)
pub async fn read_file(app_handle: &AppHandle, path: &str) -> Result<String, String> {
    let base_dir = get_base_dir(app_handle)?;
    let file_path = base_dir.join(path);
    fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("failed to read file {}: {}", path, e))
}

/// update a note file with new content
/// uses direct fs write because nb's --content flag can't handle long markdown
pub async fn update_file(app_handle: &AppHandle, path: &str, content: &str) -> Result<(), String> {
    let base_dir = get_base_dir(app_handle)?;
    let file_path = base_dir.join(path);

    // write content directly to file
    fs::write(&file_path, content)
        .await
        .map_err(|e| format!("failed to update file {}: {e}", path))?;

    // git checkpoint to commit the edit (no index change needed for existing files)
    git_checkpoint(app_handle, &format!("[nb] Edit: {}", path)).await?;

    Ok(())
}

/// delete a note file
pub async fn delete_file(app_handle: &AppHandle, path: &str) -> Result<(), String> {
    run_nb_command(app_handle, &[path, "delete", "--force"]).await?;
    Ok(())
}

/// rename a note file
pub async fn rename_file(
    app_handle: &AppHandle,
    old_path: &str,
    new_filename: &str,
) -> Result<(), String> {
    run_nb_command(app_handle, &[old_path, "rename", new_filename, "--force"]).await?;
    Ok(())
}

// -----------------------------------------
// initialization
// -----------------------------------------

/// initialize nb local notebook for the flowrite base directory
/// the local notebook is at ~/flowrite, nb's internal data is at ~/.fwnb
pub async fn init_nb(app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // ensure fwnb binary is installed (checks version and reinstalls if needed)
    ensure_nb_installed(app_handle).await?;

    let base_dir = get_base_dir(app_handle)?;
    let has_git = base_dir.join(".git").exists();
    let has_index = base_dir.join(".index").exists();

    if has_git && has_index {
        // already a local notebook
        log::info!("nb notebook already initialized at {:?}", base_dir);
    } else {
        // ensure base directory exists before running nb notebooks init
        fs::create_dir_all(&base_dir).await?;
        // nb notebooks init (run from within base_dir) initializes current directory
        init_notebook(app_handle).await?;
        log::info!("initialized nb notebook at {:?}", base_dir);
    }

    // reconcile indexes in background (catch any external file changes)
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match reconcile_index(&app_handle_clone).await {
            Ok(_) => log::info!("nb index reconciliation complete"),
            Err(e) => log::warn!("nb index reconciliation failed: {}", e),
        }
    });

    log::info!("nb initialization complete");

    Ok(())
}
