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
    Prepare { read_roots: Vec<PathBuf> },
    Run(RunArguments),
}

#[cfg(windows)]
struct RunArguments {
    executable: PathBuf,
    worker_entry: PathBuf,
    scratch: PathBuf,
    model: Option<PathBuf>,
    memory_bytes: usize,
    development_allow_shared_gpu: bool,
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
            development_allow_shared_gpu: values
                .iter()
                .any(|(key, value)| key == "--development-allow-shared-gpu" && value == "true"),
        })),
        _ => Err("Usage: vault-appcontainer-launcher <prepare --read PATH...|run --executable PATH --worker PATH --scratch PATH --memory BYTES [--model PATH] [--development-allow-shared-gpu true]>".into()),
    }
}

#[cfg(windows)]
fn run() -> Result<i32, Box<dyn Error>> {
    let container = sandbox::AppContainer::open(PROFILE_NAME)?;
    match parse()? {
        Command::Prepare { read_roots } => {
            for path in read_roots {
                container.grant_runtime_read(&path)?;
            }
            Ok(0)
        }
        Command::Run(arguments) => {
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
            if arguments.development_allow_shared_gpu {
                child_arguments.push("--development-allow-windows-shared-gpu".to_owned());
            }
            process::run_sandboxed(
                &executable,
                &child_arguments,
                &scratch,
                arguments.memory_bytes,
                container.sid(),
                &container.profile_path()?,
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
