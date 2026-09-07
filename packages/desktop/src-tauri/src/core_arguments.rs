use super::path_text;
use std::path::Path;

#[cfg(windows)]
pub(crate) fn add_platform_arguments(
    arguments: &mut Vec<String>,
    core_resources: &Path,
) -> Result<(), String> {
    arguments.extend([
        "--windows-pipe-guard".to_owned(),
        path_text(&core_resources.join("garden-desk-pipe-guard.exe"))?,
        "--inference-runtime".to_owned(),
        path_text(&core_resources.join("inference/windows-cuda-x64/llama-server.exe"))?,
        "--inference-helper".to_owned(),
        path_text(&core_resources.join("inference/garden-desk-appcontainer-launcher.exe"))?,
        "--agent-helper".to_owned(),
        path_text(&core_resources.join("workers/garden-desk-hcs-helper.exe"))?,
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
        "--inference-runtime".to_owned(),
        path_text(&core_resources.join("inference/macos-arm64/llama-server"))?,
        "--agent-helper".to_owned(),
        path_text(&core_resources.join("workers/garden-desk-vz-helper"))?,
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
