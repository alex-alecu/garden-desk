use crate::sandbox::Pointer;
use crate::win32::*;
use std::error::Error;
use std::ffi::OsStr;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::null_mut;

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn quote(value: &str) -> String {
    let mut quoted = String::from("\"");
    let mut backslashes = 0;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
        } else {
            quoted.push_str(&"\\".repeat(if character == '"' {
                backslashes * 2 + 1
            } else {
                backslashes
            }));
            quoted.push(character);
            backslashes = 0;
        }
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

fn command_line(executable: &Path, arguments: &[String]) -> Vec<u16> {
    let mut value = quote(&executable.to_string_lossy());
    for argument in arguments {
        value.push(' ');
        value.push_str(&quote(argument));
    }
    wide(OsStr::new(&value))
}

fn environment(scratch: &Path, profile: &Path) -> Vec<u16> {
    let windows = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_owned());
    let scratch = scratch.to_string_lossy();
    let drive = scratch.get(..2).unwrap_or("C:");
    let mut values = [
        format!("={drive}={scratch}"),
        format!("HOME={scratch}"),
        format!("APPDATA={}", profile.display()),
        format!("LOCALAPPDATA={}", profile.display()),
        format!("TEMP={scratch}"),
        format!("TMP={scratch}"),
        format!("USERPROFILE={scratch}"),
        format!("WINDIR={windows}"),
        format!("SystemRoot={windows}"),
        format!("PATH={windows}\\System32"),
        "NODE_NO_WARNINGS=1".to_owned(),
        "NODE_LLAMA_CPP_SKIP_DOWNLOAD=true".to_owned(),
        "LLAMA_ARG_OFFLINE=1".to_owned(),
        "VAULT_APPCONTAINER_LOCKED=1".to_owned(),
    ];
    values.sort_by_key(|value| value.to_ascii_uppercase());
    values.join("\0").encode_utf16().chain([0, 0]).collect()
}

fn startup(attributes: Pointer) -> StartupInfoEx {
    let mut startup: StartupInfoEx = unsafe { zeroed() };
    startup.startup.cb = size_of::<StartupInfoEx>() as u32;
    startup.startup.flags = STARTF_USESTDHANDLES;
    startup.startup.stdin = unsafe { GetStdHandle((-10_i32) as u32) };
    startup.startup.stdout = unsafe { GetStdHandle((-11_i32) as u32) };
    startup.startup.stderr = unsafe { GetStdHandle((-12_i32) as u32) };
    startup.attributes = attributes;
    startup
}

fn create_process(
    executable: &Path,
    arguments: &[String],
    scratch: &Path,
    profile: &Path,
    startup: &mut StartupInfoEx,
) -> Result<ProcessInformation, Box<dyn Error>> {
    let mut information: ProcessInformation = unsafe { zeroed() };
    let mut command = command_line(executable, arguments);
    let mut environment = environment(scratch, profile);
    let application = wide(executable.as_os_str());
    let directory = wide(scratch.as_os_str());
    let flags = EXTENDED_STARTUPINFO_PRESENT
        | CREATE_UNICODE_ENVIRONMENT
        | CREATE_SUSPENDED
        | CREATE_NO_WINDOW;
    if unsafe {
        CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            null_mut(),
            null_mut(),
            1,
            flags,
            environment.as_mut_ptr().cast(),
            directory.as_ptr(),
            &mut startup.startup,
            &mut information,
        )
    } == 0
    {
        return Err(last_error("sandboxed process creation"));
    }
    Ok(information)
}

pub(crate) fn run_sandboxed(
    executable: &Path,
    arguments: &[String],
    scratch: &Path,
    memory_bytes: usize,
    sid: Pointer,
    profile: &Path,
) -> Result<i32, Box<dyn Error>> {
    let mut capabilities = SecurityCapabilities {
        app_container_sid: sid,
        capabilities: null_mut(),
        capability_count: 0,
        reserved: 0,
    };
    let mut attributes = AttributeList::new(1)?;
    attributes.update(ATTRIBUTE_SECURITY_CAPABILITIES, &mut capabilities)?;
    let mut startup = startup(attributes.pointer());
    let information = create_process(executable, arguments, scratch, profile, &mut startup)?;
    let process = Handle::new(information.process, "sandboxed process")?;
    let thread = Handle::new(information.thread, "sandboxed process thread")?;
    let job = job(memory_bytes)?;
    if unsafe { AssignProcessToJobObject(job.pointer(), process.pointer()) } == 0 {
        unsafe { TerminateProcess(process.pointer(), 1) };
        return Err(last_error("sandbox job assignment"));
    }
    if unsafe { ResumeThread(thread.pointer()) } == u32::MAX {
        return Err(last_error("sandboxed process resume"));
    }
    unsafe { WaitForSingleObject(process.pointer(), INFINITE) };
    let mut exit_code = 1;
    if unsafe { GetExitCodeProcess(process.pointer(), &mut exit_code) } == 0 {
        return Err(last_error("sandboxed process exit query"));
    }
    drop(job);
    Ok(exit_code as i32)
}
