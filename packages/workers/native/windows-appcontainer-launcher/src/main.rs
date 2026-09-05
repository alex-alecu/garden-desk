#[cfg(windows)]
mod cli;
#[cfg(windows)]
mod gpu;
#[cfg(windows)]
mod process;
#[cfg(windows)]
mod relay;
#[cfg(windows)]
mod sandbox;
#[cfg(windows)]
mod win32;

#[cfg(windows)]
use cli::{Command, RunArguments, ServerArguments};
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
fn run_server(arguments: ServerArguments) -> Result<i32, Box<dyn Error>> {
    let container = sandbox::AppContainer::open(PROFILE_NAME)?;
    let executable = arguments.executable.canonicalize()?;
    let scratch = arguments.scratch.canonicalize()?;
    container.grant_scratch(&scratch)?;
    for path in arguments.read_paths {
        container.grant_file_read(&path.canonicalize()?)?;
    }
    process::run_sandboxed(
        &executable,
        &arguments.arguments,
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
        Command::RunServer(arguments) => run_server(arguments),
        Command::Connect { socket } => relay::connect(&socket).map(|()| 0),
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
