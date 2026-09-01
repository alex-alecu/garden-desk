#[cfg(windows)]
mod cli;
#[cfg(windows)]
mod gpu;
#[cfg(windows)]
mod process;
#[cfg(windows)]
mod sandbox;
#[cfg(windows)]
mod win32;

#[cfg(windows)]
use cli::{Command, RunArguments, VisionArguments};
#[cfg(windows)]
use std::error::Error;

#[cfg(windows)]
const PROFILE_NAME: &str = "GardenDesk.M2.Inference";

#[cfg(windows)]
#[cfg(windows)]
fn run_worker(arguments: RunArguments) -> Result<i32, Box<dyn Error>> {
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
        "--conditions=gardendesk-runtime".to_owned(),
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
    process::run_sandboxed(
        &executable,
        &child_arguments,
        &scratch,
        arguments.memory_bytes,
        container.sid(),
        &container.profile_path()?,
        process::GpuEnvironment {
            backend: arguments.gpu.backend,
            device_index: arguments.gpu.device_index,
        },
    )
}

#[cfg(windows)]
fn run_vision(arguments: VisionArguments) -> Result<i32, Box<dyn Error>> {
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

#[cfg(windows)]
fn run() -> Result<i32, Box<dyn Error>> {
    match cli::parse()? {
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
        Command::Run(arguments) => run_worker(arguments),
        Command::RunVision(arguments) => run_vision(arguments),
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
    println!("The Garden Desk AppContainer launcher is built only on Windows.");
}
