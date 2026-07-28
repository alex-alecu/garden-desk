#[cfg(any(windows, test))]
use serde_json::Value;
#[cfg(any(windows, test))]
use sha2::{Digest, Sha256};
#[cfg(any(windows, test))]
use std::fs::{File, OpenOptions};
#[cfg(any(windows, test))]
use std::io::{Read, Seek, SeekFrom};
#[cfg(any(windows, test))]
use std::path::Component;
use std::path::Path;

#[cfg(windows)]
const ELEVATED_RESOURCES: [&str; 3] = [
    "vault-pipe-guard.exe",
    "inference/vault-appcontainer-launcher.exe",
    "workers/vault-hcs-helper.exe",
];

pub(crate) struct PackageLocks {
    #[cfg(windows)]
    _files: Vec<File>,
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

#[cfg(any(windows, test))]
fn safe_relative_path(path: &str) -> Result<&Path, String> {
    let relative = Path::new(path);
    if relative.components().next().is_some()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        Ok(relative)
    } else {
        Err("Packaged resource manifest contains an unsafe path.".to_owned())
    }
}

#[cfg(any(windows, test))]
fn expected_resource_hash(manifest: &Value, required: &str) -> Result<String, String> {
    let files = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| "Packaged resource manifest is invalid.".to_owned())?;
    let mut matches = files.iter().filter_map(|entry| {
        let path = entry.get("path")?.as_str()?;
        let hash = entry.get("sha256")?.as_str()?;
        let relative = safe_relative_path(path).ok()?;
        relative
            .components()
            .eq(Path::new(required).components())
            .then(|| hash.to_owned())
    });
    let hash = matches
        .next()
        .ok_or_else(|| format!("Packaged resource manifest is missing {required}."))?;
    if matches.next().is_some() {
        return Err(format!(
            "Packaged resource manifest contains duplicate {required}."
        ));
    }
    Ok(hash)
}

#[cfg(windows)]
pub(crate) fn lock_packaged_runtime(
    resource_root: &Path,
    core_resources: &Path,
) -> Result<PackageLocks, String> {
    if cfg!(debug_assertions) {
        return Ok(PackageLocks { _files: Vec::new() });
    }
    let manifest_hash = option_env!("VAULT_RESOURCE_MANIFEST_SHA256")
        .ok_or_else(|| "Release package integrity anchor is missing.".to_owned())?;
    let sidecar_hash = option_env!("VAULT_SIDECAR_SHA256")
        .ok_or_else(|| "Release sidecar integrity anchor is missing.".to_owned())?;
    let mut files = vec![open_verified(
        &resource_root.join("vault-core.exe"),
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
    for relative in ELEVATED_RESOURCES {
        let expected = expected_resource_hash(&manifest, relative)?;
        files.push(open_verified(&core_resources.join(relative), &expected)?);
    }
    Ok(PackageLocks { _files: files })
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
        let root = std::env::temp_dir().join(format!("vault-package-integrity-{nonce}"));
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
                {"path": "workers/vault-hcs-helper.exe", "sha256": "abc"},
                {"path": "../outside.exe", "sha256": "def"}
            ]
        });
        assert_eq!(
            expected_resource_hash(&manifest, "workers/vault-hcs-helper.exe").expect("hash"),
            "abc"
        );
        assert!(expected_resource_hash(&manifest, "outside.exe").is_err());
    }
}
