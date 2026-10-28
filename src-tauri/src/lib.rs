// File work happens in the frontend through Tauri plugins. The Rust side registers them and adds
// small bridges of its own: running an installed Blender in the background (blender.rs), a local
// receiver for the Blender add-on and the Figma plugin (bridge.rs), and the bundled AutoRemesher
// quad remesher run without a window (remesher.rs), and the tray icon with close-to-tray (tray.rs).
// The same entry point is reused for mobile builds later.
mod blender;
mod bridge;
#[cfg(desktop)]
mod mcp;
mod remesher;
mod tray;

use tauri::Manager;
use tauri_plugin_fs::FsExt;

// Files dragged in as links (Telegram Desktop hands over file:/// paths, not file objects) lie outside the
// library scope. The frontend asks for exactly those files; each must exist and be a regular file, and only
// that file (not its folder) becomes readable.
#[tauri::command]
fn allow_dropped(app: tauri::AppHandle, paths: Vec<String>) -> Vec<String> {
    let scope = app.fs_scope();
    paths
        .into_iter()
        .filter(|p| std::path::Path::new(p).is_file())
        .filter(|p| scope.allow_file(p).is_ok())
        .collect()
}

// where this program is, for the plugin hub: Claude Desktop starts `<exe> --mcp`
#[tauri::command]
fn app_exe() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(desktop)]
fn mcp_mode() -> bool {
    if std::env::args().any(|a| a == "--mcp") { mcp::stdio(); true } else { false }
}
#[cfg(not(desktop))]
fn mcp_mode() -> bool { false }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `Oddments --mcp`: an MCP server over stdio for Claude Desktop (mcp.rs), not a window
    if mcp_mode() { return; }
    let builder = tauri::Builder::default();
    // one Oddments at a time (bug #33): two windows wrote the same index.json and lost each other's changes; a second
    // launch (the window hidden in the tray, the shortcut clicked again) brings the running window forward instead.
    // It must be the first plugin.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| tray::show_main(app)));
    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            let shared = bridge::start(app.handle());
            app.manage(shared);
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            blender::find_blender,
            blender::blender_to_glb,
            blender::blender_uv,
            bridge::integration_info,
            bridge::set_selection,
            bridge::set_catalog,
            bridge::send_to_blender,
            bridge::mcp_reply,
            bridge::integration_seen,
            remesher::find_remesher,
            remesher::autoremesh,
            allow_dropped,
            app_exe,
            tray::set_close_to_tray,
            tray::quit_app
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Oddments");
}
