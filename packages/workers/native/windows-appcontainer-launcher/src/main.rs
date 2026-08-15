#[cfg(windows)]
mod gpu;
#[cfg(windows)]
mod process;
#[cfg(windows)]
mod sandbox;
#[cfg(windows)]
mod win32;

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::error::Error;
#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
const PROFILE_NAME: &str = "VaultDesk.M2.Inference";

#[cfg(windows)]
enum Command {
    GpuInfo,
    Prepare { read_roots: Vec<PathBuf> },
    Run(RunArguments),
    RunVision(VisionArguments),
}

#[cfg(windows)]
struct VisionArguments {
    executable: PathBuf,
    model: PathBuf,
    projector: PathBuf,
    image: PathBuf,
    prompt_file: PathBuf,
    scratch: PathBuf,
    memory_bytes: usize,
    vulkan_device_index: Option<u32>,
}

#[cfg(windows)]
struct RunArguments {
    executable: PathBuf,
    worker_entry: PathBuf,
    scratch: PathBuf,
    model: Option<PathBuf>,
    memory_bytes: usize,
    gpu: GpuArguments,
}

#[cfg(windows)]
#[derive(Default)]
struct GpuArguments {
    backend: Option<process::GpuBackend>,
    backend_name: Option<String>,
    device_index: Option<u32>,
    expected_name: Option<String>,
    memory_kind: Option<String>,
    detected_memory_bytes: Option<usize>,
    installed_memory_bytes: Option<usize>,
}

#[cfg(windows)]
fn value(values: &[(String, String)], name: &str) -> Result<String, Box<dyn Error>> {
    values
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
        .ok_or_else(|| format!("Missing required argument {name}.").into())
}

#[cfg(windows)]
fn optional(values: &[(String, String)], name: &str) -> Option<String> {
    values
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

#[cfg(windows)]
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

#[cfg(windows)]
fn parse() -> Result<Command, Box<dyn Error>> {
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
        _ => Err("Usage: vault-appcontainer-launcher <gpu-info|prepare --read PATH...|run --executable PATH --worker PATH --scratch PATH --memory BYTES [--model PATH] [--gpu-backend cuda|vulkan --gpu-device-index INDEX]|run-vision --executable PATH --model PATH --projector PATH --image PATH --prompt-file PATH --scratch PATH --memory BYTES [--vulkan-device-index INDEX]>".into()),
    }
}

#[cfg(windows)]
fn run() -> Result<i32, Box<dyn Error>> {
    match parse()? {
        Command::GpuInfo => {
            println!("{}", gpu::report()?);
            Ok(0)
        }
        Command::Prepare { read_roots } => {
            let container = sandbox::AppContainer::open(PROFILE_NAME)?;
            for path in read_roots {
                container.grant_runtime_read(&path)?;
            }
            Ok(0)
        }
        Command::Run(arguments) => {
            let container = sandbox::AppContainer::open(PROFILE_NAME)?;
            let executable = arguments.executable.canonicalize()?;
            let worker_entry = arguments.worker_entry.canonicalize()?;
            let scratch = arguments.scratch.canonicalize()?;
            container.grant_scratch(&scratch)?;
            container.grant_file_read(&worker_entry)?;
            let model = arguments
                .model
                .map(|path| path.canonicalize())
                .transpose()?;
            if let Some(path) = model.as_deref() {
                container.grant_file_read(path)?;
            }
            let mut child_arguments = vec![
                "--conditions=vault-runtime".to_owned(),
                "--preserve-symlinks".to_owned(),
                "--preserve-symlinks-main".to_owned(),
                worker_entry.to_string_lossy().into_owned(),
                "--memory-budget".to_owned(),
                arguments.memory_bytes.to_string(),
            ];
            if let Some(path) = model {
                child_arguments.push("--model".to_owned());
                child_arguments.push(path.to_string_lossy().into_owned());
            }
            for (name, value) in [
                ("--gpu-backend", arguments.gpu.backend_name),
                ("--expected-gpu-name", arguments.gpu.expected_name),
                ("--gpu-memory-kind", arguments.gpu.memory_kind),
                (
                    "--detected-gpu-memory",
                    arguments
                        .gpu
                        .detected_memory_bytes
                        .map(|value| value.to_string()),
                ),
                (
                    "--installed-memory",
                    arguments
                        .gpu
                        .installed_memory_bytes
                        .map(|value| value.to_string()),
                ),
            ] {
                if let Some(value) = value {
                    child_arguments.push(name.to_owned());
                    child_arguments.push(value);
                }
            }
            let gpu_environment = process::GpuEnvironment {
                backend: arguments.gpu.backend,
                device_index: arguments.gpu.device_index,
            };
            process::run_sandboxed(
                &executable,
                &child_arguments,
                &scratch,
                arguments.memory_bytes,
                container.sid(),
                &container.profile_path()?,
                gpu_environment,
            )
        }
        Command::RunVision(arguments) => {
            let container = sandbox::AppContainer::open(PROFILE_NAME)?;
            let executable = arguments.executable.canonicalize()?;
            let model = arguments.model.canonicalize()?;
            let projector = arguments.projector.canonicalize()?;
            let image = arguments.image.canonicalize()?;
            let prompt_file = arguments.prompt_file.canonicalize()?;
            let scratch = arguments.scratch.canonicalize()?;
            container.grant_scratch(&scratch)?;
            for path in [&model, &projector, &image, &prompt_file] {
                container.grant_file_read(path)?;
            }
            let child_arguments = vec![
                "--offline".to_owned(),
                "--no-warmup".to_owned(),
                "--log-verbosity".to_owned(),
                "1".to_owned(),
                "--jinja".to_owned(),
                "--model".to_owned(),
                model.to_string_lossy().into_owned(),
                "--mmproj".to_owned(),
                projector.to_string_lossy().into_owned(),
                "--image".to_owned(),
                image.to_string_lossy().into_owned(),
                "--file".to_owned(),
                prompt_file.to_string_lossy().into_owned(),
                "--predict".to_owned(),
                "2048".to_owned(),
                "--ctx-size".to_owned(),
                "8192".to_owned(),
                "--temperature".to_owned(),
                "0".to_owned(),
            ];
            process::run_sandboxed(
                &executable,
                &child_arguments,
                &scratch,
                arguments.memory_bytes,
                container.sid(),
                &container.profile_path()?,
                process::GpuEnvironment {
                    backend: arguments
                        .vulkan_device_index
                        .map(|_| process::GpuBackend::Vulkan),
                    device_index: arguments.vulkan_device_index,
                },
            )
        }
    }
}

#[cfg(windows)]
fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    println!("The Vault Desk AppContainer launcher is built only on Windows.");
}
