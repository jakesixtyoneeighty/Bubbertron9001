// Plugin installation management for the Bubberton9001 Studio bridge.
// Handles checking if plugin is installed and installing it to Roblox Plugins folder

use std::fs;
use std::path::PathBuf;

// Embed the plugin source directly in the binary
const PLUGIN_SOURCE: &str = include_str!("../../studio-plugin/bubberton9001-bridge.server.lua");
const PLUGIN_FILENAME: &str = "bubberton9001-bridge.server.lua";
const LEGACY_PLUGIN_FILENAME: &str = "stud-bridge.server.lua";
const PAIRING_SECRET_PLACEHOLDER: &str = "__BUBBERTON9001_PAIRING_SECRET__";
const PAIRING_SECRET_PREFIX: &str = "local PAIRING_SECRET = \"";
const PAIRING_SECRET_BYTES: usize = 64;

lazy_static::lazy_static! {
    static ref PAIRING_SECRET: String =
        load_installed_pairing_secret().unwrap_or_else(generate_pairing_secret);
}

pub(crate) fn pairing_secret() -> &'static str {
    PAIRING_SECRET.as_str()
}

/// Return the loopback bridge token only to the trusted Tauri WebView.
///
/// Browser code cannot obtain this value over HTTP; it is exposed through the
/// native invoke boundary so protected bridge routes can reject other local
/// processes that merely discover the port.
#[tauri::command]
pub fn get_bridge_auth_token() -> String {
    pairing_secret().to_string()
}

/// Render a manually downloadable plugin with the active bridge pairing secret.
///
/// The checked-in Lua file remains an inert template. Returning the paired
/// source through Tauri prevents the browser-facing public asset from becoming
/// an install path that can never authenticate.
#[tauri::command]
pub fn get_paired_plugin_source() -> Result<PairedPluginSource, String> {
    Ok(PairedPluginSource {
        filename: PLUGIN_FILENAME.to_string(),
        source: render_plugin_source(pairing_secret())?,
    })
}

fn generate_pairing_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn valid_pairing_secret(secret: &str) -> bool {
    secret.len() == PAIRING_SECRET_BYTES
        && secret.bytes().all(|byte| byte.is_ascii_hexdigit())
        && secret != PAIRING_SECRET_PLACEHOLDER
}

fn extract_pairing_secret(source: &str) -> Option<String> {
    source.lines().find_map(|line| {
        let secret = line
            .trim()
            .strip_prefix(PAIRING_SECRET_PREFIX)?
            .strip_suffix('"')?;
        valid_pairing_secret(secret).then(|| secret.to_string())
    })
}

fn load_installed_pairing_secret() -> Option<String> {
    let source = fs::read_to_string(get_plugins_folder()?.join(PLUGIN_FILENAME)).ok()?;
    extract_pairing_secret(&source)
}

fn render_plugin_source(secret: &str) -> Result<String, String> {
    if !valid_pairing_secret(secret) {
        return Err("Generated an invalid Studio pairing secret".to_string());
    }
    if PLUGIN_SOURCE
        .match_indices(PAIRING_SECRET_PLACEHOLDER)
        .count()
        != 1
    {
        return Err("Plugin pairing placeholder is missing or duplicated".to_string());
    }

    Ok(PLUGIN_SOURCE.replace(PAIRING_SECRET_PLACEHOLDER, secret))
}

/// Check if Roblox Studio is installed on the system
#[tauri::command]
pub fn check_roblox_studio_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Check common installation locations on macOS
        let paths = [
            PathBuf::from("/Applications/RobloxStudio.app"),
            PathBuf::from("/Applications/Roblox Studio.app"),
        ];

        for path in paths {
            if path.exists() {
                return true;
            }
        }

        // Also check if Roblox folder exists in Documents (indicates previous use)
        if let Some(home) = dirs::home_dir() {
            let roblox_folder = home.join("Documents").join("Roblox");
            if roblox_folder.exists() {
                return true;
            }
        }

        false
    }

    #[cfg(target_os = "windows")]
    {
        // Check common installation locations on Windows
        if let Some(local_app_data) = dirs::data_local_dir() {
            let roblox_versions = local_app_data.join("Roblox").join("Versions");
            if roblox_versions.exists() {
                // Look for RobloxStudioBeta.exe in any version folder
                if let Ok(entries) = fs::read_dir(&roblox_versions) {
                    for entry in entries.flatten() {
                        let studio_exe = entry.path().join("RobloxStudioBeta.exe");
                        if studio_exe.exists() {
                            return true;
                        }
                    }
                }
            }
        }

        // Check Program Files
        let program_files = [
            PathBuf::from("C:\\Program Files\\Roblox"),
            PathBuf::from("C:\\Program Files (x86)\\Roblox"),
        ];

        for path in program_files {
            if path.exists() {
                return true;
            }
        }

        return false;
    }

    #[cfg(target_os = "linux")]
    {
        // Roblox Studio doesn't officially support Linux
        // Check for Wine installation
        if let Some(home) = dirs::home_dir() {
            let wine_roblox = home
                .join(".wine")
                .join("drive_c")
                .join("users")
                .join("Public")
                .join("Documents")
                .join("Roblox");
            if wine_roblox.exists() {
                return true;
            }
        }
        return false;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        false
    }
}

/// Get the Roblox Plugins folder path for the current platform
fn get_plugins_folder() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return Some(home.join("Documents").join("Roblox").join("Plugins"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = dirs::data_local_dir() {
            return Some(local_app_data.join("Roblox").join("Plugins"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Roblox Studio doesn't officially support Linux, but some use Wine
        if let Some(home) = dirs::home_dir() {
            return Some(
                home.join(".wine")
                    .join("drive_c")
                    .join("users")
                    .join("Public")
                    .join("Documents")
                    .join("Roblox")
                    .join("Plugins"),
            );
        }
    }

    None
}

/// Check whether the current or legacy bridge plugin is installed.
#[tauri::command]
pub fn check_plugin_installed() -> Result<PluginStatus, String> {
    let plugins_folder = get_plugins_folder()
        .ok_or_else(|| "Could not determine Roblox Plugins folder".to_string())?;

    let plugin_path = plugins_folder.join(PLUGIN_FILENAME);
    let legacy_plugin_path = plugins_folder.join(LEGACY_PLUGIN_FILENAME);
    let legacy_install_detected = legacy_plugin_path.exists();

    if plugin_path.exists() {
        // Check if it's the current version by comparing content
        if let Ok(existing_content) = fs::read_to_string(&plugin_path) {
            let expected_content = render_plugin_source(pairing_secret())?;
            let is_current =
                existing_content.trim() == expected_content.trim() && !legacy_install_detected;
            Ok(PluginStatus {
                installed: true,
                path: plugin_path.to_string_lossy().to_string(),
                is_current_version: is_current,
                plugins_folder: plugins_folder.to_string_lossy().to_string(),
                legacy_install_detected,
            })
        } else {
            Ok(PluginStatus {
                installed: true,
                path: plugin_path.to_string_lossy().to_string(),
                is_current_version: false, // Can't read, assume outdated
                plugins_folder: plugins_folder.to_string_lossy().to_string(),
                legacy_install_detected,
            })
        }
    } else if legacy_install_detected {
        Ok(PluginStatus {
            installed: true,
            path: legacy_plugin_path.to_string_lossy().to_string(),
            is_current_version: false,
            plugins_folder: plugins_folder.to_string_lossy().to_string(),
            legacy_install_detected: true,
        })
    } else {
        Ok(PluginStatus {
            installed: false,
            path: plugin_path.to_string_lossy().to_string(),
            is_current_version: false,
            plugins_folder: plugins_folder.to_string_lossy().to_string(),
            legacy_install_detected: false,
        })
    }
}

/// Install the Bubberton9001 bridge and remove the legacy Stud filename.
#[tauri::command]
pub fn install_plugin() -> Result<InstallResult, String> {
    let plugins_folder = get_plugins_folder()
        .ok_or_else(|| "Could not determine Roblox Plugins folder".to_string())?;

    // Create the Plugins folder if it doesn't exist
    if !plugins_folder.exists() {
        fs::create_dir_all(&plugins_folder)
            .map_err(|e| format!("Failed to create Plugins folder: {}", e))?;
    }

    let plugin_path = plugins_folder.join(PLUGIN_FILENAME);
    let legacy_plugin_path = plugins_folder.join(LEGACY_PLUGIN_FILENAME);

    // Provision this installation's secret into the otherwise inert source template.
    let provisioned_source = render_plugin_source(pairing_secret())?;
    fs::write(&plugin_path, provisioned_source)
        .map_err(|e| format!("Failed to write plugin file: {}", e))?;

    let migrated_legacy_install = if legacy_plugin_path.exists() {
        fs::remove_file(&legacy_plugin_path).map_err(|e| {
            format!(
                "Installed Bubberton9001, but could not remove the legacy plugin at {}: {}. Remove it manually before restarting Roblox Studio.",
                legacy_plugin_path.to_string_lossy(),
                e
            )
        })?;
        true
    } else {
        false
    };

    let message = if migrated_legacy_install {
        "Plugin upgraded from Stud to Bubberton9001. Restart Roblox Studio to load it."
    } else {
        "Plugin installed successfully. Restart Roblox Studio to load it."
    };

    Ok(InstallResult {
        success: true,
        path: plugin_path.to_string_lossy().to_string(),
        message: message.to_string(),
        migrated_legacy_install,
    })
}

/// Get the plugins folder path (for manual installation info)
#[tauri::command]
pub fn get_plugins_path() -> Result<String, String> {
    get_plugins_folder()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine Roblox Plugins folder".to_string())
}

#[derive(serde::Serialize)]
pub struct PluginStatus {
    pub installed: bool,
    pub path: String,
    pub is_current_version: bool,
    pub plugins_folder: String,
    pub legacy_install_detected: bool,
}

#[derive(serde::Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub path: String,
    pub message: String,
    pub migrated_legacy_install: bool,
}

#[derive(serde::Serialize)]
pub struct PairedPluginSource {
    pub filename: String,
    pub source: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_pairing_secret_round_trips_through_provisioned_source() {
        let secret = "a".repeat(PAIRING_SECRET_BYTES);
        let source = render_plugin_source(&secret).expect("source should render");

        assert_eq!(
            extract_pairing_secret(&source).as_deref(),
            Some(secret.as_str())
        );
        assert!(!source.contains(PAIRING_SECRET_PLACEHOLDER));
    }

    #[test]
    fn placeholder_is_not_accepted_as_a_provisioned_secret() {
        assert!(extract_pairing_secret(PLUGIN_SOURCE).is_none());
        assert!(!valid_pairing_secret(PAIRING_SECRET_PLACEHOLDER));
    }

    #[test]
    fn manual_download_is_rendered_with_the_active_pairing_secret() {
        let download = get_paired_plugin_source().expect("download should render");

        assert_eq!(download.filename, PLUGIN_FILENAME);
        assert!(!download.source.contains(PAIRING_SECRET_PLACEHOLDER));
        assert_eq!(
            extract_pairing_secret(&download.source).as_deref(),
            Some(pairing_secret())
        );
    }
}
