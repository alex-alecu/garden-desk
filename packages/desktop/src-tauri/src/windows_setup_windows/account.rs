use std::ffi::{OsStr, c_void};
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};

type Handle = *mut c_void;
type Sid = *mut c_void;

const TOKEN_QUERY: u32 = 0x0008;
const TOKEN_USER_CLASS: u32 = 1;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
const SC_MANAGER_CONNECT: u32 = 0x0001;
const SERVICE_QUERY_STATUS: u32 = 0x0004;

#[repr(C)]
struct SidAndAttributes {
    sid: Sid,
    attributes: u32,
}

#[repr(C)]
struct TokenUser {
    user: SidAndAttributes,
}

#[repr(C)]
struct LocalGroupMembersInfo0 {
    sid: Sid,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentProcess() -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn GetLastError() -> u32;
    fn LocalFree(memory: Handle) -> Handle;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
    fn GetTokenInformation(
        token: Handle,
        information_class: u32,
        information: *mut c_void,
        information_length: u32,
        return_length: *mut u32,
    ) -> i32;
    fn CheckTokenMembership(token: Handle, sid: Sid, member: *mut i32) -> i32;
    fn ConvertStringSidToSidW(text: *const u16, sid: *mut Sid) -> i32;
    fn EqualSid(first: Sid, second: Sid) -> i32;
    fn OpenSCManagerW(machine: *const u16, database: *const u16, access: u32) -> Handle;
    fn OpenServiceW(manager: Handle, service: *const u16, access: u32) -> Handle;
    fn CloseServiceHandle(handle: Handle) -> i32;
    fn LookupAccountSidW(
        system_name: *const u16,
        sid: Sid,
        name: *mut u16,
        name_length: *mut u32,
        domain: *mut u16,
        domain_length: *mut u32,
        sid_type: *mut u32,
    ) -> i32;
}

#[link(name = "netapi32")]
unsafe extern "system" {
    fn NetLocalGroupGetMembers(
        server: *const u16,
        group: *const u16,
        level: u32,
        buffer: *mut *mut u8,
        preferred_length: u32,
        entries_read: *mut u32,
        total_entries: *mut u32,
        resume: *mut usize,
    ) -> u32;
    fn NetApiBufferFree(buffer: *mut c_void) -> u32;
}

struct OwnedHandle(Handle);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

struct ServiceHandle(Handle);

impl Drop for ServiceHandle {
    fn drop(&mut self) {
        unsafe { CloseServiceHandle(self.0) };
    }
}

struct LocalSid(Sid);

impl Drop for LocalSid {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
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

fn group_sid() -> Result<LocalSid, String> {
    let text = wide(OsStr::new("S-1-5-32-578"));
    let mut sid = null_mut();
    if unsafe { ConvertStringSidToSidW(text.as_ptr(), &mut sid) } == 0 {
        return Err(last_error("Resolving Hyper-V Administrators"));
    }
    Ok(LocalSid(sid))
}

fn current_user() -> Result<(OwnedHandle, Vec<usize>), String> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(last_error("Opening the Vault Desk user token"));
    }
    let token = OwnedHandle(token);
    let mut length = 0;
    unsafe { GetTokenInformation(token.0, TOKEN_USER_CLASS, null_mut(), 0, &mut length) };
    if length == 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err("Windows did not report the Vault Desk user token size.".to_owned());
    }
    let mut storage = vec![0_usize; (length as usize).div_ceil(size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.0,
            TOKEN_USER_CLASS,
            storage.as_mut_ptr().cast(),
            length,
            &mut length,
        )
    } == 0
    {
        return Err(last_error("Reading the Vault Desk user token"));
    }
    Ok((token, storage))
}

fn group_name(sid: Sid) -> Result<Vec<u16>, String> {
    let mut name_length = 0;
    let mut domain_length = 0;
    let mut sid_type = 0;
    unsafe {
        LookupAccountSidW(
            null(),
            sid,
            null_mut(),
            &mut name_length,
            null_mut(),
            &mut domain_length,
            &mut sid_type,
        )
    };
    if name_length == 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err("Windows could not resolve Hyper-V Administrators.".to_owned());
    }
    let mut name = vec![0_u16; name_length as usize];
    let mut domain = vec![0_u16; domain_length as usize];
    if unsafe {
        LookupAccountSidW(
            null(),
            sid,
            name.as_mut_ptr(),
            &mut name_length,
            domain.as_mut_ptr(),
            &mut domain_length,
            &mut sid_type,
        )
    } == 0
    {
        return Err(last_error("Resolving Hyper-V Administrators"));
    }
    Ok(name)
}

pub(crate) fn hyper_v_available() -> Result<bool, String> {
    let manager = unsafe { OpenSCManagerW(null(), null(), SC_MANAGER_CONNECT) };
    if manager.is_null() {
        return Err(last_error("Opening the Windows service manager"));
    }
    let manager = ServiceHandle(manager);
    let name = wide(OsStr::new("vmcompute"));
    let service = unsafe { OpenServiceW(manager.0, name.as_ptr(), SERVICE_QUERY_STATUS) };
    if service.is_null() {
        return Ok(false);
    }
    drop(ServiceHandle(service));
    Ok(true)
}

pub(crate) fn token_has_hyper_v_access() -> Result<bool, String> {
    let sid = group_sid()?;
    let mut member = 0;
    if unsafe { CheckTokenMembership(null_mut(), sid.0, &mut member) } == 0 {
        return Err(last_error("Checking Hyper-V Administrators access"));
    }
    Ok(member != 0)
}

pub(crate) fn account_has_hyper_v_membership() -> Result<bool, String> {
    let (_token, user_storage) = current_user()?;
    let user = unsafe { &*(user_storage.as_ptr().cast::<TokenUser>()) };
    let group_sid = group_sid()?;
    let group = group_name(group_sid.0)?;
    let mut buffer = null_mut();
    let mut read = 0;
    let mut total = 0;
    let mut resume = 0;
    let status = unsafe {
        NetLocalGroupGetMembers(
            null(),
            group.as_ptr(),
            0,
            &mut buffer,
            u32::MAX,
            &mut read,
            &mut total,
            &mut resume,
        )
    };
    if status != 0 {
        return Err(format!(
            "Reading Hyper-V Administrators membership failed with Windows error {status}."
        ));
    }
    let member = if buffer.is_null() {
        false
    } else {
        let entries = unsafe {
            std::slice::from_raw_parts(buffer.cast::<LocalGroupMembersInfo0>(), read as usize)
        };
        entries
            .iter()
            .any(|entry| unsafe { EqualSid(entry.sid, user.user.sid) } != 0)
    };
    if !buffer.is_null() {
        unsafe { NetApiBufferFree(buffer.cast()) };
    }
    Ok(member)
}
