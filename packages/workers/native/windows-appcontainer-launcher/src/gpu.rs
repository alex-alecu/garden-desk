use std::error::Error;
use std::ffi::c_void;
use std::mem::size_of;
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::DXCore::{
    DXCORE_ADAPTER_ATTRIBUTE_D3D12_GRAPHICS, DXCoreCreateAdapterFactory, DedicatedAdapterMemory,
    DedicatedSystemMemory, DriverDescription, IDXCoreAdapter, IDXCoreAdapterFactory,
    IDXCoreAdapterList, InstanceLuid, IsHardware, IsIntegrated, SharedSystemMemory,
};
use windows::Win32::System::SystemInformation::GetPhysicallyInstalledSystemMemory;

const MAX_ADAPTERS: u32 = 64;
const MAX_DESCRIPTION_BYTES: usize = 4_096;

struct AdapterInfo {
    id: String,
    description: String,
    integrated: bool,
    dedicated_adapter_memory_bytes: u64,
    dedicated_system_memory_bytes: u64,
    shared_system_memory_bytes: u64,
}

unsafe fn property<T: Default>(
    adapter: &IDXCoreAdapter,
    name: windows::Win32::Graphics::DXCore::DXCoreAdapterProperty,
) -> Result<T, Box<dyn Error>> {
    if !unsafe { adapter.IsPropertySupported(name) } {
        return Err(format!("DXCore adapter property {} is not supported.", name.0).into());
    }
    let mut value = T::default();
    unsafe {
        adapter.GetProperty(
            name,
            size_of::<T>(),
            (&mut value as *mut T).cast::<c_void>(),
        )?;
    }
    Ok(value)
}

unsafe fn description(adapter: &IDXCoreAdapter) -> Result<String, Box<dyn Error>> {
    if !unsafe { adapter.IsPropertySupported(DriverDescription) } {
        return Err("DXCore driver description is not supported.".into());
    }
    let bytes = unsafe { adapter.GetPropertySize(DriverDescription)? };
    if !(2..=MAX_DESCRIPTION_BYTES).contains(&bytes) {
        return Err("DXCore driver description has an invalid size.".into());
    }
    let mut value = vec![0_u8; bytes];
    unsafe {
        adapter.GetProperty(
            DriverDescription,
            bytes,
            value.as_mut_ptr().cast::<c_void>(),
        )?;
    }
    if let Some(end) = value.iter().position(|byte| *byte == 0) {
        value.truncate(end);
    }
    let text = String::from_utf8(value)?.trim().to_owned();
    if text.is_empty() {
        return Err("DXCore driver description is empty.".into());
    }
    Ok(text)
}

unsafe fn adapter_info(adapter: &IDXCoreAdapter) -> Result<Option<AdapterInfo>, Box<dyn Error>> {
    if !unsafe { property::<bool>(adapter, IsHardware)? } {
        return Ok(None);
    }
    let luid = unsafe { property::<LUID>(adapter, InstanceLuid)? };
    Ok(Some(AdapterInfo {
        id: format!("{:08x}:{:08x}", luid.HighPart as u32, luid.LowPart),
        description: unsafe { description(adapter)? },
        integrated: unsafe { property(adapter, IsIntegrated)? },
        dedicated_adapter_memory_bytes: unsafe { property(adapter, DedicatedAdapterMemory)? },
        dedicated_system_memory_bytes: unsafe { property(adapter, DedicatedSystemMemory)? },
        shared_system_memory_bytes: unsafe { property(adapter, SharedSystemMemory)? },
    }))
}

fn json_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            value if value.is_control() => output.push_str(&format!("\\u{:04x}", value as u32)),
            value => output.push(value),
        }
    }
    output.push('"');
    output
}

fn adapter_json(adapter: &AdapterInfo) -> String {
    format!(
        "{{\"id\":{},\"description\":{},\"integrated\":{},\"dedicatedAdapterMemoryBytes\":{},\"dedicatedSystemMemoryBytes\":{},\"sharedSystemMemoryBytes\":{}}}",
        json_string(&adapter.id),
        json_string(&adapter.description),
        adapter.integrated,
        adapter.dedicated_adapter_memory_bytes,
        adapter.dedicated_system_memory_bytes,
        adapter.shared_system_memory_bytes,
    )
}

pub(crate) fn report() -> Result<String, Box<dyn Error>> {
    let mut installed_kib = 0_u64;
    unsafe { GetPhysicallyInstalledSystemMemory(&mut installed_kib)? };
    let installed_memory_bytes = installed_kib
        .checked_mul(1_024)
        .ok_or("Installed memory size is too large.")?;
    let factory: IDXCoreAdapterFactory = unsafe { DXCoreCreateAdapterFactory()? };
    let list: IDXCoreAdapterList =
        unsafe { factory.CreateAdapterList(&[DXCORE_ADAPTER_ATTRIBUTE_D3D12_GRAPHICS])? };
    let count = unsafe { list.GetAdapterCount() };
    if count > MAX_ADAPTERS {
        return Err("DXCore returned too many graphics adapters.".into());
    }
    let mut adapters = Vec::new();
    for index in 0..count {
        let adapter: IDXCoreAdapter = unsafe { list.GetAdapter(index)? };
        if let Some(info) = unsafe { adapter_info(&adapter)? } {
            adapters.push(info);
        }
    }
    let values = adapters
        .iter()
        .map(adapter_json)
        .collect::<Vec<_>>()
        .join(",");
    Ok(format!(
        "{{\"schemaVersion\":1,\"installedMemoryBytes\":{installed_memory_bytes},\"adapters\":[{values}]}}"
    ))
}
