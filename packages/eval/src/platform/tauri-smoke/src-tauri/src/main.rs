use tauri::{AppHandle, Listener};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn launch_test_sidecar(app: AppHandle) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("garden-desk-m0-sidecar")
        .map_err(|error| error.to_string())?;
    let output = sidecar.output().await.map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("The fixed capability sidecar failed.".to_owned());
    }
    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![launch_test_sidecar])
        .setup(|app| {
            app.listen("m0-runtime-evidence", |event| {
                println!("{}", event.payload());
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("M0 Tauri capability shell failed");
}
