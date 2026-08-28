use crate::Arguments;
use crate::acl;
use crate::socket;
use crate::source_access::SourceAccess;
use std::error::Error;
use std::ffi::{OsStr, c_void};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::time::{SystemTime, UNIX_EPOCH};

type Handle = *mut c_void;
const HCS_E_SYSTEM_ALREADY_STOPPED: i32 = 0x8037_0110_u32 as i32;

#[link(name = "computecore")]
unsafe extern "system" {
    fn HcsCreateOperation(context: Handle, callback: Handle) -> Handle;
    fn HcsCreateComputeSystem(
        id: *const u16,
        configuration: *const u16,
        operation: Handle,
        security_descriptor: Handle,
        system: *mut Handle,
    ) -> i32;
    fn HcsStartComputeSystem(system: Handle, operation: Handle, options: *const u16) -> i32;
    fn HcsGetComputeSystemProperties(system: Handle, operation: Handle, query: *const u16) -> i32;
    fn HcsTerminateComputeSystem(system: Handle, operation: Handle, options: *const u16) -> i32;
    fn HcsWaitForOperationResult(operation: Handle, timeout_ms: u32, result: *mut *mut u16) -> i32;
    fn HcsCloseComputeSystem(system: Handle);
    fn HcsCloseOperation(operation: Handle);
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LocalFree(memory: Handle) -> Handle;
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn json_path(path: &Path) -> Result<String, Box<dyn Error>> {
    let path = path.canonicalize()?;
    Ok(path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\""))
}

fn attachments(arguments: &Arguments) -> Result<String, Box<dyn Error>> {
    let mut values = Vec::new();
    for (index, path) in arguments.inputs.iter().enumerate() {
        values.push(format!(
            "\"{index}\":{{\"Path\":\"{}\",\"ReadOnly\":true,\"Type\":\"VirtualDisk\"}}",
            json_path(path)?
        ));
    }
    if let Some(path) = &arguments.scratch {
        values.push(format!(
            "\"{}\":{{\"Path\":\"{}\",\"ReadOnly\":false,\"Type\":\"VirtualDisk\"}}",
            values.len(),
            json_path(path)?
        ));
    }
    Ok(values.join(","))
}

fn plan9(arguments: &Arguments) -> Result<String, Box<dyn Error>> {
    let Some(source) = &arguments.source else {
        return Ok(String::new());
    };
    Ok(format!(
        r#","Plan9":{{"Shares":[{{"Name":"source","AccessName":"source","Path":"{}","Port":564,"Flags":5}}]}}"#,
        json_path(source)?
    ))
}

pub fn configuration(arguments: &Arguments) -> Result<String, Box<dyn Error>> {
    let memory_mb = arguments.memory_bytes.div_ceil(1024 * 1024);
    let kernel = json_path(&arguments.kernel)?;
    let initramfs = json_path(&arguments.initramfs)?;
    let scsi = attachments(arguments)?;
    let plan9 = plan9(arguments)?;
    let template = r#"{"Owner":"Garden Desk M1","SchemaVersion":{"Major":2,"Minor":1},"ShouldTerminateOnLastHandleClosed":true,"VirtualMachine":{"StopOnReset":true,"Chipset":{"LinuxKernelDirect":{"KernelCmdLine":"console=ttyS0 init=/sbin/init panic=-1 dummy.numdummies=0 initcall_blacklist=virtio_vsock_init pci=off","KernelFilePath":"$KERNEL","InitRdPath":"$INITRAMFS"}},"ComputeTopology":{"Memory":{"AllowOvercommit":true,"SizeInMB":$MEMORY},"Processor":{"Count":$CPUS}},"Devices":{"Scsi":{"vault-scsi":{"Attachments":{$SCSI}}},"HvSocket":{"HvSocketConfig":{"DefaultBindSecurityDescriptor":"D:P(A;;FA;;;SY)(A;;FA;;;BA)","ServiceTable":{"00000fd2-facb-11e6-bd58-64006a7986d3":{"AllowWildcardBinds":true,"BindSecurityDescriptor":"D:P(A;;FA;;;WD)","ConnectSecurityDescriptor":"D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-32-578)"}}}}$PLAN9}}}"#;
    Ok(template
        .replace("$KERNEL", &kernel)
        .replace("$INITRAMFS", &initramfs)
        .replace("$MEMORY", &memory_mb.to_string())
        .replace("$CPUS", &arguments.cpu_count.to_string())
        .replace("$SCSI", &scsi)
        .replace("$PLAN9", &plan9))
}

struct Operation(Handle);

impl Operation {
    fn new() -> Result<Self, Box<dyn Error>> {
        let handle = unsafe { HcsCreateOperation(null_mut(), null_mut()) };
        if handle.is_null() {
            return Err("HcsCreateOperation returned a null handle.".into());
        }
        Ok(Self(handle))
    }

    fn wait(&self, action: &str) -> Result<String, Box<dyn Error>> {
        let mut document = null_mut();
        let status = unsafe { HcsWaitForOperationResult(self.0, 60_000, &mut document) };
        let text = take_document(document);
        if status < 0 {
            return Err(format!("{action} failed with HRESULT {status:#010x}: {text}").into());
        }
        Ok(text)
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        unsafe { HcsCloseOperation(self.0) };
    }
}

fn take_document(document: *mut u16) -> String {
    if document.is_null() {
        return String::new();
    }
    let mut length = 0;
    unsafe {
        while *document.add(length) != 0 {
            length += 1;
        }
    }
    let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(document, length) });
    unsafe { LocalFree(document.cast()) };
    text
}

struct System {
    handle: Handle,
    source_access: Option<SourceAccess>,
}

impl System {
    fn create(configuration: &str) -> Result<Self, Box<dyn Error>> {
        let operation = Operation::new()?;
        let id = format!(
            "vault-m1-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()
        );
        let mut handle = null_mut();
        let status = unsafe {
            HcsCreateComputeSystem(
                wide(OsStr::new(&id)).as_ptr(),
                wide(OsStr::new(configuration)).as_ptr(),
                operation.0,
                null_mut(),
                &mut handle,
            )
        };
        started(status, "compute system creation")?;
        operation.wait("compute system creation")?;
        Ok(Self {
            handle,
            source_access: None,
        })
    }

    fn start(&self) -> Result<(), Box<dyn Error>> {
        let operation = Operation::new()?;
        started(
            unsafe { HcsStartComputeSystem(self.handle, operation.0, null()) },
            "compute system start",
        )?;
        operation.wait("compute system start")?;
        Ok(())
    }

    fn properties(&self) -> Result<String, Box<dyn Error>> {
        let operation = Operation::new()?;
        let query = wide(OsStr::new("{}"));
        started(
            unsafe { HcsGetComputeSystemProperties(self.handle, operation.0, query.as_ptr()) },
            "property query",
        )?;
        operation.wait("property query")
    }

    fn terminate(&mut self) -> Result<(), Box<dyn Error>> {
        if self.handle.is_null() {
            return Ok(());
        }
        let result = (|| {
            let operation = Operation::new()?;
            let status = unsafe { HcsTerminateComputeSystem(self.handle, operation.0, null()) };
            if status == HCS_E_SYSTEM_ALREADY_STOPPED {
                return Ok(());
            }
            started(status, "compute system termination")?;
            operation.wait("compute system termination")?;
            Ok(())
        })();
        unsafe { HcsCloseComputeSystem(self.handle) };
        self.handle = null_mut();
        result
    }

    fn teardown(mut self) -> Result<(), Box<dyn Error>> {
        let termination = self.terminate();
        let revocation = match self.source_access.take() {
            Some(access) => access.revoke(),
            None => Ok(()),
        };
        match (termination, revocation) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
            (Err(termination), Err(revocation)) => Err(format!(
                "{termination}; source ACL revocation also failed: {revocation}"
            )
            .into()),
        }
    }
}

impl Drop for System {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

fn started(status: i32, action: &str) -> Result<(), Box<dyn Error>> {
    if status < 0 {
        return Err(format!("{action} did not start: HRESULT {status:#010x}").into());
    }
    Ok(())
}

fn runtime_id(properties: &str) -> Result<&str, Box<dyn Error>> {
    let marker = "\"RuntimeId\":";
    let tail = properties
        .split_once(marker)
        .ok_or("HCS properties did not include RuntimeId.")?
        .1
        .trim_start();
    let value = tail
        .strip_prefix('"')
        .ok_or("RuntimeId was not a string.")?;
    value
        .split_once('"')
        .map(|(id, _)| id)
        .ok_or_else(|| "RuntimeId was unterminated.".into())
}

fn start(configuration: &str, arguments: &Arguments) -> Result<(System, String), Box<dyn Error>> {
    let mut system = System::create(configuration)?;
    let runtime = system.properties()?;
    let runtime_id = runtime_id(&runtime)?.to_owned();
    if let Some(parent) = arguments
        .inputs
        .first()
        .or(arguments.scratch.as_ref())
        .and_then(|path| path.parent())
    {
        acl::grant_traverse(&runtime_id, parent)?;
    }
    for input in &arguments.inputs {
        acl::grant_read(&runtime_id, input)?;
    }
    if let Some(scratch) = &arguments.scratch {
        acl::grant_full(&runtime_id, scratch)?;
    }
    if let Some(source) = &arguments.source {
        acl::grant_tree_read(&runtime_id, source)?;
        system.source_access = Some(SourceAccess::new(runtime_id.clone(), source.clone()));
    }
    system.start()?;
    Ok((system, runtime_id))
}

fn finish<T>(system: System, run: Result<T, Box<dyn Error>>) -> Result<T, Box<dyn Error>> {
    match (run, system.teardown()) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
        (Err(run), Err(teardown)) => Err(format!("{run}; teardown also failed: {teardown}").into()),
    }
}

pub fn run_probe(configuration: &str, arguments: &Arguments) -> Result<String, Box<dyn Error>> {
    let (system, runtime_id) = start(configuration, arguments)?;
    finish(system, socket::exchange(&runtime_id))
}

pub fn run_agent(configuration: &str, arguments: &Arguments) -> Result<(), Box<dyn Error>> {
    let (system, runtime_id) = start(configuration, arguments)?;
    finish(system, socket::relay(&runtime_id))
}
