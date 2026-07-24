use serde_json::{Value, json};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

mod commands;
mod diagnostics;

const MAX_RESPONSE_BYTES: u64 = 192 * 1024 * 1024;

#[cfg(windows)]
fn add_platform_arguments(
    arguments: &mut Vec<String>,
    core_resources: &Path,
) -> Result<(), String> {
    arguments.extend([
        "--windows-pipe-guard".to_owned(),
        path_text(&core_resources.join("vault-pipe-guard.exe"))?,
    ]);
    Ok(())
}

#[cfg(target_os = "macos")]
fn add_platform_arguments(
    arguments: &mut Vec<String>,
    core_resources: &Path,
) -> Result<(), String> {
    arguments.extend([
        "--worker-entry".to_owned(),
        path_text(&core_resources.join("inference/worker.mjs"))?,
        "--inference-runtime".to_owned(),
        path_text(&core_resources.join("inference/node"))?,
        "--agent-helper".to_owned(),
        path_text(&core_resources.join("workers/vault-vz-helper"))?,
        "--agent-image-root".to_owned(),
        path_text(&core_resources.join("workers/images"))?,
        "--packaged-model-store".to_owned(),
    ]);
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn add_platform_arguments(_: &mut Vec<String>, _: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) struct CoreBridge {
    child: Mutex<Option<CommandChild>>,
    endpoint: String,
    next_id: AtomicU64,
}

impl CoreBridge {
    fn start(app: &AppHandle) -> Result<Self, String> {
        let data_root = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let resource_root = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?;
        let workspace = data_root.join("state");
        let ready_file = data_root.join("core.ready");
        let core_resources = resource_root.join("resources/core");
        fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
        remove_stale_ready_file(&ready_file)?;

        let mut arguments = vec![
            "--workspace".to_owned(),
            path_text(&workspace)?,
            "--model-store".to_owned(),
            path_text(&core_resources.join("models"))?,
            "--profile".to_owned(),
            "auto".to_owned(),
            "--migration-directory".to_owned(),
            path_text(&core_resources.join("migrations"))?,
            "--ready-file".to_owned(),
            path_text(&ready_file)?,
            "--parent-pid".to_owned(),
            std::process::id().to_string(),
        ];
        add_platform_arguments(&mut arguments, &core_resources)?;
        let command = app
            .shell()
            .sidecar("vault-core")
            .map_err(|error| error.to_string())?
            .args(arguments);
        #[cfg(target_os = "macos")]
        let command = command.env("NODE_OPTIONS", "--jitless");
        let (mut events, child) = command.spawn().map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
        let endpoint = wait_for_ready_file(&ready_file)?;
        Ok(Self {
            child: Mutex::new(Some(child)),
            endpoint,
            next_id: AtomicU64::new(1),
        })
    }

    pub(crate) fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": self.next_id.fetch_add(1, Ordering::Relaxed),
            "method": method,
            "params": params,
            "protocolVersion": 1,
        });
        let response = exchange(&self.endpoint, &format!("{request}\n"))?;
        let envelope: Value =
            serde_json::from_slice(&response).map_err(|error| error.to_string())?;
        if let Some(error) = envelope.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Vault Core rejected the request.")
                .to_owned());
        }
        envelope
            .get("result")
            .cloned()
            .ok_or_else(|| "Vault Core returned no result.".to_owned())
    }

    fn stop(&self) {
        if let Ok(mut child) = self.child.lock()
            && let Some(child) = child.take()
        {
            let _ = child.kill();
        }
    }
}

pub(crate) fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Vault Desk requires UTF-8 application paths.".to_owned())
}

fn remove_stale_ready_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn wait_for_ready_file(path: &Path) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match fs::read_to_string(path) {
            Ok(endpoint) if !endpoint.trim().is_empty() => return Ok(endpoint.trim().to_owned()),
            Ok(_) | Err(_) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(_) | Err(_) => return Err("Vault Core did not become ready.".to_owned()),
        }
    }
}

#[cfg(unix)]
fn connect(endpoint: &str) -> std::io::Result<std::os::unix::net::UnixStream> {
    std::os::unix::net::UnixStream::connect(endpoint)
}

#[cfg(windows)]
fn connect(endpoint: &str) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(endpoint)
}

fn exchange(endpoint: &str, request: &str) -> Result<Vec<u8>, String> {
    let mut stream = connect(endpoint).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| error.to_string())?;
    }
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = Vec::new();
    stream
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut response)
        .map_err(|error| error.to_string())?;
    if response.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Vault Core response exceeded its limit.".to_owned());
    }
    Ok(response)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let core = CoreBridge::start(app.handle()).map_err(std::io::Error::other)?;
            app.manage(core);
            app.manage(diagnostics::DebugSnapshots::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::append_user_message,
            commands::cancel_agent,
            commands::choose_folder,
            commands::choose_files,
            commands::create_session,
            diagnostics::create_debug_snapshot,
            commands::delete_session,
            commands::desktop_bootstrap,
            commands::get_agent_run,
            commands::list_agent_runs,
            commands::list_attachments,
            commands::list_messages,
            commands::list_sessions,
            commands::load_draft,
            commands::model_status,
            commands::open_folder,
            commands::remove_attachment,
            commands::revoke_folder,
            diagnostics::reveal_debug_snapshot,
            commands::save_draft,
            commands::start_agent,
            commands::unload_model,
        ])
        .build(tauri::generate_context!())
        .expect("Vault Desk desktop failed");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. })
            && let Some(core) = app.try_state::<CoreBridge>()
        {
            core.stop();
        }
    });
}
