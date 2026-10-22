use crate::{storage::Result, Runtime};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct Updates {
    state: Mutex<Value>,
    operation: tokio::sync::Mutex<Pending>,
}
#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

impl Updates {
    pub fn new(version: String) -> Self {
        Self {
            state: Mutex::new(
                json!({"revision":0,"status":if cfg!(debug_assertions) {"unsupported"} else {"idle"},"currentVersion":version,"availableVersion":null,"percent":null,"error":null}),
            ),
            operation: tokio::sync::Mutex::new(Pending::default()),
        }
    }
    pub fn snapshot(&self) -> Value {
        self.state.lock().unwrap().clone()
    }
    fn change(
        &self,
        app: &tauri::AppHandle,
        status: &str,
        percent: Option<f64>,
        error: Option<String>,
    ) {
        let mut state = self.state.lock().unwrap();
        state["revision"] = json!(state["revision"].as_u64().unwrap_or(0) + 1);
        state["status"] = json!(status);
        state["percent"] = json!(percent);
        state["error"] = json!(error);
        let _ = app.emit("app-update", state.clone());
    }
}

#[tauri::command]
pub async fn update_action(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    action: String,
) -> Result<()> {
    if webview.label() != "main" {
        return Err("Only the main window may update the app".into());
    }
    perform(&app, &action).await
}

async fn perform(app: &tauri::AppHandle, action: &str) -> Result<()> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let updates = app.state::<Updates>();
    let Ok(mut pending) = updates.operation.try_lock() else {
        return Ok(());
    };
    let result: Result<()> = async {
        match action {
            "check" => {
                // Never discard a ready package during a periodic check.
                if pending.bytes.is_some() {
                    return Ok(());
                }
                updates.change(app, "checking", None, None);
                let found = app
                    .updater()
                    .map_err(|e| e.to_string())?
                    .check()
                    .await
                    .map_err(|e| e.to_string())?;
                if let Some(update) = &found {
                    let version =
                        semver::Version::parse(&update.version).map_err(|e| e.to_string())?;
                    let current = semver::Version::parse(&update.current_version)
                        .map_err(|e| e.to_string())?;
                    if !version.pre.is_empty() || version <= current {
                        return Err("Only newer stable releases can be installed".into());
                    }
                }
                let status = if found.is_some() {
                    "available"
                } else {
                    "up-to-date"
                };
                updates.state.lock().unwrap()["availableVersion"] =
                    json!(found.as_ref().map(|u| u.version.clone()));
                pending.update = found;
                updates.change(app, status, None, None);
            }
            "download" => {
                let update = pending
                    .update
                    .as_ref()
                    .ok_or("Check for an update first")?
                    .clone();
                if pending.bytes.is_some() {
                    return Ok(());
                }
                updates.change(app, "downloading", Some(0.0), None);
                let mut received = 0u64;
                let mut previous_percent = -1i32;
                let bytes = update
                    .download(
                        |chunk, total| {
                            received += chunk as u64;
                            let percent = total
                                .filter(|t| *t > 0)
                                .map(|t| (received as f64 / t as f64 * 100.0).min(100.0));
                            let whole = percent.unwrap_or(0.0) as i32;
                            if whole != previous_percent {
                                updates.change(app, "downloading", percent, None);
                                previous_percent = whole;
                            }
                        },
                        || {},
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                pending.bytes = Some(bytes);
                updates.change(app, "downloaded", Some(100.0), None);
            }
            "install" => {
                let update = pending
                    .update
                    .as_ref()
                    .ok_or("No update is available")?
                    .clone();
                let bytes = pending.bytes.as_ref().ok_or("Download the update first")?;
                let runtime = app.state::<Runtime>();
                // try_lock refuses installation while an operation holds the library.
                let backend = runtime.backend.try_lock().map_err(|_| {
                    "Wait for library operations to finish, then try restarting again."
                })?;
                runtime.installing.store(true, Ordering::SeqCst);
                let installation = (|| {
                    backend.flush()?;
                    updates.change(app, "installing", Some(100.0), None);
                    update.install(bytes).map_err(|e| e.to_string())
                })();
                runtime.installing.store(false, Ordering::SeqCst);
                installation?;
            }
            _ => return Err("Unknown update action".into()),
        }
        Ok(())
    }
    .await;
    if let Err(error) = &result {
        // Retain downloaded bytes so a failed preparation/install can be retried.
        updates.change(
            app,
            if pending.bytes.is_some() {
                "downloaded"
            } else {
                "error"
            },
            None,
            Some(error.clone()),
        );
    }
    result
}

pub fn schedule(app: tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        loop {
            let _ = perform(&app, "check").await;
            tokio::time::sleep(std::time::Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}
