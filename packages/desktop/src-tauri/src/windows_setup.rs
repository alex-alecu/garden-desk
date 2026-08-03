use serde::Serialize;
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Manager;

#[cfg(windows)]
use crate::package_integrity;

#[cfg(windows)]
use crate::windows_setup_windows as native;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SecureWorkspaceState {
    Ready,
    PermissionRequired,
    SignOutRequired,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecureWorkspaceStatus {
    pub(crate) state: SecureWorkspaceState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) enum SetupOutcome {
    Completed,
    ExistingMembership,
    Cancelled,
    NotNeeded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupResult {
    outcome: SetupOutcome,
    status: SecureWorkspaceStatus,
}

fn classify(available: bool, active: bool, recorded: bool) -> SecureWorkspaceStatus {
    let state = if !available {
        SecureWorkspaceState::Unavailable
    } else if active {
        SecureWorkspaceState::Ready
    } else if recorded {
        SecureWorkspaceState::SignOutRequired
    } else {
        SecureWorkspaceState::PermissionRequired
    };
    SecureWorkspaceStatus { state }
}

#[cfg(windows)]
pub(crate) fn status() -> Result<SecureWorkspaceStatus, String> {
    if !native::hyper_v_available()? {
        return Ok(classify(false, false, false));
    }
    Ok(classify(
        true,
        native::token_has_hyper_v_access()?,
        native::account_has_hyper_v_membership()?,
    ))
}

#[cfg(not(windows))]
pub(crate) fn status() -> Result<SecureWorkspaceStatus, String> {
    Ok(classify(true, true, true))
}

pub(crate) fn require_ready() -> Result<(), String> {
    if status()?.state == SecureWorkspaceState::Ready {
        Ok(())
    } else {
        Err("Set up the secure workspace before starting a new task.".to_owned())
    }
}

#[tauri::command]
pub(crate) async fn secure_workspace_status() -> Result<SecureWorkspaceStatus, String> {
    status()
}

#[cfg(windows)]
fn run_setup(app: &AppHandle) -> Result<SetupOutcome, String> {
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let core_resources = resource_root.join("resources/core");
    let helper = package_integrity::lock_windows_setup_helper(&core_resources)?;
    match native::run_elevated(helper.path(), std::process::id())? {
        native::ElevationResult::Added => Ok(SetupOutcome::Completed),
        native::ElevationResult::AlreadyMember => Ok(SetupOutcome::ExistingMembership),
        native::ElevationResult::Cancelled => Ok(SetupOutcome::Cancelled),
    }
}

#[cfg(not(windows))]
fn run_setup(_: &AppHandle) -> Result<SetupOutcome, String> {
    Ok(SetupOutcome::NotNeeded)
}

#[tauri::command]
pub(crate) async fn configure_secure_workspace(app: AppHandle) -> Result<SetupResult, String> {
    let before = status()?;
    if before.state != SecureWorkspaceState::PermissionRequired {
        return Ok(SetupResult {
            outcome: SetupOutcome::NotNeeded,
            status: before,
        });
    }
    let outcome = run_setup(&app)?;
    Ok(SetupResult {
        outcome,
        status: status()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_state_requires_available_hyper_v() {
        assert_eq!(
            classify(false, true, true).state,
            SecureWorkspaceState::Unavailable
        );
    }

    #[test]
    fn setup_state_distinguishes_active_and_pending_membership() {
        assert_eq!(
            classify(true, true, true).state,
            SecureWorkspaceState::Ready
        );
        assert_eq!(
            classify(true, false, true).state,
            SecureWorkspaceState::SignOutRequired
        );
        assert_eq!(
            classify(true, false, false).state,
            SecureWorkspaceState::PermissionRequired
        );
    }
}
