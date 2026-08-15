use super::open_verified;
use serde_json::Value;
use std::collections::HashSet;
use std::fs::File;
use std::path::{Component, Path};

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

pub(super) fn expected_resource_hash(manifest: &Value, required: &str) -> Result<String, String> {
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

pub(super) fn lock_prompt_resources(
    core_resources: &Path,
    manifest: &Value,
) -> Result<Vec<File>, String> {
    lock_resource_prefix(core_resources, manifest, "prompts", "prompt")
}

pub(super) fn lock_resource_prefix(
    core_resources: &Path,
    manifest: &Value,
    prefix: &str,
    label: &str,
) -> Result<Vec<File>, String> {
    let entries = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| "Packaged resource manifest is invalid.".to_owned())?;
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for entry in entries {
        let Some(relative_text) = entry.get("path").and_then(Value::as_str) else {
            continue;
        };
        let relative = safe_relative_path(relative_text)?;
        if !relative.starts_with(Path::new(prefix)) {
            continue;
        }
        let expected = entry
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| "Packaged resource manifest entry is invalid.".to_owned())?;
        if !seen.insert(relative.to_path_buf()) {
            return Err(format!(
                "Packaged resource manifest contains a duplicate {label} path."
            ));
        }
        files.push(open_verified(&core_resources.join(relative), expected)?);
    }
    if files.is_empty() {
        return Err(format!(
            "Packaged resource manifest contains no {label} assets."
        ));
    }
    Ok(files)
}
