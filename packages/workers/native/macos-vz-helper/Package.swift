// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "garden-desk-vz-helper",
    platforms: [.macOS(.v26)],
    products: [.executable(name: "garden-desk-vz-helper", targets: ["garden-desk-vz-helper"])],
    targets: [.executableTarget(name: "garden-desk-vz-helper")]
)
