#[cfg(any(windows, test))]
use serde_json::Value;
#[cfg(any(windows, test))]
use sha2::{Digest, Sha256};
#[cfg(any(windows, test))]
use std::fs::{File, OpenOptions};
#[cfg(any(windows, test))]
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
#[cfg(any(windows, test))]
use std::path::PathBuf;

#[cfg(any(windows, test))]
#[path = "package_integrity_resources.rs"]
mod resources;
#[cfg(any(windows, test))]
use resources::{expected_resource_hash, lock_prompt_resources, lock_resource_prefix};

#[cfg(windows)]
const ELEVATED_RESOURCES: [&str; 3] = [
    "garden-desk-pipe-guard.exe",
    "inference/garden-desk-appcontainer-launcher.exe",
    "workers/garden-desk-hcs-helper.exe",
];

pub(crate) struct PackageLocks {
    #[cfg(windows)]
    _files: Vec<File>,
}

#[cfg(any(windows, test))]
pub(crate) struct LockedSetupHelper {
    path: PathBuf,
    _files: Vec<File>,
}

#[cfg(any(windows, test))]
impl LockedSetupHelper {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(any(windows, test))]
fn open_read_locked(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    options.open(path).map_err(|error| error.to_string())
}

#[cfg(any(windows, test))]
fn file_sha256(file: &mut File) -> Result<String, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let digest = digest.finalize();
    Ok(format!("{digest:x}"))
}

#[cfg(any(windows, test))]
fn open_verified(path: &Path, expected: &str) -> Result<File, String> {
    let mut file = open_read_locked(path)?;
    if file_sha256(&mut file)? != expected {
        return Err(format!(
            "Packaged runtime integrity check failed: {}",
            path.display()
        ));
    }
    Ok(file)
}

#[cfg(windows)]
pub(crate) fn lock_packaged_runtime(
    resource_root: &Path,
    core_resources: &Path,
) -> Result<PackageLocks, String> {
    if cfg!(debug_assertions) {
        return Ok(PackageLocks { _files: Vec::new() });
    }
    let manifest_hash = option_env!("GARDEN_DESK_RESOURCE_MANIFEST_SHA256")
        .ok_or_else(|| "Release package integrity anchor is missing.".to_owned())?;
    let sidecar_hash = option_env!("GARDEN_DESK_SIDECAR_SHA256")
        .ok_or_else(|| "Release sidecar integrity anchor is missing.".to_owned())?;
    let mut files = vec![open_verified(
        &resource_root.join("garden-desk-core.exe"),
        sidecar_hash,
    )?];
    let manifest_path = core_resources.join("resource-manifest.json");
    let mut manifest_file = open_verified(&manifest_path, manifest_hash)?;
    manifest_file
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let manifest: Value = serde_json::from_reader(&mut manifest_file)
        .map_err(|_| "Packaged resource manifest is invalid.".to_owned())?;
    files.push(manifest_file);
    files.extend(lock_prompt_resources(core_resources, &manifest)?);
    files.extend(lock_resource_prefix(
        core_resources,
        &manifest,
        "inference",
        "inference",
    )?);
    for relative in ELEVATED_RESOURCES {
        let expected = expected_resource_hash(&manifest, relative)?;
        files.push(open_verified(&core_resources.join(relative), &expected)?);
    }
    Ok(PackageLocks { _files: files })
}

#[cfg(any(windows, test))]
fn lock_setup_helper_with_manifest(
    core_resources: &Path,
    manifest_hash: &str,
) -> Result<LockedSetupHelper, String> {
    let path = core_resources.join("windows/garden-desk-hyper-v-setup.exe");
    let manifest_path = core_resources.join("resource-manifest.json");
    let mut manifest_file = open_verified(&manifest_path, manifest_hash)?;
    manifest_file
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let manifest: Value = serde_json::from_reader(&mut manifest_file)
        .map_err(|_| "Packaged resource manifest is invalid.".to_owned())?;
    let expected = expected_resource_hash(&manifest, "windows/garden-desk-hyper-v-setup.exe")?;
    Ok(LockedSetupHelper {
        _files: vec![manifest_file, open_verified(&path, &expected)?],
        path,
    })
}

#[cfg(windows)]
pub(crate) fn lock_windows_setup_helper(
    core_resources: &Path,
) -> Result<LockedSetupHelper, String> {
    let manifest_hash = option_env!("GARDEN_DESK_RESOURCE_MANIFEST_SHA256")
        .ok_or_else(|| "Windows package integrity anchor is missing.".to_owned())?;
    lock_setup_helper_with_manifest(core_resources, manifest_hash)
}

#[cfg(not(windows))]
pub(crate) fn lock_packaged_runtime(_: &Path, _: &Path) -> Result<PackageLocks, String> {
    Ok(PackageLocks {})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir, remove_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("garden-desk-package-integrity-{nonce}"));
        create_dir(&root).expect("temporary root");
        root
    }

    #[test]
    fn rejects_a_tampered_file() {
        let root = temporary_root();
        let path = root.join("helper.exe");
        write(&path, b"trusted").expect("fixture");
        let expected = file_sha256(&mut File::open(&path).expect("fixture")).expect("hash");
        write(&path, b"tampered").expect("tamper");
        assert!(open_verified(&path, &expected).is_err());
        remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn resolves_only_the_named_safe_manifest_entry() {
        let manifest = serde_json::json!({
            "files": [
                {"path": "workers/garden-desk-hcs-helper.exe", "sha256": "abc"},
                {"path": "../outside.exe", "sha256": "def"}
            ]
        });
        assert_eq!(
            expected_resource_hash(&manifest, "workers/garden-desk-hcs-helper.exe").expect("hash"),
            "abc"
        );
        assert!(expected_resource_hash(&manifest, "outside.exe").is_err());
    }

    #[test]
    fn rejects_tampered_windows_setup_bytes_from_the_manifest_contract() {
        let root = temporary_root();
        let windows = root.join("windows");
        create_dir(&windows).expect("windows resources");
        let path = windows.join("garden-desk-hyper-v-setup.exe");
        write(&path, b"signed setup").expect("fixture");
        let expected = file_sha256(&mut File::open(&path).expect("fixture")).expect("hash");
        let manifest = serde_json::json!({
            "files": [{
                "path": "windows/garden-desk-hyper-v-setup.exe",
                "sha256": expected
            }]
        });
        let manifest_path = root.join("resource-manifest.json");
        write(&manifest_path, manifest.to_string()).expect("manifest");
        let manifest_hash =
            file_sha256(&mut File::open(&manifest_path).expect("manifest")).expect("hash");
        drop(lock_setup_helper_with_manifest(&root, &manifest_hash).expect("valid helper"));
        write(&path, b"substituted setup").expect("tamper");
        assert!(lock_setup_helper_with_manifest(&root, &manifest_hash).is_err());
        std::fs::remove_file(&path).expect("remove helper");
        assert!(lock_setup_helper_with_manifest(&root, &manifest_hash).is_err());
        remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn locks_every_image_runtime_file_from_the_manifest() {
        let root = temporary_root();
        let vision = root.join("inference").join("vision");
        std::fs::create_dir_all(&vision).expect("vision resources");
        let executable = vision.join("llama-mtmd-cli.exe");
        let library = vision.join("mtmd.dll");
        write(&executable, b"runtime").expect("runtime fixture");
        write(&library, b"library").expect("library fixture");
        let runtime_hash =
            file_sha256(&mut File::open(&executable).expect("runtime")).expect("hash");
        let library_hash = file_sha256(&mut File::open(&library).expect("library")).expect("hash");
        let manifest = serde_json::json!({
            "files": [
                {"path": "inference/vision/llama-mtmd-cli.exe", "sha256": runtime_hash},
                {"path": "inference/vision/mtmd.dll", "sha256": library_hash}
            ]
        });
        let locks = lock_resource_prefix(&root, &manifest, "inference/vision", "inference")
            .expect("valid runtime");
        assert_eq!(locks.len(), 2);
        remove_dir_all(root).expect("cleanup");
    }
}

#[cfg(test)]
#[path = "package_integrity_prompt_tests.rs"]
mod prompt_tests;
