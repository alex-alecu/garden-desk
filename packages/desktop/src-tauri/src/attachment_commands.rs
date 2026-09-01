use crate::CoreBridge;
use serde_json::{Value, json};
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub(crate) async fn add_dropped_files(
    core: State<'_, CoreBridge>,
    session_id: String,
    paths: Vec<String>,
) -> Result<Value, String> {
    for path in &paths {
        if !Path::new(path)
            .metadata()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("Only files can be dropped on the chat input.".to_owned());
        }
    }
    let mut attachments = Vec::new();
    for path in paths {
        attachments.push(core.call(
            "attachments.add",
            json!({ "sessionId": session_id, "path": path }),
        )?);
    }
    Ok(Value::Array(attachments))
}

#[allow(deprecated)]
#[tauri::command]
pub(crate) async fn open_attachment(
    app: AppHandle,
    core: State<'_, CoreBridge>,
    session_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let path = core.call(
        "attachments.materialize",
        json!({ "sessionId": session_id, "attachmentId": attachment_id }),
    )?;
    let path = path
        .as_str()
        .ok_or_else(|| "Garden Desk Core returned an invalid attachment path.".to_owned())?;
    app.shell()
        .open(path, None)
        .map_err(|error| error.to_string())
}
