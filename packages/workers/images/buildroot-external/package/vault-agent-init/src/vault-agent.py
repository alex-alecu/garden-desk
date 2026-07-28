#!/usr/bin/python3
import base64
import ctypes
import errno
import hashlib
import json
import os
import pathlib
import resource
import select
import signal
import socket
import struct
import subprocess
import time

PORT = 4050
MAX_FRAME_BYTES = 192 * 1024 * 1024
MAX_WORKSPACE_BYTES = 128 * 1024 * 1024
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
MAX_ARTIFACT_TOTAL_BYTES = 8 * 1024 * 1024
MAX_LOG_BYTES = 1_000_000
NOBODY = 65534
WORKSPACE = pathlib.Path("/workspace")
SOURCE = pathlib.Path("/source")
INPUTS = pathlib.Path("/run/attachments")
RUNTIME = pathlib.Path("/run/user")
SECCOMP_RET_ALLOW = 0x7FFF0000
SECCOMP_RET_ERRNO = 0x00050000
SECCOMP_RET_KILL_PROCESS = 0x80000000


class SockFilter(ctypes.Structure):
    _fields_ = [
        ("code", ctypes.c_ushort),
        ("jt", ctypes.c_ubyte),
        ("jf", ctypes.c_ubyte),
        ("k", ctypes.c_uint),
    ]


class SockFprog(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ushort), ("filters", ctypes.POINTER(SockFilter))]


def read_exact(connection, size):
    chunks = []
    remaining = size
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise RuntimeError("socket_closed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_frame(connection):
    size = struct.unpack(">I", read_exact(connection, 4))[0]
    if size < 1 or size > MAX_FRAME_BYTES:
        raise RuntimeError("invalid_frame")
    return json.loads(read_exact(connection, size))


def write_frame(connection, value):
    payload = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    if len(payload) > MAX_FRAME_BYTES:
        raise RuntimeError("output_limit")
    connection.sendall(struct.pack(">I", len(payload)) + payload)


def block_devices():
    names = [item.name for item in pathlib.Path("/sys/class/block").glob("vd*")]
    return [pathlib.Path("/dev") / name for name in sorted(names, key=lambda name: (len(name), name))]


def safe_relative(value):
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise RuntimeError("unsafe_workspace_path")
    return path


def target_path(value):
    relative = safe_relative(value)
    current = WORKSPACE
    for part in relative.parts[:-1]:
        current = current / part
        if current.exists() and (current.is_symlink() or not current.is_dir()):
            raise RuntimeError("unsafe_workspace_path")
    return WORKSPACE.joinpath(*relative.parts)


def mount_runtime(request):
    limits = request["limits"]
    scratch_bytes = limits["scratchBytes"]
    if scratch_bytes != MAX_WORKSPACE_BYTES:
        raise RuntimeError("scratch_limit")
    SOURCE.mkdir(mode=0o755, exist_ok=True)
    WORKSPACE.mkdir(mode=0o700, exist_ok=True)
    INPUTS.mkdir(mode=0o755, parents=True, exist_ok=True)
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    mounted = subprocess.run(
        ["/bin/mount", "-t", "virtiofs", "-o", "ro", "source", str(SOURCE)],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if mounted.returncode != 0:
        plan9 = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        try:
            plan9.connect((socket.VMADDR_CID_HOST, 564))
            descriptor = plan9.fileno()
            subprocess.run(
                [
                    "/bin/mount",
                    "-t",
                    "9p",
                    "-o",
                    f"trans=fd,rfdno={descriptor},wfdno={descriptor},msize=65536,noload,aname=source,ro",
                    "source",
                    str(SOURCE),
                ],
                check=True,
                pass_fds=(descriptor,),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        finally:
            plan9.close()
    subprocess.run(
        ["/bin/mount", "-t", "tmpfs", "-o", f"size={scratch_bytes},mode=0700", "tmpfs", str(WORKSPACE)],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["/bin/mount", "-t", "tmpfs", "-o", "size=16m,mode=0700", "tmpfs", str(RUNTIME)],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    devices = block_devices()
    inputs = request["inputs"]
    if len(devices) != (max((item["deviceIndex"] for item in inputs), default=-1) + 1):
        raise RuntimeError("device_count_mismatch")
    for item in inputs:
        destination = INPUTS / pathlib.Path(item["name"]).name
        with devices[item["deviceIndex"]].open("rb", buffering=0) as source, destination.open("xb") as target:
            source.seek(item["byteOffset"])
            remaining = item["byteLength"]
            while remaining:
                chunk = source.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise RuntimeError("input_truncated")
                target.write(chunk)
                remaining -= len(chunk)
        destination.chmod(0o444)
    os.chown(WORKSPACE, NOBODY, NOBODY)
    os.chown(RUNTIME, NOBODY, NOBODY)
    pathlib.Path("/tmp").chmod(0o555)


def hydrate(entries):
    for entry in entries:
        path = target_path(entry["path"])
        if entry["kind"] == "directory":
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
            continue
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        content = base64.b64decode(entry["bytesBase64"], validate=True)
        if hashlib.sha256(content).hexdigest() != entry["contentHash"]:
            raise RuntimeError("workspace_content_hash_mismatch")
        with path.open("xb") as output:
            output.write(content)
        os.chown(path, NOBODY, NOBODY)
    for directory, _, _ in os.walk(WORKSPACE):
        os.chown(directory, NOBODY, NOBODY)


def installed_executables():
    names = set()
    for directory in [
        pathlib.Path("/bin"),
        pathlib.Path("/sbin"),
        pathlib.Path("/usr/bin"),
        pathlib.Path("/usr/sbin"),
    ]:
        for path in directory.iterdir():
            try:
                if path.is_file() and os.access(path, os.X_OK):
                    names.add(path.as_posix())
            except OSError:
                continue
    return sorted(names)


def deny_new_sockets():
    machine = os.uname().machine
    architecture = {"aarch64": 0xC00000B7, "x86_64": 0xC000003E}.get(machine)
    socket_syscall = {"aarch64": 198, "x86_64": 41}.get(machine)
    socketpair_syscall = {"aarch64": 199, "x86_64": 53}.get(machine)
    if architecture is None or socket_syscall is None or socketpair_syscall is None:
        raise RuntimeError("unsupported_seccomp_architecture")
    rules = [
        SockFilter(0x20, 0, 0, 4),
        SockFilter(0x15, 1, 0, architecture),
        SockFilter(0x06, 0, 0, SECCOMP_RET_KILL_PROCESS),
        SockFilter(0x20, 0, 0, 0),
        SockFilter(0x15, 0, 1, socket_syscall),
        SockFilter(0x06, 0, 0, SECCOMP_RET_ERRNO | errno.EPERM),
        SockFilter(0x15, 0, 1, socketpair_syscall),
        SockFilter(0x06, 0, 0, SECCOMP_RET_ERRNO | errno.EPERM),
        SockFilter(0x15, 0, 1, 425),
        SockFilter(0x06, 0, 0, SECCOMP_RET_ERRNO | errno.EPERM),
        SockFilter(0x06, 0, 0, SECCOMP_RET_ALLOW),
    ]
    filters = (SockFilter * len(rules))(*rules)
    program = SockFprog(len(rules), filters)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(22, 2, ctypes.byref(program)) != 0:
        raise OSError(ctypes.get_errno(), "seccomp_setup_failed")


def limit_process(request):
    limits = request["limits"]
    memory = min(limits["memoryBytes"], 8 * 1024 * 1024 * 1024)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_WORKSPACE_BYTES, MAX_WORKSPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    deny_new_sockets()
    os.setgroups([])
    os.setgid(NOBODY)
    os.setuid(NOBODY)


def atomic_source(request):
    path = target_path(request["path"])
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory = path.parent
    while directory != WORKSPACE:
        os.chown(directory, NOBODY, NOBODY)
        directory = directory.parent
    temporary = path.with_name(f".{path.name}.{request['requestId']}.tmp")
    descriptor = os.open(
        temporary,
        os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(request["source"])
        output.flush()
        os.fsync(output.fileno())
    os.chown(temporary, NOBODY, NOBODY)
    os.replace(temporary, path)
    return path


def append_output(target, chunk, limit):
    remaining = max(0, limit - len(target))
    retained = chunk[:remaining]
    target.extend(retained)
    return retained, len(chunk) > remaining


def write_execution_update(connection, request, sequence, operation, **detail):
    write_frame(
        connection,
        {
            "protocolVersion": 3,
            "requestId": request["requestId"],
            "executionId": request["executionId"],
            "operation": operation,
            "sequence": sequence,
            **detail,
        },
    )
    return sequence + 1


def stream_output(connection, request, sequence, stream, target, chunk, limit):
    retained, truncated = append_output(target, chunk, limit)
    if retained:
        sequence = write_execution_update(
            connection,
            request,
            sequence,
            "stream",
            stream=stream,
            contentBase64=base64.b64encode(retained).decode("ascii"),
            byteLength=len(retained),
        )
    return sequence, truncated


def stop_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def command_for(request):
    language = request["language"]
    if language == "shell":
        return ["/bin/sh", "-c", request["command"]]
    script = atomic_source(request)
    if language == "python":
        return ["/usr/bin/python3", str(script)]
    if language == "node":
        return ["/usr/bin/node", str(script)]
    raise RuntimeError("unsupported_language")


def collect_workspace():
    entries = []
    total = 0
    for root, directories, files in os.walk(WORKSPACE, followlinks=False):
        root_path = pathlib.Path(root)
        for name in sorted(directories):
            path = root_path / name
            if path.is_symlink():
                raise RuntimeError("workspace_unsafe_entry")
            entries.append({"kind": "directory", "path": path.relative_to(WORKSPACE).as_posix()})
        for name in sorted(files):
            path = root_path / name
            stat = path.lstat()
            if path.is_symlink() or not path.is_file():
                raise RuntimeError("workspace_unsafe_entry")
            total += stat.st_size
            if total > MAX_WORKSPACE_BYTES:
                raise RuntimeError("workspace_quota_exceeded")
            content = path.read_bytes()
            entries.append(
                {
                    "kind": "file",
                    "path": path.relative_to(WORKSPACE).as_posix(),
                    "contentHash": hashlib.sha256(content).hexdigest(),
                    "bytesBase64": base64.b64encode(content).decode("ascii"),
                }
            )
    return entries


def workspace_signatures(entries):
    return {
        entry["path"]: entry.get("contentHash", entry["kind"])
        for entry in entries
    }


def workspace_delta(entries, previous):
    current = workspace_signatures(entries)
    return {
        "entries": [entry for entry in entries if previous.get(entry["path"]) != current[entry["path"]]],
        "removedPaths": sorted(path for path in previous if path not in current),
    }


def collect_artifacts(entries, previous):
    output = []
    total = 0
    for entry in entries:
        if (
            entry["kind"] != "file"
            or entry["path"].startswith("steps/")
            or previous.get(entry["path"]) == entry["contentHash"]
        ):
            continue
        content = base64.b64decode(entry["bytesBase64"])
        if len(content) > MAX_ARTIFACT_BYTES or total + len(content) > MAX_ARTIFACT_TOTAL_BYTES:
            continue
        output.append(
            {
                "name": entry["path"],
                "mediaType": "application/octet-stream",
                "bytesBase64": entry["bytesBase64"],
            }
        )
        total += len(content)
        if len(output) == 16:
            break
    return output


def execute(connection, request, previous):
    command = command_for(request)
    environment = {
        "HOME": str(WORKSPACE),
        "LANG": "C.UTF-8",
        "PATH": "/usr/bin:/bin",
        "TMPDIR": str(RUNTIME),
        "VAULT_SOURCE_DIR": str(SOURCE),
        "VAULT_INPUT_DIR": str(INPUTS),
        "VAULT_WORKSPACE_DIR": str(WORKSPACE),
    }
    started = time.monotonic()
    marker = request["requestId"]
    output_limit = min(request["limits"]["outputBytes"], MAX_LOG_BYTES)
    stdout = bytearray()
    stderr = bytearray()
    stdout_truncated = False
    stderr_truncated = False
    termination = "completed"
    close_after = False
    process = subprocess.Popen(
        command,
        cwd=WORKSPACE,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        preexec_fn=lambda: limit_process(request),
        close_fds=True,
    )
    sequence = write_execution_update(
        connection,
        request,
        0,
        "diagnostic",
        diagnostic={"code": "process_start", "platform": "guest", "platformCode": None},
    )
    deadline = started + request["limits"]["wallTimeMs"] / 1000
    streams = {process.stdout: stdout, process.stderr: stderr}
    while process.poll() is None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            termination = "timeout"
            break
        readable, _, _ = select.select([connection, *streams], [], [], min(0.1, remaining))
        for stream in readable:
            if stream is connection:
                control = read_frame(connection)
                if control.get("operation") == "cancel" and control.get("requestId") == marker:
                    termination = "cancelled"
                if control.get("operation") == "shutdown":
                    termination = "cancelled"
                    close_after = True
            else:
                chunk = os.read(stream.fileno(), 64 * 1024)
                if not chunk:
                    streams.pop(stream)
                else:
                    name = "stdout" if stream is process.stdout else "stderr"
                    sequence, truncated = stream_output(
                        connection, request, sequence, name, streams[stream], chunk, output_limit
                    )
                    if stream is process.stdout:
                        stdout_truncated = stdout_truncated or truncated
                    else:
                        stderr_truncated = stderr_truncated or truncated
                    if truncated and termination == "completed":
                        termination = "resource_limit"
        if termination != "completed":
            break
    stop_process_group(process)
    remainder_out, remainder_err = process.communicate()
    sequence, remainder_truncated = stream_output(
        connection, request, sequence, "stdout", stdout, remainder_out, output_limit
    )
    stdout_truncated = stdout_truncated or remainder_truncated
    if remainder_truncated and termination == "completed":
        termination = "resource_limit"
    sequence, remainder_truncated = stream_output(
        connection, request, sequence, "stderr", stderr, remainder_err, output_limit
    )
    stderr_truncated = stderr_truncated or remainder_truncated
    if remainder_truncated and termination == "completed":
        termination = "resource_limit"
    write_execution_update(
        connection,
        request,
        sequence,
        "diagnostic",
        diagnostic={"code": "process_exit", "platform": "guest", "platformCode": None},
    )
    workspace = collect_workspace()
    language = request["language"]
    result = {
        "language": language,
        "path": request.get("path"),
        "source": request.get("source"),
        "command": request.get("command"),
        "exitCode": max(0, min(255, process.returncode if process.returncode >= 0 else 255)),
        "stdout": stdout.decode("utf-8", "replace"),
        "stderr": stderr.decode("utf-8", "replace"),
        "stdoutTruncated": stdout_truncated,
        "stderrTruncated": stderr_truncated,
        "durationMs": int((time.monotonic() - started) * 1000),
        "termination": termination if process.returncode == 0 or termination != "completed" else "crash",
        "artifacts": collect_artifacts(workspace, previous),
    }
    return result, workspace, close_after


def interface_count():
    return len([path for path in pathlib.Path("/sys/class/net").iterdir() if path.name != "lo"])


def main():
    listener = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    listener.bind((socket.VMADDR_CID_ANY, PORT))
    listener.listen(1)
    connection, _ = listener.accept()
    with connection:
        hello = read_frame(connection)
        if hello.get("protocolVersion") != 3 or hello.get("operation") != "hello":
            raise RuntimeError("unsupported_operation")
        mount_runtime(hello)
        write_frame(
            connection,
            {
                "protocolVersion": 3,
                "requestId": hello["requestId"],
                "status": "ok",
                "operation": "hello",
                "nonLoopbackNetworkDeviceCount": interface_count(),
                "transport": "vsock",
                "capabilities": {
                    "sourceMount": "/source",
                    "workspaceMount": "/workspace",
                    "shell": "/bin/sh",
                    "executables": installed_executables(),
                },
            },
        )
        hydration = read_frame(connection)
        if hydration.get("protocolVersion") != 3 or hydration.get("operation") != "hydrate":
            raise RuntimeError("unsupported_operation")
        hydrate(hydration["workspace"])
        workspace_state = workspace_signatures(hydration["workspace"])
        write_frame(
            connection,
            {
                "protocolVersion": 3,
                "requestId": hydration["requestId"],
                "status": "ok",
                "operation": "hydrate",
            },
        )
        while True:
            request = read_frame(connection)
            operation = request.get("operation")
            if operation == "shutdown":
                break
            if request.get("protocolVersion") == 3 and operation == "cancel":
                continue
            if request.get("protocolVersion") != 3 or operation != "execute":
                raise RuntimeError("unsupported_operation")
            execution, workspace, close_after = execute(connection, request, workspace_state)
            delta = workspace_delta(workspace, workspace_state)
            write_frame(
                connection,
                {
                    "protocolVersion": 3,
                    "requestId": request["requestId"],
                    "executionId": request["executionId"],
                    "status": "ok",
                    "operation": "execute",
                    "nonLoopbackNetworkDeviceCount": interface_count(),
                    "scratchBytes": MAX_WORKSPACE_BYTES,
                    "transport": "vsock",
                    "execution": execution,
                    "workspaceDelta": delta,
                },
            )
            workspace_state = workspace_signatures(workspace)
            if close_after:
                break
    listener.close()


try:
    main()
except Exception as error:
    print(f"agent guest failed: {error}", file=os.sys.stderr, flush=True)
finally:
    os.sync()
    subprocess.run(["/sbin/poweroff", "-f"], check=False)
