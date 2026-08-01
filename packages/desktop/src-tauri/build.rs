use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

fn sha256(path: &Path) -> String {
    let mut file = File::open(path).expect("failed to open packaged runtime input");
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .expect("failed to read packaged runtime input");
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let digest = digest.finalize();
    format!("{digest:x}")
}

fn anchor_windows_package() {
    if std::env::var("PROFILE").as_deref() != Ok("release")
        || std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows")
    {
        return;
    }
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("missing manifest root"));
    let manifest = root.join("resources/core/resource-manifest.json");
    let sidecar = root.join("binaries/vault-core-x86_64-pc-windows-msvc.exe");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rerun-if-changed={}", sidecar.display());
    println!(
        "cargo:rustc-env=VAULT_RESOURCE_MANIFEST_SHA256={}",
        sha256(&manifest)
    );
    println!("cargo:rustc-env=VAULT_SIDECAR_SHA256={}", sha256(&sidecar));
}

fn build_desktop() {
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

fn main() {
    anchor_windows_package();
    build_desktop();
}
