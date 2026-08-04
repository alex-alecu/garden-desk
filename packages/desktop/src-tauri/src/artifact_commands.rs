use crate::CoreBridge;
use serde_json::{Value, json};
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

#[allow(deprecated)]
#[tauri::command]
pub(crate) async fn open_artifact(
    app: AppHandle,
    core: State<'_, CoreBridge>,
    session_id: String,
    artifact_id: String,
) -> Result<(), String> {
    let path = core.call(
        "artifacts.materialize",
        json!({ "sessionId": session_id, "artifactId": artifact_id }),
    )?;
    let path = path
        .as_str()
        .ok_or_else(|| "Vault Core returned an invalid generated file path.".to_owned())?;
    app.shell()
        .open(path, None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn save_artifact(
    app: AppHandle,
    core: State<'_, CoreBridge>,
    session_id: String,
    artifact_id: String,
    name: String,
) -> Result<Value, String> {
    let file_name = Path::new(&name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The generated file name is invalid.".to_owned())?;
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Save generated file")
        .set_file_name(file_name)
        .blocking_save_file()
    else {
        return Ok(json!({ "saved": false }));
    };
    let path = selection.into_path().map_err(|error| error.to_string())?;
    core.call(
        "artifacts.export",
        json!({
            "sessionId": session_id,
            "artifactId": artifact_id,
            "destination": crate::path_text(&path)?,
        }),
    )?;
    Ok(json!({ "saved": true }))
}
