import Darwin
import Foundation
import Virtualization

enum HelperError: Error {
    case invalidArguments
    case invalidFrame
    case socketClosed
    case socketUnavailable
}

struct Arguments {
    let kernel: URL
    let initramfs: URL
    let cpuCount: Int
    let memoryBytes: UInt64
    let scratch: URL?
    let inputs: [URL]
    let source: URL?
}

func parseArguments() throws -> Arguments {
    var values: [String: String] = [:]
    var inputs: [URL] = []
    var index = 1
    while index < CommandLine.arguments.count {
        let key = CommandLine.arguments[index]
        guard index + 1 < CommandLine.arguments.count else { throw HelperError.invalidArguments }
        let value = CommandLine.arguments[index + 1]
        if key == "--input" {
            inputs.append(URL(fileURLWithPath: value))
        } else {
            values[key] = value
        }
        index += 2
    }
    guard let kernel = values["--kernel"], let initramfs = values["--initramfs"],
          let cpuText = values["--cpus"], let cpuCount = Int(cpuText),
          let memoryText = values["--memory"], let memoryBytes = UInt64(memoryText) else {
        throw HelperError.invalidArguments
    }
    return Arguments(
        kernel: URL(fileURLWithPath: kernel),
        initramfs: URL(fileURLWithPath: initramfs),
        cpuCount: cpuCount,
        memoryBytes: memoryBytes,
        scratch: values["--scratch"].map { URL(fileURLWithPath: $0) },
        inputs: inputs,
        source: values["--source"].map { URL(fileURLWithPath: $0) }
    )
}

func readExact(count: Int, from descriptor: Int32) throws -> Data {
    var data = Data(count: count)
    var offset = 0
    while offset < count {
        let received = data.withUnsafeMutableBytes { buffer in
            Darwin.read(descriptor, buffer.baseAddress!.advanced(by: offset), count - offset)
        }
        if received > 0 {
            offset += received
        } else if received == 0 {
            throw HelperError.socketClosed
        } else if errno != EINTR {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }
    return data
}

func writeAll(_ data: Data, to descriptor: Int32) throws {
    try data.withUnsafeBytes { buffer in
        var offset = 0
        while offset < data.count {
            let written = Darwin.write(
                descriptor,
                buffer.baseAddress!.advanced(by: offset),
                data.count - offset
            )
            if written > 0 {
                offset += written
            } else if written == 0 {
                throw HelperError.socketClosed
            } else if errno != EINTR {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
        }
    }
}

func writeFrame(_ payload: Data, to descriptor: Int32) throws {
    guard !payload.isEmpty, payload.count <= 256 * 1024 else { throw HelperError.invalidFrame }
    let length = UInt32(payload.count)
    try writeAll(Data([
        UInt8(length >> 24), UInt8((length >> 16) & 0xff),
        UInt8((length >> 8) & 0xff), UInt8(length & 0xff),
    ]), to: descriptor)
    try writeAll(payload, to: descriptor)
}

func readFrame(from descriptor: Int32) throws -> Data {
    let header = try readExact(count: 4, from: descriptor)
    let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard length > 0, length <= 64 * 1024 * 1024 else { throw HelperError.invalidFrame }
    return try readExact(count: Int(length), from: descriptor)
}

struct RelayFrameValidator {
    private var header: [UInt8] = []
    private var remaining: UInt32?

    mutating func accept(_ data: Data) throws {
        for byte in data {
            if let payloadRemaining = remaining {
                let next = payloadRemaining - 1
                remaining = next == 0 ? nil : next
                continue
            }
            header.append(byte)
            if header.count == 4 {
                let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
                guard length > 0, length <= 192 * 1024 * 1024 else {
                    throw HelperError.invalidFrame
                }
                header.removeAll(keepingCapacity: true)
                remaining = length
            }
        }
    }

    func finish() throws {
        guard header.isEmpty, remaining == nil else { throw HelperError.invalidFrame }
    }
}

func relay(input: Int32, guest: Int32, output: Int32) throws {
    var descriptors = [
        pollfd(fd: input, events: Int16(POLLIN), revents: 0),
        pollfd(fd: guest, events: Int16(POLLIN), revents: 0),
    ]
    var validators = [RelayFrameValidator(), RelayFrameValidator()]
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
        let ready = poll(&descriptors, nfds_t(descriptors.count), -1)
        if ready < 0 {
            if errno == EINTR { continue }
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        for index in descriptors.indices where descriptors[index].revents != 0 {
            let source = descriptors[index].fd
            let destination = index == 0 ? guest : output
            let count = Darwin.read(source, &buffer, buffer.count)
            if count == 0 {
                try validators[index].finish()
                return
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
            try buffer.withUnsafeBytes { bytes in
                let data = Data(bytes.prefix(count))
                try validators[index].accept(data)
                try writeAll(data, to: destination)
            }
        }
    }
}

@MainActor
func connectWithRetry(_ device: VZVirtioSocketDevice) async throws -> VZVirtioSocketConnection {
    var lastError: Error = HelperError.socketUnavailable
    for _ in 0..<80 {
        do {
            return try await device.connect(toPort: 4050)
        } catch {
            lastError = error
            try await Task.sleep(for: .milliseconds(250))
        }
    }
    throw lastError
}

func storageDevices(_ arguments: Arguments) throws -> [VZStorageDeviceConfiguration] {
    var devices: [VZStorageDeviceConfiguration] = []
    for input in arguments.inputs {
        let attachment = try VZDiskImageStorageDeviceAttachment(url: input, readOnly: true)
        devices.append(VZVirtioBlockDeviceConfiguration(attachment: attachment))
    }
    if let scratch = arguments.scratch,
       (try scratch.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) > 0 {
        let attachment = try VZDiskImageStorageDeviceAttachment(
            url: scratch,
            readOnly: false
        )
        devices.append(VZVirtioBlockDeviceConfiguration(attachment: attachment))
    }
    return devices
}

func configuration(_ arguments: Arguments) throws -> VZVirtualMachineConfiguration {
    let bootLoader = VZLinuxBootLoader(kernelURL: arguments.kernel)
    bootLoader.initialRamdiskURL = arguments.initramfs
    bootLoader.commandLine = "console=hvc0 init=/sbin/init panic=-1 dummy.numdummies=0"
    let serialPort = VZVirtioConsoleDeviceSerialPortConfiguration()
    serialPort.attachment = VZFileHandleSerialPortAttachment(
        fileHandleForReading: nil,
        fileHandleForWriting: FileHandle.standardError
    )
    let result = VZVirtualMachineConfiguration()
    result.bootLoader = bootLoader
    result.cpuCount = arguments.cpuCount
    result.memorySize = arguments.memoryBytes
    result.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
    result.networkDevices = []
    result.serialPorts = [serialPort]
    result.socketDevices = [VZVirtioSocketDeviceConfiguration()]
    result.storageDevices = try storageDevices(arguments)
    if let source = arguments.source {
        let fileSystem = VZVirtioFileSystemDeviceConfiguration(tag: "source")
        fileSystem.share = VZSingleDirectoryShare(
            directory: VZSharedDirectory(url: source, readOnly: true)
        )
        result.directorySharingDevices = [fileSystem]
    }
    try result.validate()
    return result
}

@main
struct GardenDeskVirtualizationHelper {
    @MainActor
    static func main() async throws {
        let arguments = try parseArguments()
        let machineConfiguration = try configuration(arguments)
        let virtualMachine = VZVirtualMachine(configuration: machineConfiguration)
        try await virtualMachine.start()
        guard let socket = virtualMachine.socketDevices.first as? VZVirtioSocketDevice else {
            throw HelperError.socketUnavailable
        }
        let connection = try await connectWithRetry(socket)
        if arguments.source != nil {
            try relay(
                input: STDIN_FILENO,
                guest: connection.fileDescriptor,
                output: STDOUT_FILENO
            )
        } else {
            let probe: [String: Any] = [
                "jobId": "00000000-0000-4000-8000-000000000001",
                "operation": "probe",
                "protocolVersion": 1,
                "requestId": "m1-probe",
            ]
            let request = try JSONSerialization.data(withJSONObject: probe, options: [.sortedKeys])
            try writeFrame(request, to: connection.fileDescriptor)
            let guest = try JSONSerialization.jsonObject(
                with: readFrame(from: connection.fileDescriptor)
            ) as? [String: Any]
            let scratchSize = try arguments.scratch?.resourceValues(
                forKeys: [.fileSizeKey]
            ).fileSize ?? 0
            let result: [String: Any] = [
                "classification": "certified",
                "guest": guest ?? [:],
                "networkDeviceCount": machineConfiguration.networkDevices.count,
                "readOnlyInputCount": arguments.inputs.count,
                "scratchBytes": scratchSize,
                "socketDeviceCount": machineConfiguration.socketDevices.count,
            ]
            let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            FileHandle.standardOutput.write(output)
            FileHandle.standardOutput.write(Data([0x0A]))
        }
        connection.close()
        if virtualMachine.canStop {
            try await virtualMachine.stop()
        }
    }
}
