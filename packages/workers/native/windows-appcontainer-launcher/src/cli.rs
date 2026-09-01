use crate::process;
use std::env;
use std::error::Error;
use std::path::PathBuf;

pub enum Command {
    GpuInfo,
    Prepare { read_roots: Vec<PathBuf> },
    Run(RunArguments),
    RunVision(VisionArguments),
}

pub struct VisionArguments {
    pub executable: PathBuf,
    pub model: PathBuf,
    pub projector: PathBuf,
    pub image: PathBuf,
    pub prompt_file: PathBuf,
    pub scratch: PathBuf,
    pub memory_bytes: usize,
    pub vulkan_device_index: Option<u32>,
}

pub struct RunArguments {
    pub executable: PathBuf,
    pub worker_entry: PathBuf,
    pub scratch: PathBuf,
    pub model: Option<PathBuf>,
    pub memory_bytes: usize,
    pub gpu: GpuArguments,
}

#[derive(Default)]
pub struct GpuArguments {
    pub backend: Option<process::GpuBackend>,
    pub backend_name: Option<String>,
    pub device_index: Option<u32>,
    pub expected_name: Option<String>,
    pub memory_kind: Option<String>,
    pub detected_memory_bytes: Option<usize>,
    pub installed_memory_bytes: Option<usize>,
}

fn value(values: &[(String, String)], name: &str) -> Result<String, Box<dyn Error>> {
    values
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
        .ok_or_else(|| format!("Missing required argument {name}.").into())
}

fn optional(values: &[(String, String)], name: &str) -> Option<String> {
    values
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

fn gpu_arguments(values: &[(String, String)]) -> Result<GpuArguments, Box<dyn Error>> {
    let backend_name = optional(values, "--gpu-backend");
    let backend = match backend_name.as_deref() {
        Some("cuda") => Some(process::GpuBackend::Cuda),
        Some("vulkan") => Some(process::GpuBackend::Vulkan),
        Some(_) => return Err("GPU backend must be cuda or vulkan.".into()),
        None => None,
    };
    let device_index = optional(values, "--gpu-device-index")
        .map(|value| value.parse::<u32>())
        .transpose()?;
    if device_index.is_some() && backend.is_none() {
        return Err("A GPU device index requires a GPU backend.".into());
    }
    let memory_kind = optional(values, "--gpu-memory-kind");
    if !matches!(
        memory_kind.as_deref(),
        None | Some("dedicated") | Some("unified")
    ) {
        return Err("GPU memory kind must be dedicated or unified.".into());
    }
    let expected_name = optional(values, "--expected-gpu-name");
    if expected_name
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 512)
    {
        return Err("Expected GPU name has an invalid size.".into());
    }
    Ok(GpuArguments {
        backend,
        backend_name,
        device_index,
        expected_name,
        memory_kind,
        detected_memory_bytes: optional(values, "--detected-gpu-memory")
            .map(|value| value.parse::<usize>())
            .transpose()?,
        installed_memory_bytes: optional(values, "--installed-memory")
            .map(|value| value.parse::<usize>())
            .transpose()?,
    })
}

pub fn parse() -> Result<Command, Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    let action = arguments.next().ok_or("Missing helper action.")?;
    let mut values = Vec::new();
    let mut read_roots = Vec::new();
    while let Some(key) = arguments.next() {
        let argument = arguments
            .next()
            .ok_or("Every helper argument must have a value.")?;
        if key == "--read" {
            read_roots.push(PathBuf::from(argument));
        } else {
            values.push((key, argument));
        }
    }
    match action.as_str() {
        "gpu-info" if values.is_empty() && read_roots.is_empty() => Ok(Command::GpuInfo),
        "prepare" if values.is_empty() && !read_roots.is_empty() => {
            Ok(Command::Prepare { read_roots })
        }
        "run" if read_roots.is_empty() => Ok(Command::Run(RunArguments {
            executable: PathBuf::from(value(&values, "--executable")?),
            worker_entry: PathBuf::from(value(&values, "--worker")?),
            scratch: PathBuf::from(value(&values, "--scratch")?),
            model: values
                .iter()
                .find(|(key, _)| key == "--model")
                .map(|(_, path)| PathBuf::from(path)),
            memory_bytes: value(&values, "--memory")?.parse()?,
            gpu: gpu_arguments(&values)?,
        })),
        "run-vision" if read_roots.is_empty() => Ok(Command::RunVision(VisionArguments {
            executable: PathBuf::from(value(&values, "--executable")?),
            model: PathBuf::from(value(&values, "--model")?),
            projector: PathBuf::from(value(&values, "--projector")?),
            image: PathBuf::from(value(&values, "--image")?),
            prompt_file: PathBuf::from(value(&values, "--prompt-file")?),
            scratch: PathBuf::from(value(&values, "--scratch")?),
            memory_bytes: value(&values, "--memory")?.parse()?,
            vulkan_device_index: optional(&values, "--vulkan-device-index")
                .map(|value| value.parse::<u32>())
                .transpose()?,
        })),
        _ => Err("Usage: garden-desk-appcontainer-launcher <gpu-info|prepare --read PATH...|run --executable PATH --worker PATH --scratch PATH --memory BYTES [--model PATH] [--gpu-backend cuda|vulkan --gpu-device-index INDEX]|run-vision --executable PATH --model PATH --projector PATH --image PATH --prompt-file PATH --scratch PATH --memory BYTES [--vulkan-device-index INDEX]>".into()),
    }
}
