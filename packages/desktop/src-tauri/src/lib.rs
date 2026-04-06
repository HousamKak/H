use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

// ============================================================================
// API Server Management (existing)
// ============================================================================

struct ApiServer(Mutex<Option<Child>>);

fn log_to_file(app: &tauri::AppHandle, msg: &str) {
    if let Ok(app_data) = app.path().app_data_dir() {
        let log_path = app_data.join("h-desktop.log");
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), msg);
        }
    }
}

fn spawn_api_server(app: &tauri::AppHandle) -> Option<Child> {
    let child = if cfg!(debug_assertions) {
        // Dev mode: run from repo via tsx (requires Node on PATH)
        let root = std::env::current_dir().unwrap_or_default();
        Command::new("npx")
            .args(["tsx", "packages/cli/src/index.ts", "start", "--no-telegram"])
            .current_dir(&root)
            .spawn()
    } else {
        // Production: spawn bundled node sidecar with bundled backend.cjs
        let resource_dir = app
            .path()
            .resource_dir()
            .expect("resource dir");
        let backend_dir = resource_dir.join("resources").join("backend");
        let backend_js = backend_dir.join("h-backend.cjs");
        let schema_sql = backend_dir.join("schema.sql");
        let schemas_dir = backend_dir.join("schemas");

        // Writable dirs in app data
        let app_data = app.path().app_data_dir().expect("app data dir");
        let data_dir = app_data.join("data");
        let mcp_configs_dir = data_dir.join("mcp-configs");
        std::fs::create_dir_all(&data_dir).ok();
        std::fs::create_dir_all(&mcp_configs_dir).ok();
        let db_path = data_dir.join("h.db");

        // Log file for backend stdout/stderr (GUI mode has no console)
        let log_path = app_data.join("backend.log");
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path);

        // Locate bundled node.exe sidecar — Tauri NSIS places externalBin
        // in the same directory as the main executable (resource_dir root),
        // keeping the target-triple suffix.
        let sidecar_name = "h-node-x86_64-pc-windows-msvc.exe";
        let candidates = [
            resource_dir.join(sidecar_name),                      // NSIS: root
            resource_dir.join("binaries").join(sidecar_name),     // if nested
            resource_dir.join("h-node.exe"),                      // stripped triple
        ];
        let node_cmd: std::path::PathBuf = candidates
            .iter()
            .find(|p| p.exists())
            .cloned()
            .unwrap_or_else(|| "node".into());

        log_to_file(app, &format!("resource_dir: {:?}", resource_dir));
        log_to_file(app, &format!("node_cmd: {:?} (exists: {})", node_cmd, node_cmd.exists()));
        log_to_file(app, &format!("backend_js: {:?} (exists: {})", backend_js, backend_js.exists()));
        log_to_file(app, &format!("schema_sql: {:?} (exists: {})", schema_sql, schema_sql.exists()));
        log_to_file(app, &format!("db_path: {:?}", db_path));

        let mut cmd = Command::new(&node_cmd);
        cmd.arg(&backend_js)
            .arg("start")
            .arg("--no-telegram")
            .env("H_DB_PATH", db_path.to_string_lossy().to_string())
            .env("H_SCHEMA_PATH", schema_sql.to_string_lossy().to_string())
            .env("H_SCHEMAS_DIR", schemas_dir.to_string_lossy().to_string())
            .env("H_API_PORT", "3100")
            .env("H_MCP_CONFIG_DIR", mcp_configs_dir.to_string_lossy().to_string())
            .current_dir(&data_dir);

        // Redirect backend stdout/stderr to log file so we can diagnose crashes
        if let Ok(f) = log_file {
            let stderr_f = f.try_clone().unwrap_or_else(|_| {
                std::fs::File::open(std::path::Path::new("/dev/null")).unwrap()
            });
            cmd.stdout(Stdio::from(f));
            cmd.stderr(Stdio::from(stderr_f));
        }

        cmd.spawn()
    };

    match child {
        Ok(c) => {
            log_to_file(app, &format!("API server started (pid: {})", c.id()));
            Some(c)
        }
        Err(e) => {
            log_to_file(app, &format!("FAILED to start API server: {}", e));
            None
        }
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
fn restart_api(app: tauri::AppHandle, state: tauri::State<ApiServer>) -> String {
    let mut guard = state.0.lock().unwrap();
    if let Some(ref mut child) = *guard {
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = spawn_api_server(&app);
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
// Auto-Update
// ============================================================================

use tauri_plugin_updater::UpdaterExt;

async fn check_for_updates(
    app: tauri::AppHandle,
    user_initiated: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let updater = app.updater()?;
    match updater.check().await? {
        Some(update) => {
            println!(
                "[H Desktop] Update available: {} -> {}",
                update.current_version, update.version
            );
            // Download and install (Tauri's built-in dialog asks the user first)
            let mut downloaded = 0usize;
            update
                .download_and_install(
                    |chunk_length, content_length| {
                        downloaded += chunk_length;
                        if let Some(total) = content_length {
                            let pct = (downloaded as f64 / total as f64) * 100.0;
                            println!("[H Desktop] Update download: {:.1}%", pct);
                        }
                    },
                    || {
                        println!("[H Desktop] Update downloaded, installing...");
                    },
                )
                .await?;
            println!("[H Desktop] Update installed, restarting...");
            app.restart();
        }
        None => {
            if user_initiated {
                println!("[H Desktop] No updates available");
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn manual_check_updates(app: tauri::AppHandle) -> Result<String, String> {
    match check_for_updates(app, true).await {
        Ok(_) => Ok("Update check completed".to_string()),
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

// ============================================================================
// App Entry
// ============================================================================

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ApiServer(Mutex::new(None)))
        .manage(PtyManager(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            get_api_status,
            restart_api,
            manual_check_updates,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_list,
        ])
        .setup(|app| {
            // Spawn the H backend now that we have access to paths.
            // If spawn fails, don't panic — leave the window open so the user
            // sees the API connection errors instead of a silent crash.
            let child = spawn_api_server(&app.handle());
            if let Some(c) = child {
                app.state::<ApiServer>().0.lock().unwrap().replace(c);
            } else {
                eprintln!("[H Desktop] WARNING: Backend failed to start. UI will open but API calls will fail.");
            }

            // Check for updates in the background on startup
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = check_for_updates(handle, false).await {
                    eprintln!("[H Desktop] Update check failed: {}", e);
                }
            });

            // ---- System Tray ----
            let show = MenuItemBuilder::with_id("show", "Show H").build(app)?;
            let restart = MenuItemBuilder::with_id("restart_api", "Restart API").build(app)?;
            let check_update = MenuItemBuilder::with_id("check_update", "Check for Updates").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&restart)
                .item(&check_update)
                .separator()
                .item(&quit)
                .build()?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("H — AI Coding Orchestrator");
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder
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
                        *guard = spawn_api_server(app);
                    }
                    "check_update" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = check_for_updates(handle, true).await;
                        });
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
