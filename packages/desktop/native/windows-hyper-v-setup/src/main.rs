#[cfg(windows)]
mod windows {
    use std::error::Error;
    use std::ffi::{OsStr, c_void};
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};

    mod arguments;
    mod result;
    pub use result::{ALREADY_MEMBER_EXIT_CODE, MembershipResult};

    type Handle = *mut c_void;
    type Sid = *mut c_void;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_USER_CLASS: u32 = 1;
    const TOKEN_ELEVATION_CLASS: u32 = 20;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

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
    struct TokenElevation {
        elevated: u32,
    }

    #[repr(C)]
    struct LocalGroupMembersInfo0 {
        sid: Sid,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> Handle;
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
        fn ConvertStringSidToSidW(text: *const u16, sid: *mut Sid) -> i32;
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
        fn NetLocalGroupAddMembers(
            server_name: *const u16,
            group_name: *const u16,
            level: u32,
            buffer: *const u8,
            entries: u32,
        ) -> u32;
    }

    struct OwnedHandle(Handle);

    impl OwnedHandle {
        fn open(value: Handle, action: &str) -> Result<Self, Box<dyn Error>> {
            if value.is_null() {
                return Err(format!("{action} failed with Windows error {}.", last_error()).into());
            }
            Ok(Self(value))
        }
    }

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
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

    fn last_error() -> u32 {
        unsafe { GetLastError() }
    }

    fn requester_sid_storage(pid: u32) -> Result<(OwnedHandle, Vec<usize>), Box<dyn Error>> {
        let process = OwnedHandle::open(
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) },
            "Opening the requesting Garden Desk process",
        )?;
        let mut token = null_mut();
        if unsafe { OpenProcessToken(process.0, TOKEN_QUERY, &mut token) } == 0 {
            return Err(format!(
                "Opening the requesting Garden Desk token failed with Windows error {}.",
                last_error()
            )
            .into());
        }
        let token = OwnedHandle::open(token, "Opening the requesting Garden Desk token")?;
        let mut elevation = TokenElevation { elevated: 0 };
        let mut elevation_length = size_of::<TokenElevation>() as u32;
        if unsafe {
            GetTokenInformation(
                token.0,
                TOKEN_ELEVATION_CLASS,
                (&mut elevation as *mut TokenElevation).cast(),
                elevation_length,
                &mut elevation_length,
            )
        } == 0
        {
            return Err(format!(
                "Reading the requesting Garden Desk elevation state failed with Windows error {}.",
                last_error()
            )
            .into());
        }
        if elevation.elevated != 0 {
            return Err("The requesting Garden Desk process must be non-elevated.".into());
        }
        let mut length = 0;
        unsafe {
            GetTokenInformation(token.0, TOKEN_USER_CLASS, null_mut(), 0, &mut length);
        }
        if length == 0 || last_error() != ERROR_INSUFFICIENT_BUFFER {
            return Err("Windows did not report the requesting user token size.".into());
        }
        let words = (length as usize).div_ceil(size_of::<usize>());
        let mut storage = vec![0_usize; words];
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
            return Err(format!(
                "Reading the requesting Garden Desk user failed with Windows error {}.",
                last_error()
            )
            .into());
        }
        Ok((token, storage))
    }

    fn hyper_v_group_sid() -> Result<LocalSid, Box<dyn Error>> {
        let text = wide(OsStr::new("S-1-5-32-578"));
        let mut sid = null_mut();
        if unsafe { ConvertStringSidToSidW(text.as_ptr(), &mut sid) } == 0 {
            return Err(format!(
                "Resolving the Hyper-V Administrators SID failed with Windows error {}.",
                last_error()
            )
            .into());
        }
        Ok(LocalSid(sid))
    }

    fn account_name(sid: Sid) -> Result<Vec<u16>, Box<dyn Error>> {
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
            );
        }
        if name_length == 0 || last_error() != ERROR_INSUFFICIENT_BUFFER {
            return Err("Windows could not resolve the Hyper-V Administrators group.".into());
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
            return Err(format!(
                "Resolving the Hyper-V Administrators group failed with Windows error {}.",
                last_error()
            )
            .into());
        }
        Ok(name)
    }

    fn accept_membership_result(status: u32) -> Result<MembershipResult, Box<dyn Error>> {
        if status == 0 {
            return Ok(MembershipResult::Added);
        }
        if status == result::ERROR_MEMBER_IN_ALIAS {
            return Ok(MembershipResult::AlreadyMember);
        }
        Err(format!(
            "Adding the requesting user to Hyper-V Administrators failed with Windows error {status}."
        )
        .into())
    }

    pub fn run() -> Result<MembershipResult, Box<dyn Error>> {
        let (_token, storage) = requester_sid_storage(arguments::requester_pid()?)?;
        let requester = unsafe { &*(storage.as_ptr().cast::<TokenUser>()) };
        let group_sid = hyper_v_group_sid()?;
        let group_name = account_name(group_sid.0)?;
        let member = LocalGroupMembersInfo0 {
            sid: requester.user.sid,
        };
        let status = unsafe {
            NetLocalGroupAddMembers(
                null(),
                group_name.as_ptr(),
                0,
                (&member as *const LocalGroupMembersInfo0).cast(),
                1,
            )
        };
        accept_membership_result(status)
    }

    #[cfg(test)]
    mod tests;
}

#[cfg(windows)]
fn main() {
    match windows::run() {
        Ok(windows::MembershipResult::Added) => {}
        Ok(windows::MembershipResult::AlreadyMember) => {
            std::process::exit(windows::ALREADY_MEMBER_EXIT_CODE);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    println!("The Garden Desk Hyper-V setup helper is built only on Windows.");
}
