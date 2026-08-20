use std::error::Error;
use std::ffi::{OsStr, c_void};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::ptr::null_mut;

pub(crate) type Pointer = *mut c_void;
const ALREADY_EXISTS: u32 = 0x8007_00b7;

#[link(name = "userenv")]
unsafe extern "system" {
    fn CreateAppContainerProfile(
        name: *const u16,
        display_name: *const u16,
        description: *const u16,
        capabilities: Pointer,
        capability_count: u32,
        sid: *mut Pointer,
    ) -> i32;
    fn DeriveAppContainerSidFromAppContainerName(name: *const u16, sid: *mut Pointer) -> i32;
    fn GetAppContainerFolderPath(sid: *const u16, path: *mut *mut u16) -> i32;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn ConvertSidToStringSidW(sid: Pointer, text: *mut *mut u16) -> i32;
    fn FreeSid(sid: Pointer) -> Pointer;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LocalFree(memory: Pointer) -> Pointer;
}

#[link(name = "ole32")]
unsafe extern "system" {
    fn CoTaskMemFree(memory: Pointer);
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn wide_text(value: *const u16) -> String {
    let mut length = 0;
    unsafe {
        while *value.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(value, length))
    }
}

struct LocalMemory(Pointer);

fn has_read_execute_grant(output: &[u8], sid: &str) -> bool {
    let identity = format!("{sid}:");
    String::from_utf8_lossy(output).lines().any(|line| {
        let Some((_, permissions)) = line.rsplit_once(&identity) else {
            return false;
        };
        permissions.starts_with("(RX)") || permissions.starts_with("(I)(RX)")
    })
}

impl Drop for LocalMemory {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

struct SidMemory(Pointer);

impl Drop for SidMemory {
    fn drop(&mut self) {
        unsafe { FreeSid(self.0) };
    }
}

pub(crate) struct AppContainer {
    sid: SidMemory,
    sid_text: String,
}

impl AppContainer {
    pub(crate) fn open(name: &str) -> Result<Self, Box<dyn Error>> {
        let name = wide(OsStr::new(name));
        let display = wide(OsStr::new("Vault Desk M2 Inference"));
        let description = wide(OsStr::new("Networkless native inference worker"));
        let mut sid = null_mut();
        let result = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                display.as_ptr(),
                description.as_ptr(),
                null_mut(),
                0,
                &mut sid,
            )
        };
        if result < 0 && result as u32 != ALREADY_EXISTS {
            return Err(format!("AppContainer profile creation failed: {result:#x}").into());
        }
        if sid.is_null()
            && unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) } < 0
        {
            return Err("AppContainer SID derivation failed.".into());
        }
        let sid = SidMemory(sid);
        let mut text = null_mut();
        if unsafe { ConvertSidToStringSidW(sid.0, &mut text) } == 0 {
            return Err(format!(
                "AppContainer SID conversion failed: {}",
                std::io::Error::last_os_error()
            )
            .into());
        }
        let text = LocalMemory(text.cast());
        Ok(Self {
            sid,
            sid_text: wide_text(text.0.cast()),
        })
    }

    pub(crate) fn sid(&self) -> Pointer {
        self.sid.0
    }

    pub(crate) fn profile_path(&self) -> Result<PathBuf, Box<dyn Error>> {
        let sid = wide(OsStr::new(&self.sid_text));
        let mut path = null_mut();
        if unsafe { GetAppContainerFolderPath(sid.as_ptr(), &mut path) } < 0 {
            return Err("AppContainer profile path query failed.".into());
        }
        let value = PathBuf::from(wide_text(path));
        unsafe { CoTaskMemFree(path.cast()) };
        Ok(value)
    }

    fn grant(
        &self,
        path: &Path,
        permission: &str,
        recursive: bool,
        replace: bool,
    ) -> Result<(), Box<dyn Error>> {
        let windows = std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into());
        let executable = Path::new(&windows).join("System32").join("icacls.exe");
        let grant = format!("*{}:{permission}", self.sid_text);
        let mut command = Command::new(executable);
        command
            .arg(path)
            .args([if replace { "/grant:r" } else { "/grant" }, &grant]);
        if recursive {
            command.args(["/T", "/C"]);
        }
        let status = command
            .arg("/Q")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if !status.success() {
            return Err(format!("AppContainer ACL grant failed for {}.", path.display()).into());
        }
        Ok(())
    }

    fn read_execute_grant_exists(&self, path: &Path) -> Result<bool, Box<dyn Error>> {
        let windows = std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into());
        let executable = Path::new(&windows).join("System32").join("icacls.exe");
        let output = Command::new(executable)
            .arg(path)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()?;
        Ok(output.status.success() && has_read_execute_grant(&output.stdout, &self.sid_text))
    }

    pub(crate) fn grant_runtime_read(&self, path: &Path) -> Result<(), Box<dyn Error>> {
        let path = path.canonicalize()?;
        if self.read_execute_grant_exists(&path)? {
            return Ok(());
        }
        let directory = path.is_dir();
        self.grant(&path, "(RX)", directory, true)?;
        if directory {
            self.grant(&path, "(OI)(CI)(RX)", false, false)?;
        }
        Ok(())
    }

    pub(crate) fn grant_file_read(&self, path: &Path) -> Result<(), Box<dyn Error>> {
        if self.read_execute_grant_exists(path)? {
            return Ok(());
        }
        self.grant(path, "(RX)", false, true)
    }

    pub(crate) fn grant_scratch(&self, path: &Path) -> Result<(), Box<dyn Error>> {
        self.grant(path, "(OI)(CI)(F)", false, true)
    }
}

#[cfg(test)]
mod tests {
    use super::has_read_execute_grant;

    const SID: &str = "S-1-15-2-123";

    #[test]
    fn accepts_direct_and_inherited_read_execute_grants() {
        assert!(has_read_execute_grant(b"file S-1-15-2-123:(RX)\r\n", SID));
        assert!(has_read_execute_grant(
            b"file S-1-15-2-123:(I)(RX)\r\n",
            SID
        ));
    }

    #[test]
    fn rejects_other_or_denied_grants() {
        assert!(!has_read_execute_grant(b"file S-1-15-2-456:(RX)\r\n", SID));
        assert!(!has_read_execute_grant(
            b"file S-1-15-2-123:(DENY)(RX)\r\n",
            SID
        ));
    }
}
