// The system-wide key «в Oddments» (Ctrl+Alt+V, ⌘⌥V on a Mac): a picture copied anywhere (Win+Shift+S, a browser,
// Telegram, Figma) goes into the library while Oddments sits in the tray or behind other windows — the same as the
// tray's «Вставить из буфера». The key reaches the page as the event `perch-hotkey-paste`; the page reads the clipboard
// and adds (main.js). The page turns the key on or off (Настройки › «Системная клавиша», `set_paste_hotkey`) and is
// told when another program already holds it. `notify` shows a system notification: when the key is used the window
// is usually out of sight, so the in-window toast would not be seen.
// Both plugins are used from Rust only, so there is no npm twin whose version the Tauri CLI would hold them to.
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{Emitter, Runtime};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(desktop)]
fn paste_key() -> Shortcut {
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::ALT;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::ALT;
    Shortcut::new(Some(mods), Code::KeyV)
}

#[cfg(desktop)]
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if shortcut == &paste_key() && matches!(event.state(), ShortcutState::Pressed) {
                let _ = app.emit("perch-hotkey-paste", ());
            }
        })
        .build()
}

// on: hold the key (Ok(true) once it is held), off: let it go. An error says what stood in the way — most often another
// program registered the same key first.
#[tauri::command]
pub fn set_paste_hotkey(app: AppHandle, on: bool) -> Result<bool, String> {
    #[cfg(desktop)]
    let held = {
        let gs = app.global_shortcut();
        let key = paste_key();
        let now = gs.is_registered(key);
        if on && !now {
            gs.register(key).map_err(|e| e.to_string())?;
        }
        if !on && now {
            gs.unregister(key).map_err(|e| e.to_string())?;
        }
        on
    };
    #[cfg(not(desktop))]
    let held = {
        let _ = (&app, on);
        false
    };
    Ok(held)
}

// a short system notification (Windows: the action centre toast), for what happened while the window was out of sight
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(desktop)]
    let shown = {
        use tauri_plugin_notification::NotificationExt;
        app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
    };
    #[cfg(not(desktop))]
    let shown = {
        let _ = (&app, title, body);
        Ok(())
    };
    shown
}
