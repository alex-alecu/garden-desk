use std::env;
use std::error::Error;

pub(super) fn parse_requester_pid(arguments: &[String]) -> Result<u32, Box<dyn Error>> {
    if arguments.len() != 2 || arguments[0] != "--requester-pid" {
        return Err("Usage: garden-desk-hyper-v-setup --requester-pid PID".into());
    }
    let pid = arguments[1].parse::<u32>()?;
    if pid == 0 {
        return Err("The requesting process ID must be nonzero.".into());
    }
    Ok(pid)
}

pub(super) fn requester_pid() -> Result<u32, Box<dyn Error>> {
    parse_requester_pid(&env::args().skip(1).collect::<Vec<_>>())
}
