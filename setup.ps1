$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This setup requires Windows x64.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ([Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run setup in standard PowerShell. Installers will request administrator approval.'
}
$edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
if ($edition -notmatch '^(Professional|Enterprise)' -or -not (Get-Service vmms -ErrorAction SilentlyContinue)) {
    throw 'Use Windows Pro or Enterprise with Hyper-V enabled. Restart Windows after enabling Hyper-V, then run setup again.'
}

$package = Get-Content package.json -Raw | ConvertFrom-Json
$nodeVersion = $package.engines.node
$pnpmVersion = $package.engines.pnpm
$rustVersion = [regex]::Match((Get-Content rust-toolchain.toml -Raw), 'channel = "([^"]+)"').Groups[1].Value
$cargoRoot = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
$dockerRoot = Join-Path $env:ProgramFiles 'Docker\Docker'
if (Test-Path "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe") {
    $dockerRoot = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop'
}
$env:PATH = "$cargoRoot\bin;$dockerRoot\resources\bin;$env:APPDATA\npm;$env:PATH"
$env:COREPACK_ENABLE_NETWORK = '0'
$env:RUSTUP_AUTO_INSTALL = '0'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Confirm-Setup([string]$Message) {
    if ((Read-Host "$Message [y/N]") -notmatch '^(y|yes)$') { throw 'Setup cancelled.' }
}

function Read-Tool([string]$Command, [string[]]$Arguments) {
    try {
        if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { return '' }
        $output = & $Command @Arguments 2>$null
        if ($LASTEXITCODE -eq 0) { return ($output -join "`n").Trim() }
    } catch { }
    return ''
}

function Read-PnpmVersion {
    Push-Location $env:TEMP
    try { return Read-Tool 'pnpm' @('--version') } finally { Pop-Location }
}

function Test-Rust {
    $toolchain = "$rustVersion-x86_64-pc-windows-msvc"
    if ((Read-Tool 'rustup.exe' @('run', $toolchain, 'rustc', '--version')) -eq '') { return $false }
    $components = Read-Tool 'rustup.exe' @('component', 'list', '--toolchain', $toolchain, '--installed')
    return $components -match 'cargo-' -and $components -match 'clippy-' -and $components -match 'rustfmt-'
}

function Test-BuildTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $installation = Read-Tool $vswhere @('-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath')
    return $installation -ne '' -and (Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Include\*\um\Windows.h")
}

function Test-WebView {
    $client = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($key in @("HKLM:\SOFTWARE\WOW6432Node\$client", "HKCU:\Software\$client")) {
        $version = Get-ItemPropertyValue $key -Name pv -ErrorAction SilentlyContinue
        if ($version -and $version -ne '0.0.0.0') { return $true }
    }
    return $false
}

$needNode = (Read-Tool 'node.exe' @('--version')) -ne "v$nodeVersion"
$needPnpm = (Read-PnpmVersion) -ne $pnpmVersion
$needRust = -not (Test-Rust)
$needBuildTools = -not (Test-BuildTools)
$needWebView = -not (Test-WebView)
$dockerOS = Read-Tool 'docker.exe' @('info', '--format', '{{.OSType}}')
$needDocker = $dockerOS -ne 'linux' -and -not (Test-Path "$dockerRoot\Docker Desktop.exe")
if ($dockerOS -ne 'linux') { Write-Host 'Docker must be started with Linux containers before model downloads.' }
Write-Host 'Tauri CLI and project packages will use the versions in the lockfile.'
if ($needNode) { Write-Host "Install or update: Node.js $nodeVersion" }
if ($needPnpm) { Write-Host "Install or update: pnpm $pnpmVersion" }
if ($needRust) { Write-Host "Install or update: Rust $rustVersion through rustup" }
if ($needBuildTools) { Write-Host 'Install: Microsoft C++ Build Tools and Windows SDK for Tauri' }
if ($needWebView) { Write-Host 'Install: Microsoft Edge WebView2 Runtime for Tauri' }
if ($needDocker) { Write-Host 'Install: Docker Desktop with the Hyper-V backend' }
if ($needNode -or $needPnpm -or $needRust -or $needBuildTools -or $needWebView -or $needDocker) {
    Write-Host 'Official installers can request administrator approval. Existing tool versions can change.'
    Confirm-Setup 'Install these tools?'
}

$setupTemp = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
New-Item $setupTemp -ItemType Directory | Out-Null
function Get-Installer([string]$Url, [string]$Name) {
    $file = Join-Path $setupTemp $Name
    Invoke-WebRequest $Url -OutFile $file -UseBasicParsing
    return $file
}
function Install-Program([string]$File, [string[]]$Arguments) {
    if ((Get-AuthenticodeSignature $File).Status -ne 'Valid') { throw "Invalid installer signature: $File" }
    if ([IO.Path]::GetExtension($File) -eq '.msi') {
        $Arguments = @('/i', "`"$File`"", '/norestart')
        $File = 'msiexec.exe'
    }
    $process = Start-Process $File -ArgumentList $Arguments -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -eq 3010) { throw 'Restart Windows, then run setup again.' }
    if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)." }
}
function Invoke-Tool([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

try {
    if ($needBuildTools) {
        $file = Get-Installer 'https://aka.ms/vs/17/release/vs_buildtools.exe' 'vs_buildtools.exe'
        Install-Program $file @('--wait', '--norestart', '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended')
    }
    if ($needWebView) {
        $file = Get-Installer 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' 'WebView2Setup.exe'
        Install-Program $file @('/install')
    }
    if ($needNode) {
        $file = Get-Installer "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi" 'node.msi'
        Install-Program $file @()
        $env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"
    }
    if ($needPnpm) { Invoke-Tool 'npm.cmd' @('install', '--global', "pnpm@$pnpmVersion") }
    if ($needRust) {
        if (Get-Command rustup.exe -ErrorAction SilentlyContinue) {
            Invoke-Tool 'rustup.exe' @('toolchain', 'install', "$rustVersion-x86_64-pc-windows-msvc", '--profile', 'minimal', '--component', 'clippy', '--component', 'rustfmt')
        } else {
            $url = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
            $file = Get-Installer $url 'rustup-init.exe'
            $checksum = Get-Installer "$url.sha256" 'rustup.sha256'
            $expected = ((Get-Content $checksum -Raw).Trim() -split '\s+')[0]
            if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $expected) { throw 'Rust installer checksum does not match.' }
            Invoke-Tool $file @('-y', '--default-host', 'x86_64-pc-windows-msvc', '--default-toolchain', $rustVersion, '--profile', 'minimal', '--component', 'clippy', '--component', 'rustfmt')
        }
    }
    if ($needDocker) {
        $file = Get-Installer 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe' 'DockerInstaller.exe'
        Install-Program $file @('install', '--backend=hyper-v')
    }
    if ((Read-Tool 'node.exe' @('--version')) -ne "v$nodeVersion" -or (Read-PnpmVersion) -ne $pnpmVersion -or
        -not (Test-Rust) -or
        -not (Test-BuildTools) -or -not (Test-WebView)) {
        throw 'A required tool is not ready. Complete its installation and run setup again.'
    }
    if ((Read-Tool 'docker.exe' @('info', '--format', '{{.OSType}}')) -ne 'linux') {
        Confirm-Setup 'Start Docker Desktop with Linux containers?'
        Start-Process "$dockerRoot\Docker Desktop.exe"
        Read-Host 'Complete Docker setup and its license prompt, then press Enter' | Out-Null
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ((Read-Tool 'docker.exe' @('info', '--format', '{{.OSType}}')) -eq 'linux') { break }
            Start-Sleep -Seconds 2
        }
        if ((Read-Tool 'docker.exe' @('info', '--format', '{{.OSType}}')) -ne 'linux') {
            throw 'Docker is not ready with Linux containers. Start Docker and run setup again.'
        }
    }
    Confirm-Setup 'Install project packages, download missing models and runtime files, build the guest image, and start Garden Desk?'
    Remove-Item Env:COREPACK_ENABLE_NETWORK, Env:RUSTUP_AUTO_INSTALL
    Invoke-Tool 'pnpm' @('install', '--frozen-lockfile', '--prefer-offline')
    Invoke-Tool 'pnpm' @('setup:assets')
    Invoke-Tool 'pnpm' @('start')
} finally {
    Remove-Item $setupTemp -Recurse -Force
}
