use std::error::Error;
use std::io::{self, Write};
use std::mem::size_of;
use std::net::{Shutdown, TcpStream};
use std::os::windows::io::FromRawSocket;
use std::path::Path;
use windows::Win32::Networking::WinSock::{
    AF_UNIX, IPPROTO_IP, SOCK_STREAM, SOCKADDR_UN, SOCKET_ERROR, WSACleanup, WSADATA,
    WSAGetLastError, WSAStartup, closesocket, connect as socket_connect, socket,
};

struct Winsock;

impl Drop for Winsock {
    fn drop(&mut self) {
        unsafe { WSACleanup() };
    }
}

fn open(path: &Path) -> Result<TcpStream, Box<dyn Error>> {
    let path = path.to_str().ok_or("Socket path must be UTF-8.")?;
    let mut address = SOCKADDR_UN {
        sun_family: windows::Win32::Networking::WinSock::ADDRESS_FAMILY(AF_UNIX),
        ..Default::default()
    };
    if path.len() >= address.sun_path.len() || path.as_bytes().contains(&0) {
        return Err("Socket path exceeds the Windows pathname limit.".into());
    }
    for (target, byte) in address.sun_path.iter_mut().zip(path.bytes()) {
        *target = byte as i8;
    }
    let handle = unsafe { socket(AF_UNIX as i32, SOCK_STREAM, IPPROTO_IP.0) }.map_err(|_| {
        format!("Private socket creation failed: {}.", unsafe {
            WSAGetLastError().0
        })
    })?;
    if unsafe {
        socket_connect(
            handle,
            (&address as *const SOCKADDR_UN).cast(),
            size_of::<SOCKADDR_UN>() as i32,
        )
    } == SOCKET_ERROR
    {
        let code = unsafe { WSAGetLastError().0 };
        unsafe { closesocket(handle) };
        return Err(format!("Private socket connection failed: {code}.").into());
    }
    Ok(unsafe { TcpStream::from_raw_socket(handle.0 as _) })
}

pub(crate) fn connect(path: &Path) -> Result<(), Box<dyn Error>> {
    let mut data = WSADATA::default();
    let result = unsafe { WSAStartup(0x0202, &mut data) };
    if result != 0 {
        return Err(format!("Private socket startup failed: {result}.").into());
    }
    let _winsock = Winsock;
    let mut stream = open(path)?;
    let mut writer = stream.try_clone()?;
    std::thread::spawn(move || {
        let _ = io::copy(&mut io::stdin().lock(), &mut writer);
        let _ = writer.shutdown(Shutdown::Write);
    });
    let mut output = io::stdout().lock();
    let result = io::copy(&mut stream, &mut output);
    let _ = stream.shutdown(Shutdown::Both);
    result?;
    output.flush()?;
    Ok(())
}
