#[cfg(windows)]
mod acl;
#[cfg(windows)]
mod hcs;
#[cfg(windows)]
mod socket;
#[cfg(windows)]
mod source_access;

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::error::Error;
#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
struct Arguments {
    kernel: PathBuf,
    initramfs: PathBuf,
    cpu_count: u32,
    memory_bytes: u64,
    scratch: Option<PathBuf>,
    scratch_bytes: u64,
    inputs: Vec<PathBuf>,
    source: Option<PathBuf>,
    print_configuration: bool,
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
fn parse_arguments() -> Result<Arguments, Box<dyn Error>> {
    let mut values = Vec::new();
    let mut inputs = Vec::new();
    let mut print_configuration = false;
    let mut arguments = env::args().skip(1);
    while let Some(key) = arguments.next() {
        if key == "--print-configuration" {
            print_configuration = true;
            continue;
        }
        let argument = arguments
            .next()
            .ok_or("Every argument must have a value.")?;
        if key == "--input" {
            inputs.push(PathBuf::from(argument));
        } else {
            values.push((key, argument));
        }
    }
    let scratch_bytes = value(&values, "--scratch-bytes")?.parse()?;
    let scratch = values
        .iter()
        .find(|(key, _)| key == "--scratch")
        .map(|(_, path)| PathBuf::from(path));
    let source = values
        .iter()
        .find(|(key, _)| key == "--source")
        .map(|(_, path)| PathBuf::from(path));
    if (scratch_bytes == 0) != scratch.is_none() {
        return Err("Scratch path and positive scratch size must be supplied together.".into());
    }
    Ok(Arguments {
        kernel: PathBuf::from(value(&values, "--kernel")?),
        initramfs: PathBuf::from(value(&values, "--initramfs")?),
        cpu_count: value(&values, "--cpus")?.parse()?,
        memory_bytes: value(&values, "--memory")?.parse()?,
        scratch,
        scratch_bytes,
        inputs,
        source,
        print_configuration,
    })
}

#[cfg(windows)]
fn run() -> Result<(), Box<dyn Error>> {
    let arguments = parse_arguments()?;
    let configuration = hcs::configuration(&arguments)?;
    if arguments.print_configuration {
        println!("{configuration}");
        return Ok(());
    }
    if arguments.source.is_some() {
        hcs::run_agent(&configuration, &arguments)?;
    } else {
        let guest = hcs::run_probe(&configuration, &arguments)?;
        println!(
            "{{\"classification\":\"certified\",\"guest\":{guest},\"networkDeviceCount\":0,\"readOnlyInputCount\":{},\"scratchBytes\":{},\"socketDeviceCount\":1}}",
            arguments.inputs.len(),
            arguments.scratch_bytes
        );
    }
    Ok(())
}

#[cfg(windows)]
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    println!("The Garden Desk HCS helper is built only on Windows.");
}
