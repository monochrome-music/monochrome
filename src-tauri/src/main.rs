#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use serde_json::json;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, Emitter};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
    last_song: Mutex<Option<String>>,
}

#[tauri::command]
fn update_discord_presence(
    app: AppHandle,
    state: State<DiscordState>,
    details: String,
    status: String,
    image: String,
    is_paused: bool,
    current_sec: f64
) -> Result<(), String> {
    let mut client_guard = state.client.lock().map_err(|_| "Failed to lock mutex")?;
    let client = client_guard.as_mut().ok_or("Discord client not initialized")?;

    let details = if details.len() < 2 { format!("{}  ", details) } else { details };
    let mut status = if status.len() < 2 { format!("{}  ", status) } else { status };
    
    if is_paused {
        status = format!("{} (Paused)", status);
    }
    
    let mut activity = json!({
        "type": 2,
        "details": details,
        "state": status,
        "assets": {
            "large_image": image,
            "large_text": "Music On Monochrome"
        },
        "buttons": [
            { "label": "Listen On Monochrome", "url": "https://monochrome.samidy.com" }
        ]
    });

    if !is_paused {
        let now = SystemTime::now();
        let song_start = now - Duration::from_secs_f64(current_sec);
        let start_timestamp = song_start.duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        activity["timestamps"] = json!({ "start": start_timestamp });

        let mut last_song_guard = state.last_song.lock().unwrap();
        let current_song_key = format!("{} - {}", details, status);
        
        if last_song_guard.as_deref() != Some(&current_song_key) {
            *last_song_guard = Some(current_song_key.clone());
            
            let window = app.get_webview_window("main");
            if let Some(win) = window {
                if !win.is_focused().unwrap_or(false) {
                    let _ = app.notification()
                        .builder()
                        .title("Now Playing")
                        .body(format!("{}\n{}", details, status))
                        .show();
                }
            }
        }
    }

    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": activity
        },
        "nonce": format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis())
    });

    if let Err(e) = client.send(payload.clone(), 1) {
        let _ = client.close();
        
        if client.connect().is_ok() {
            client.send(payload, 1).map_err(|e| e.to_string())?;
        } else {
            return Err(format!("Failed to connect to Discord: {}", e));
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client_id = "1462186088184549661"; 
    let mut client = DiscordIpcClient::new(client_id).ok();

    if let Some(c) = &mut client {
        let _ = c.connect();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app: &AppHandle, _args: Vec<String>, _cwd: String| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(DiscordState { 
            client: Mutex::new(client),
            last_song: Mutex::new(None)
        })
        .setup(|app| {
            let quit = MenuItemBuilder::with_id("quit", "Quit Monochrome").build(app)?;
            let show = MenuItemBuilder::with_id("show", "Show Player").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            let icon = Image::from_bytes(include_bytes!("../icons/icon.png")).expect("Failed to load icon");
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            std::process::exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            let _ = app.global_shortcut().on_shortcut("MediaPlayPause", |app, _shortcut, _event| {
                let _ = app.emit("media-toggle", ());
            });

            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("https://monochrome.samidy.com".parse().unwrap())
            )
            .title("Monochrome")
            .inner_size(1200.0, 800.0)
            .initialization_script(include_str!("../discord-init.js"))
            .build()?;

            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window_clone.hide();
                    api.prevent_close();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![update_discord_presence])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

fn main() {
    run();
}