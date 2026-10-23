// Oddments in the system tray: the window's close button hides Oddments instead of quitting (the receiver for the
// Blender add-on and the Figma plugin keeps running), a tray icon brings it back. The menu: open, paste from
// the clipboard, quit. «Выход» first lets the window save the library index, then quits (or after 2.5 s anyway).
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

/// «Закрывать в трей» from the settings (on until the window says otherwise)
pub struct CloseToTray(pub AtomicBool);

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn setup<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    app.manage(CloseToTray(AtomicBool::new(true)));
    let open = MenuItem::with_id(app, "open", "Открыть Oddments", true, None::<&str>)?;
    let paste = MenuItem::with_id(app, "paste", "Вставить из буфера", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &paste, &sep, &quit])?;
    let mut tray = TrayIconBuilder::with_id("perch")
        .tooltip("Oddments")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show_main(app),
            "paste" => {
                show_main(app);
                let _ = app.emit("perch-tray-paste", ());
            }
            "quit" => {
                // the window saves the index and calls quit_app; if it cannot, quit anyway
                let _ = app.emit("perch-quit", ());
                let h = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(2500));
                    h.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// the main window's close button: to the tray while «Закрывать в трей» is on
pub fn on_window_event<R: Runtime>(w: &Window<R>, e: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = e {
        if w.label() == "main" && w.state::<CloseToTray>().0.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = w.hide();
        }
    }
}

#[tauri::command]
pub fn set_close_to_tray(state: tauri::State<'_, CloseToTray>, on: bool) {
    state.0.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
