use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::constants::BASE_DIR_NAME;

// -----------------------------------------
// directory helpers
// -----------------------------------------

/// returns the base flowrite directory path.
pub fn get_base_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = app_handle
        .path()
        .home_dir()
        .map_err(|e| format!("could not find home directory: {e}"))?;
    Ok(home_dir.join(BASE_DIR_NAME))
}

/// converts a relative path to an absolute path within the flowrite base directory.
/// rejects absolute paths and paths that escape the base directory.
pub fn resolve_path(app_handle: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let base = get_base_dir(app_handle)?;
    let resolved = base.join(relative_path);

    // ensure the resolved path is still within the base directory
    if !resolved.starts_with(&base) {
        return Err(format!(
            "path '{}' resolves outside the base directory",
            relative_path
        ));
    }

    Ok(resolved)
}
