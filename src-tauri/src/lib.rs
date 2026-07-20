// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod bridge;
mod plugin;
mod secrets;

use std::thread;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start the bridge server in a separate thread with its own tokio runtime
    thread::spawn(|| {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(bridge::start_bridge_server());
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            plugin::check_plugin_installed,
            plugin::install_plugin,
            plugin::get_plugins_path,
            plugin::check_roblox_studio_installed,
            plugin::get_bridge_auth_token,
            plugin::get_paired_plugin_source,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
