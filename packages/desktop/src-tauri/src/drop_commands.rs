use serde_json::{Value, json};
use std::path::Path;

#[derive(Debug, PartialEq)]
pub(crate) struct DroppedPaths {
    files: Vec<String>,
    folders: Vec<String>,
}

fn classify_paths(paths: Vec<String>) -> Result<DroppedPaths, String> {
    let mut files = Vec::new();
    let mut folders = Vec::new();
    for path in paths {
        let metadata = Path::new(&path)
            .metadata()
            .map_err(|error| error.to_string())?;
        if metadata.is_file() {
            files.push(path);
        } else if metadata.is_dir() {
            folders.push(path);
        }
    }
    Ok(DroppedPaths { files, folders })
}

#[tauri::command]
pub(crate) async fn classify_dropped_paths(paths: Vec<String>) -> Result<Value, String> {
    let classified = classify_paths(paths)?;
    Ok(json!({ "files": classified.files, "folders": classified.folders }))
}

#[cfg(test)]
mod tests {
    use super::{DroppedPaths, classify_paths};
    use std::fs::{create_dir, remove_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn separates_files_and_folders() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock must follow epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("garden-desk-drop-test-{nonce}"));
        let folder = root.join("workspace");
        let file = root.join("brief.pdf");
        create_dir(&root).expect("temporary root");
        create_dir(&folder).expect("temporary folder");
        write(&file, b"pdf").expect("temporary file");

        let result = classify_paths(vec![
            file.to_string_lossy().into_owned(),
            folder.to_string_lossy().into_owned(),
        ])
        .expect("paths should classify");

        assert_eq!(
            result,
            DroppedPaths {
                files: vec![file.to_string_lossy().into_owned()],
                folders: vec![folder.to_string_lossy().into_owned()],
            }
        );
        remove_dir_all(root).expect("temporary root cleanup");
    }
}
