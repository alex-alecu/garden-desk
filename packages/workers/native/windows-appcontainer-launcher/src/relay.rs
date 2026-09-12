use std::error::Error;
use std::io::{self, Read, Write};
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

fn copy_output(input: &mut impl Read, output: &mut impl Write) -> io::Result<()> {
    let mut buffer = [0; 8192];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            return Ok(());
        }
        output.write_all(&buffer[..count])?;
        output.flush()?;
    }
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
    let result = copy_output(&mut stream, &mut output);
    let _ = stream.shutdown(Shutdown::Both);
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::copy_output;
    use std::cell::RefCell;
    use std::io::{self, LineWriter, Read, Write};
    use std::rc::Rc;

    struct Destination(Rc<RefCell<Vec<u8>>>);

    impl Write for Destination {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.borrow_mut().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct Source {
        sent: bool,
        destination: Rc<RefCell<Vec<u8>>>,
    }

    impl Read for Source {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.sent {
                assert_eq!(&*self.destination.borrow(), b"response");
                return Ok(0);
            }
            buffer[..8].copy_from_slice(b"response");
            self.sent = true;
            Ok(8)
        }
    }

    #[test]
    fn forwards_response_before_source_closes() {
        let destination = Rc::new(RefCell::new(Vec::new()));
        let mut source = Source {
            sent: false,
            destination: destination.clone(),
        };
        let mut output = LineWriter::new(Destination(destination));
        copy_output(&mut source, &mut output).unwrap();
    }
}
