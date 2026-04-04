use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WindowEvent,
};

// ============================================================================
// API Server Management (existing)
// ============================================================================

struct ApiServer(Mutex<Option<Child>>);

fn spawn_api_server() -> Option<Child> {
    let root = project_root();
    let child = if cfg!(debug_assertions) {
        Command::new("npx")
            .args(["tsx", "packages/cli/src/index.ts", "start", "--no-telegram"])
            .current_dir(&root)
            .spawn()
    } else {
        Command::new("node")
            .args(["packages/cli/dist/index.js", "start", "--no-telegram"])
            .current_dir(&root)
            .spawn()
    };

    match child {
        Ok(c) => {
            println!("[H Desktop] API server started (pid: {})", c.id());
            Some(c)
        }
        Err(e) => {
            eprintln!("[H Desktop] Failed to start API server: {}", e);
            None
        }
    }
}

fn project_root() -> String {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    if cfg!(debug_assertions) {
        std::env::current_dir()
            .unwrap_or_else(|_| exe_dir.unwrap_or_default())
            .to_string_lossy()
            .to_string()
    } else {
        exe_dir
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    }
}

#[tauri::command]
fn get_api_status(state: tauri::State<ApiServer>) -> bool {
    let guard = state.0.lock().unwrap();
    if let Some(ref child) = *guard {
        let _ = child.id();
        true
    } else {
        false
    }
}

#[tauri::command]
fn restart_api(state: tauri::State<ApiServer>) -> String {
    let mut guard = state.0.lock().unwrap();
    if let Some(ref mut child) = *guard {
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = spawn_api_server();
    match *guard {
        Some(ref c) => format!("API server restarted (pid: {})", c.id()),
        None => "Failed to restart API server".to_string(),
    }
}

// ============================================================================
// PTY Management
// ============================================================================

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send>,
}

struct PtyManager(Mutex<HashMap<String, PtyInstance>>);

#[derive(Clone, serde::Serialize)]
struct PtyOutputEvent {
    pty_id: String,
    data: String,
}

#[tauri::command]
fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<PtyManager>,
    command: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&command);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let pty_id = uuid::Uuid::new_v4().to_string();

    // Get a reader for stdout
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store the PTY instance
    {
        let mut ptys = state.0.lock().unwrap();
        ptys.insert(
            pty_id.clone(),
            PtyInstance {
                master: pair.master,
                writer,
                _child: child,
            },
        );
    }

    // Spawn a thread to read PTY output and emit Tauri events
    let id_clone = pty_id.clone();
    let app_clone = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty-output",
                        PtyOutputEvent {
                            pty_id: id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }

        // PTY closed — notify frontend
        let _ = app_clone.emit(
            "pty-exit",
            serde_json::json!({ "pty_id": id_clone }),
        );
    });

    Ok(pty_id)
}

#[tauri::command]
fn pty_write(state: tauri::State<PtyManager>, pty_id: String, data: String) -> Result<(), String> {
    let mut ptys = state.0.lock().unwrap();
    if let Some(pty) = ptys.get_mut(&pty_id) {
        pty.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        pty.writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY not found: {}", pty_id))
    }
}

#[tauri::command]
fn pty_resize(
    state: tauri::State<PtyManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let ptys = state.0.lock().unwrap();
    if let Some(pty) = ptys.get(&pty_id) {
        pty.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY not found: {}", pty_id))
    }
}

#[tauri::command]
fn pty_kill(state: tauri::State<PtyManager>, pty_id: String) -> Result<(), String> {
    let mut ptys = state.0.lock().unwrap();
    if ptys.remove(&pty_id).is_some() {
        // Dropping PtyInstance closes the master and kills the child
        Ok(())
    } else {
        Err(format!("PTY not found: {}", pty_id))
    }
}

#[tauri::command]
fn pty_list(state: tauri::State<PtyManager>) -> Vec<String> {
    let ptys = state.0.lock().unwrap();
    ptys.keys().cloned().collect()
}

// ============================================================================
// App Entry
// ============================================================================

pub fn run() {
    let api_child = spawn_api_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(ApiServer(Mutex::new(api_child)))
        .manage(PtyManager(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            get_api_status,
            restart_api,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_list,
        ])
        .setup(|app| {
            // ---- System Tray ----
            let show = MenuItemBuilder::with_id("show", "Show H").build(app)?;
            let restart = MenuItemBuilder::with_id("restart_api", "Restart API").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&restart)
                .separator()
                .item(&quit)
                .build()?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("H — AI Coding Orchestrator")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "restart_api" => {
                        let state = app.state::<ApiServer>();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                        *guard = spawn_api_server();
                    }
                    "quit" => {
                        // Clean up API server and all PTYs before quitting
                        let api_state = app.state::<ApiServer>();
                        let mut guard = api_state.0.lock().unwrap();
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
                            let _ = child.wait();
                        }

                        let pty_state = app.state::<PtyManager>();
                        let mut ptys = pty_state.0.lock().unwrap();
                        ptys.clear(); // Drop all PTY instances

                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // ---- Global Shortcut: Ctrl+Space to toggle window ----
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            app.global_shortcut().on_shortcut("ctrl+space", {
                let app_handle = app.handle().clone();
                move |_app, _shortcut, _event| {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                        } else {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
            })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray instead of closing
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running H desktop");
}
