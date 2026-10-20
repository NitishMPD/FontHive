#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activation;
mod backend;
mod fonts;
mod providers;
mod storage;
mod updates;

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use tauri::{Emitter, Manager};

type PreviewIndex = Arc<RwLock<HashMap<String, (std::path::PathBuf, u32)>>>;

struct Runtime {
    backend: Arc<Mutex<backend::Backend>>,
    installing: AtomicBool,
    previews: PreviewIndex,
    // A separate file lock protects the legacy data directory across Tauri instances.
    _data_lock: std::fs::File,
}

#[tauri::command]
async fn dispatch(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    args: Value,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Only the main window may access the library".into());
    }
    if action == "bootstrap" {
        let update = app.state::<updates::Updates>().snapshot();
        let mut result = run_backend(app.clone(), action, args).await?;
        result["appUpdate"] = update;
        return Ok(result);
    }
    run_backend(app, action, args).await
}

async fn run_backend(app: tauri::AppHandle, action: String, args: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let mut backend = runtime.backend.lock().map_err(|e| e.to_string())?;
        if runtime.installing.load(Ordering::SeqCst) {
            return Err("The app is restarting to install an update".into());
        }
        backend.dispatch(&app, &runtime.previews, &action, args)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("hive-font", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            // Read font bytes on a worker, never on the window thread.
            std::thread::spawn(move || {
                let response = (|| -> Result<_, String> {
                    let id =
                        url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
                            .find(|(key, _)| key == "id")
                            .map(|(_, id)| id.into_owned())
                            .ok_or("Missing font id")?;
                    let runtime = app.state::<Runtime>();
                    let (path, face) = runtime
                        .previews
                        .read()
                        .map_err(|e| e.to_string())?
                        .get(&id)
                        .cloned()
                        .ok_or("Font not found")?;
                    let (bytes, mime) = fonts::preview(&path, face)?;
                    Ok(tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "no-store")
                        .body(bytes)
                        .unwrap())
                })()
                .unwrap_or_else(|_| {
                    tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap()
                });
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![dispatch, updates::update_action])
        .setup(|app| {
            let root = storage::data_dir()?;
            let lock = storage::lock_data(&root)?;
            let backend = backend::Backend::open(root)?;
            let previews = Arc::new(RwLock::new(HashMap::new()));
            backend.index_previews(&previews);
            app.manage(Runtime {
                backend: Arc::new(Mutex::new(backend)),
                installing: AtomicBool::new(false),
                previews,
                _data_lock: lock,
            });
            app.manage(updates::Updates::new(
                app.package_info().version.to_string(),
            ));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = run_backend(handle.clone(), "startup".into(), Value::Null).await
                {
                    let _ = handle.emit("backend-error", error);
                }
            });
            updates::schedule(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Don't abandon a scan/download/activation halfway through a write.
                let runtime = window.state::<Runtime>();
                if runtime.backend.try_lock().is_err() {
                    api.prevent_close();
                    let _ = window.emit(
                        "backend-error",
                        "Wait for library operations to finish before closing Font Hive.",
                    );
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start Font Hive");
}
