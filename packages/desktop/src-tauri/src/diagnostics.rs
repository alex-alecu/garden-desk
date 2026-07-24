use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

const MAX_HELPER_STREAM_BYTES: usize = 4 * 1024;
const SNAPSHOT_PREFIX: &str = "vault-session-debug-";

#[derive(Default)]
pub(crate) struct DebugSnapshots(Mutex<HashMap<String, PathBuf>>);

fn append_bounded(output: &mut Vec<u8>, bytes: &[u8]) -> Result<(), String> {
    if output.len().saturating_add(bytes.len()) > MAX_HELPER_STREAM_BYTES {
        return Err("debug_helper_output_invalid".to_owned());
    }
    output.extend_from_slice(bytes);
    Ok(())
}

fn safe_helper_error(stderr: &[u8]) -> String {
    let Ok(value) = std::str::from_utf8(stderr) else {
        return "debug_helper_failed".to_owned();
    };
    let Some(value) = value.strip_suffix('\n') else {
        return "debug_helper_failed".to_owned();
    };
    if value.is_empty() || value.contains('\n') || value.contains('\r') {
        return "debug_helper_failed".to_owned();
    }
    match value {
        "debug_arguments_invalid"
        | "debug_database_unsafe"
        | "debug_schema_unsupported"
        | "debug_session_not_found"
        | "debug_state_invalid"
        | "debug_content_hash_mismatch"
        | "debug_workspace_changed" => value.to_owned(),
        _ => "debug_helper_failed".to_owned(),
    }
}

fn validate_snapshot_path(stdout: &[u8]) -> Result<PathBuf, String> {
    let value = std::str::from_utf8(stdout).map_err(|_| "debug_helper_output_invalid")?;
    let value = value
        .strip_suffix('\n')
        .ok_or("debug_helper_output_invalid")?;
    if value.is_empty() || value.contains('\n') || value.contains('\r') {
        return Err("debug_helper_output_invalid".to_owned());
    }
    validate_snapshot_directory(Path::new(value))
}

fn validate_snapshot_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("debug_helper_output_invalid".to_owned());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "debug_snapshot_missing".to_owned())?;
    let temporary = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| "debug_snapshot_missing".to_owned())?;
    let name = canonical.file_name().and_then(|name| name.to_str());
    if canonical.parent() != Some(temporary.as_path())
        || !name.is_some_and(|name| name.starts_with(SNAPSHOT_PREFIX))
        || !canonical.is_dir()
    {
        return Err("debug_helper_output_invalid".to_owned());
    }
    Ok(canonical)
}

async fn create_with_sidecar(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let catalog = app
        .path()
        .app_data_dir()
        .map_err(|_| "debug_catalog_unavailable".to_owned())?
        .join("state/.vault/catalog.sqlite");
    let command = app
        .shell()
        .sidecar("vault-core")
        .map_err(|_| "debug_helper_unavailable".to_owned())?
        .args([
            "debug-session",
            "--database",
            &crate::path_text(&catalog)?,
            "--session",
            session_id,
        ]);
    #[cfg(target_os = "macos")]
    let command = command.env("NODE_OPTIONS", "--jitless");
    let command = command.set_raw_out(true);
    let (mut events, child) = command
        .spawn()
        .map_err(|_| "debug_helper_unavailable".to_owned())?;
    let mut child = Some(child);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    while let Some(event) = events.recv().await {
        let result = match event {
            CommandEvent::Stdout(bytes) => append_bounded(&mut stdout, &bytes),
            CommandEvent::Stderr(bytes) => append_bounded(&mut stderr, &bytes),
            CommandEvent::Terminated(status) => {
                exit_code = status.code;
                Ok(())
            }
            CommandEvent::Error(_) => Err("debug_helper_failed".to_owned()),
            _ => Ok(()),
        };
        if let Err(error) = result {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
            return Err(error);
        }
    }
    if exit_code != Some(0) {
        return Err(safe_helper_error(&stderr));
    }
    if !stderr.is_empty() {
        return Err("debug_helper_output_invalid".to_owned());
    }
    validate_snapshot_path(&stdout)
}

#[tauri::command]
pub(crate) async fn create_debug_snapshot(
    app: AppHandle,
    snapshots: State<'_, DebugSnapshots>,
    session_id: String,
) -> Result<Value, String> {
    snapshots
        .0
        .lock()
        .map_err(|_| "debug_snapshot_state_failed".to_owned())?
        .remove(&session_id);
    let path = create_with_sidecar(&app, &session_id).await?;
    snapshots
        .0
        .lock()
        .map_err(|_| "debug_snapshot_state_failed".to_owned())?
        .insert(session_id, path.clone());
    Ok(json!({ "path": crate::path_text(&path)? }))
}

#[allow(deprecated)]
#[tauri::command]
pub(crate) fn reveal_debug_snapshot(
    app: AppHandle,
    snapshots: State<'_, DebugSnapshots>,
    session_id: String,
) -> Result<(), String> {
    let path = snapshots
        .0
        .lock()
        .map_err(|_| "debug_snapshot_state_failed".to_owned())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "debug_snapshot_missing".to_owned())?;
    let path = validate_snapshot_directory(&path)?;
    app.shell()
        .open(crate::path_text(&path)?, None)
        .map_err(|_| "debug_snapshot_reveal_failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_HELPER_STREAM_BYTES, append_bounded, safe_helper_error, validate_snapshot_path,
    };

    #[test]
    fn bounds_helper_output() {
        let mut output = vec![0; MAX_HELPER_STREAM_BYTES];
        assert!(append_bounded(&mut output, b"x").is_err());
    }

    #[test]
    fn exposes_only_allowlisted_helper_errors() {
        assert_eq!(
            safe_helper_error(b"debug_session_not_found\n"),
            "debug_session_not_found"
        );
        assert_eq!(
            safe_helper_error(b"private helper failure\n"),
            "debug_helper_failed"
        );
        assert_eq!(
            safe_helper_error(b"debug_state_invalid\nprivate\n"),
            "debug_helper_failed"
        );
    }

    #[test]
    fn rejects_non_absolute_or_multi_line_paths() {
        assert_eq!(
            validate_snapshot_path(b"relative/path\n").unwrap_err(),
            "debug_helper_output_invalid"
        );
        assert_eq!(
            validate_snapshot_path(b"/tmp/vault-session-debug-one\n/private/path\n").unwrap_err(),
            "debug_helper_output_invalid"
        );
    }
}
