use std::ffi::{OsStr, c_void};
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

type Handle = *mut c_void;

const ERROR_CANCELLED: u32 = 1223;
const ALREADY_MEMBER_EXIT_CODE: u32 = 2;
const SEE_MASK_NOCLOSEPROCESS: u32 = 0x0000_0040;
const WAIT_FAILED: u32 = 0xffff_ffff;

#[repr(C)]
struct ShellExecuteInfoW {
    size: u32,
    mask: u32,
    window: Handle,
    verb: *const u16,
    file: *const u16,
    parameters: *const u16,
    directory: *const u16,
    show: i32,
    instance: Handle,
    id_list: *mut c_void,
    class: *const u16,
    class_key: Handle,
    hot_key: u32,
    icon_or_monitor: Handle,
    process: Handle,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CloseHandle(handle: Handle) -> i32;
    fn GetLastError() -> u32;
    fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    fn GetExitCodeProcess(process: Handle, exit_code: *mut u32) -> i32;
}

#[link(name = "shell32")]
unsafe extern "system" {
    fn ShellExecuteExW(information: *mut ShellExecuteInfoW) -> i32;
}

struct OwnedHandle(Handle);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn last_error(action: &str) -> String {
    format!("{action} failed with Windows error {}.", unsafe {
        GetLastError()
    })
}

pub(crate) enum ElevationResult {
    Added,
    AlreadyMember,
    Cancelled,
}

fn launch_error(error: u32) -> Result<ElevationResult, String> {
    if error == ERROR_CANCELLED {
        Ok(ElevationResult::Cancelled)
    } else {
        Err(format!(
            "Starting Windows secure workspace setup failed with Windows error {error}."
        ))
    }
}

fn completion_result(exit_code: u32) -> Result<ElevationResult, String> {
    match exit_code {
        0 => Ok(ElevationResult::Added),
        ALREADY_MEMBER_EXIT_CODE => Ok(ElevationResult::AlreadyMember),
        _ => Err("Windows could not grant Hyper-V Administrators access.".to_owned()),
    }
}

pub(crate) fn run_elevated(path: &Path, requester_pid: u32) -> Result<ElevationResult, String> {
    let verb = wide(OsStr::new("runas"));
    let file = wide(path.as_os_str());
    let parameters = wide(OsStr::new(&format!("--requester-pid {requester_pid}")));
    let mut information: ShellExecuteInfoW = unsafe { zeroed() };
    information.size = size_of::<ShellExecuteInfoW>() as u32;
    information.mask = SEE_MASK_NOCLOSEPROCESS;
    information.verb = verb.as_ptr();
    information.file = file.as_ptr();
    information.parameters = parameters.as_ptr();
    information.show = 1;
    if unsafe { ShellExecuteExW(&mut information) } == 0 {
        return launch_error(unsafe { GetLastError() });
    }
    if information.process.is_null() {
        return Err("Windows returned no secure workspace setup process.".to_owned());
    }
    let process = OwnedHandle(information.process);
    if unsafe { WaitForSingleObject(process.0, u32::MAX) } == WAIT_FAILED {
        return Err(last_error("Waiting for Windows secure workspace setup"));
    }
    let mut exit_code = 1;
    if unsafe { GetExitCodeProcess(process.0, &mut exit_code) } == 0 {
        return Err(last_error("Reading Windows secure workspace setup result"));
    }
    completion_result(exit_code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_uac_cancellation_from_launch_failure() {
        assert!(matches!(
            launch_error(ERROR_CANCELLED),
            Ok(ElevationResult::Cancelled)
        ));
        assert!(launch_error(5).is_err());
    }

    #[test]
    fn distinguishes_addition_existing_membership_and_helper_failure() {
        assert!(matches!(completion_result(0), Ok(ElevationResult::Added)));
        assert!(matches!(
            completion_result(ALREADY_MEMBER_EXIT_CODE),
            Ok(ElevationResult::AlreadyMember)
        ));
        assert!(completion_result(1).is_err());
    }
}
