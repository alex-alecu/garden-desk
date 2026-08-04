use crate::probe::pipe_security;
use crate::security::{Handle, Pointer, invalid_handle, last_error, wide};
use std::error::Error;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::ptr::null_mut;
use std::time::Duration;

const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const READ_CONTROL: u32 = 0x0002_0000;
const OPEN_EXISTING: u32 = 3;
const ERROR_BROKEN_PIPE: u32 = 109;
const ERROR_NO_DATA: u32 = 232;
const ERROR_PIPE_NOT_CONNECTED: u32 = 233;
const ERROR_FILE_NOT_FOUND: u32 = 2;
const ERROR_PIPE_BUSY: u32 = 231;
const BUFFER_BYTES: usize = 65_536;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateFileW(
        name: *const u16,
        access: u32,
        share: u32,
        security: Pointer,
        creation: u32,
        flags: u32,
        template: Pointer,
    ) -> Pointer;
    fn ReadFile(
        pipe: Pointer,
        buffer: Pointer,
        bytes: u32,
        read: *mut u32,
        overlapped: Pointer,
    ) -> i32;
    fn WriteFile(
        pipe: Pointer,
        buffer: Pointer,
        bytes: u32,
        written: *mut u32,
        overlapped: Pointer,
    ) -> i32;
    fn GetLastError() -> u32;
    fn WaitNamedPipeW(name: *const u16, timeout: u32) -> i32;
}

fn connect(endpoint: &str) -> Result<Handle, Box<dyn Error>> {
    let endpoint = wide(OsStr::new(endpoint));
    for _ in 0..100 {
        let pipe = unsafe {
            CreateFileW(
                endpoint.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
                0,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if pipe != invalid_handle() {
            return Handle::new(pipe, "daemon pipe open");
        }
        let error = unsafe { GetLastError() };
        if error == ERROR_FILE_NOT_FOUND {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }
        if error != ERROR_PIPE_BUSY {
            return Err(last_error("daemon pipe open"));
        }
        unsafe { WaitNamedPipeW(endpoint.as_ptr(), 50) };
    }
    Err(last_error("daemon pipe open"))
}

fn write_all(pipe: Pointer, mut bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    while !bytes.is_empty() {
        let mut written = 0;
        if unsafe {
            WriteFile(
                pipe,
                bytes.as_ptr().cast_mut().cast(),
                bytes.len() as u32,
                &mut written,
                null_mut(),
            )
        } == 0
        {
            return Err(format!(
                "daemon pipe write failed: {}",
                std::io::Error::last_os_error()
            )
            .into());
        }
        if written == 0 {
            return Err("daemon pipe write returned zero bytes".into());
        }
        bytes = &bytes[written as usize..];
    }
    Ok(())
}

fn read_response(pipe: Pointer, maximum_bytes: usize) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut response = Vec::new();
    let mut buffer = [0_u8; BUFFER_BYTES];
    loop {
        let mut read = 0;
        if unsafe {
            ReadFile(
                pipe,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                &mut read,
                null_mut(),
            )
        } == 0
        {
            let error = unsafe { GetLastError() };
            if matches!(
                error,
                ERROR_BROKEN_PIPE | ERROR_NO_DATA | ERROR_PIPE_NOT_CONNECTED
            ) {
                return Ok(response);
            }
            return Err(format!("daemon pipe read failed with {error}").into());
        }
        if read == 0 {
            return Ok(response);
        }
        if response.len().saturating_add(read as usize) > maximum_bytes {
            return Err("daemon response exceeded its limit".into());
        }
        response.extend_from_slice(&buffer[..read as usize]);
    }
}

pub fn request(endpoint: &str, maximum_bytes: usize) -> Result<(), Box<dyn Error>> {
    if maximum_bytes == 0 {
        return Err("maximum request bytes must be positive".into());
    }
    let mut request = Vec::new();
    std::io::stdin()
        .take((maximum_bytes + 1) as u64)
        .read_to_end(&mut request)?;
    if request.is_empty() || request.len() > maximum_bytes {
        return Err("daemon request exceeded its limit".into());
    }
    let pipe = connect(endpoint)?;
    if !pipe_security(pipe.0)?.current_user_owned_and_only {
        return Err("daemon endpoint is not restricted to the current user".into());
    }
    write_all(pipe.0, &request)?;
    std::io::stdout().write_all(&read_response(pipe.0, maximum_bytes)?)?;
    Ok(())
}
