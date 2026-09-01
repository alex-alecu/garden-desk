#[cfg(windows)]
mod client;
#[cfg(windows)]
mod probe;
#[cfg(windows)]
mod security;
#[cfg(windows)]
mod server;

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::error::Error;

#[cfg(windows)]
fn run() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    match (
        arguments.next().as_deref(),
        arguments.next(),
        arguments.next(),
        arguments.next(),
        arguments.next(),
    ) {
        (Some("serve"), Some(endpoint), Some(maximum), Some(parent), None) => {
            server::serve(&endpoint, maximum.parse()?, parent.parse()?)
        }
        (Some("request"), Some(endpoint), Some(maximum), None, None) => {
            client::request(&endpoint, maximum.parse()?)
        }
        (Some("probe"), Some(endpoint), None, None, None) => probe::probe(&endpoint),
        _ => Err(
            "Usage: garden-desk-pipe-guard <serve ENDPOINT MAXIMUM PARENT_PID|request ENDPOINT MAXIMUM|probe ENDPOINT>.".into(),
        ),
    }
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
    println!("The Garden Desk pipe guard is built only on Windows.");
}
