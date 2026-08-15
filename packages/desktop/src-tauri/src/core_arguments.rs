use super::path_text;
use std::path::Path;

#[cfg(windows)]
pub(crate) fn add_platform_arguments(
    arguments: &mut Vec<String>,
    core_resources: &Path,
) -> Result<(), String> {
    arguments.extend([
        "--windows-pipe-guard".to_owned(),
        path_text(&core_resources.join("vault-pipe-guard.exe"))?,
        "--worker-entry".to_owned(),
        path_text(&core_resources.join("inference/worker.mjs"))?,
        "--inference-runtime".to_owned(),
        path_text(&core_resources.join("inference/node.exe"))?,
        "--inference-helper".to_owned(),
        path_text(&core_resources.join("inference/vault-appcontainer-launcher.exe"))?,
        "--vision-runtime".to_owned(),
        path_text(&core_resources.join("inference/vision/llama-mtmd-cli.exe"))?,
        "--agent-helper".to_owned(),
        path_text(&core_resources.join("workers/vault-hcs-helper.exe"))?,
        "--agent-image-root".to_owned(),
        path_text(&core_resources.join("workers/images"))?,
        "--packaged-model-store".to_owned(),
    ]);
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn add_platform_arguments(
    arguments: &mut Vec<String>,
    core_resources: &Path,
) -> Result<(), String> {
    arguments.extend([
        "--worker-entry".to_owned(),
        path_text(&core_resources.join("inference/worker.mjs"))?,
        "--inference-runtime".to_owned(),
        path_text(&core_resources.join("inference/node"))?,
        "--vision-runtime".to_owned(),
        path_text(&core_resources.join("inference/vision/llama-mtmd-cli"))?,
        "--agent-helper".to_owned(),
        path_text(&core_resources.join("workers/vault-vz-helper"))?,
        "--agent-image-root".to_owned(),
        path_text(&core_resources.join("workers/images"))?,
        "--packaged-model-store".to_owned(),
    ]);
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn add_platform_arguments(_: &mut Vec<String>, _: &Path) -> Result<(), String> {
    Ok(())
}
