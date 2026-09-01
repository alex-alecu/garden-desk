use super::*;
use std::fs::{create_dir, create_dir_all, remove_dir_all, write};
use std::time::{SystemTime, UNIX_EPOCH};

fn temporary_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("garden-desk-prompt-integrity-{nonce}"));
    create_dir(&root).expect("temporary root");
    root
}

#[test]
fn verifies_every_packaged_prompt_asset() {
    let root = temporary_root();
    let prompts = root.join("prompts/system");
    create_dir_all(&prompts).expect("prompt resources");
    let path = prompts.join("agent.md");
    write(&path, b"trusted prompt").expect("fixture");
    let expected = file_sha256(&mut File::open(&path).expect("fixture")).expect("hash");
    let manifest = serde_json::json!({
        "files": [{"path": "prompts/system/agent.md", "sha256": expected}]
    });
    drop(lock_prompt_resources(&root, &manifest).expect("valid prompt"));
    write(&path, b"tampered prompt").expect("tamper");
    assert!(lock_prompt_resources(&root, &manifest).is_err());
    remove_dir_all(root).expect("cleanup");
}
