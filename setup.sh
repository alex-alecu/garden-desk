#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'This setup requires Apple silicon macOS. On Windows, use setup.ps1.' >&2
  exit 1
fi
if [[ "$EUID" == 0 ]]; then
  echo 'Run setup as your normal user. Installers will request administrator approval.' >&2
  exit 1
fi

node_version=$(tr -d '[:space:]' < .node-version)
pnpm_version=$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' package.json)
rust_version=$(sed -n 's/^channel = "\([^"]*\)"/\1/p' rust-toolchain.toml)
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
export COREPACK_ENABLE_NETWORK=0
export RUSTUP_AUTO_INSTALL=0

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer || exit 1
  case "$answer" in y|Y|yes|YES) ;; *) echo 'Setup cancelled.'; exit 1 ;; esac
}

has_build_tools() {
  xcode-select -p >/dev/null 2>&1 &&
    xcrun --find clang >/dev/null 2>&1 && xcrun --find swiftc >/dev/null 2>&1
}

has_rust() {
  local components
  rustup run "$rust_version" rustc --version >/dev/null 2>&1 || return 1
  components=$(rustup component list --toolchain "$rust_version" --installed 2>/dev/null) || return 1
  [[ "$components" == *cargo-* && "$components" == *clippy-* && "$components" == *rustfmt-* ]]
}

pnpm_version_installed() {
  (cd /; pnpm --version 2>/dev/null) || true
}

missing=()
need_node=false; need_pnpm=false; need_rust=false; need_build_tools=false; need_docker=false
if [[ "$(node --version 2>/dev/null || true)" != "v$node_version" ]]; then
  need_node=true; missing+=("Node.js $node_version")
fi
if [[ "$(pnpm_version_installed)" != "$pnpm_version" ]]; then
  need_pnpm=true; missing+=("pnpm $pnpm_version")
fi
if ! has_rust; then need_rust=true; missing+=("Rust $rust_version through rustup"); fi
if ! has_build_tools; then need_build_tools=true; missing+=('Xcode Command Line Tools for Tauri'); fi
docker_os=$(docker info --format '{{.OSType}}' 2>/dev/null || true)
if [[ "$docker_os" != linux && ! -d /Applications/Docker.app ]]; then
  need_docker=true; missing+=('Docker Desktop')
fi
if [[ "$docker_os" != linux ]]; then echo 'Docker must be started with Linux containers before model downloads.'; fi
echo 'Tauri CLI and project packages will use the versions in the lockfile.'
if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'Install or update: %s\n' "${missing[@]}"
  echo 'Official installers can request administrator approval. Existing tool versions can change.'
  confirm 'Install these tools?'
fi

setup_temp=$(mktemp -d)
cleanup() {
  if mount | grep -Fq " on $setup_temp/Docker "; then hdiutil detach "$setup_temp/Docker"; fi
  rm -rf "$setup_temp"
}
trap cleanup EXIT
download() { curl --fail --location --proto '=https' --tlsv1.2 "$1" --output "$2"; }

if $need_build_tools; then
  xcode-select --install
  read -r -p 'Complete the Apple installer, then press Enter. '
  has_build_tools || { echo 'Build tools are not ready. Complete installation and run setup again.' >&2; exit 1; }
fi
if $need_node; then
  node_package="node-v$node_version.pkg"
  download "https://nodejs.org/dist/v$node_version/$node_package" "$setup_temp/$node_package"
  download "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" "$setup_temp/SHASUMS256.txt"
  (cd "$setup_temp"; grep " $node_package\$" SHASUMS256.txt | shasum -a 256 --check)
  sudo installer -pkg "$setup_temp/$node_package" -target /
  export PATH="/usr/local/bin:$PATH"
fi
if $need_pnpm; then
  pnpm_prefix=$(npm prefix --global)
  if [[ -w "$pnpm_prefix/lib" ]]; then
    npm install --global "pnpm@$pnpm_version"
  else
    sudo env "PATH=$PATH" npm install --global "pnpm@$pnpm_version"
  fi
  export PATH="$pnpm_prefix/bin:$PATH"
fi
if $need_rust; then
  if command -v rustup >/dev/null; then
    rustup toolchain install "$rust_version" --profile minimal --component clippy --component rustfmt
  else
    rustup_url=https://static.rust-lang.org/rustup/dist/aarch64-apple-darwin/rustup-init
    download "$rustup_url" "$setup_temp/rustup-init"
    download "$rustup_url.sha256" "$setup_temp/rustup.sha256"
    (cd "$setup_temp"; shasum -a 256 --check rustup.sha256)
    chmod +x "$setup_temp/rustup-init"
    "$setup_temp/rustup-init" -y --default-toolchain "$rust_version" --profile minimal --component clippy --component rustfmt
  fi
fi
if $need_docker; then
  download https://desktop.docker.com/mac/main/arm64/Docker.dmg "$setup_temp/Docker.dmg"
  hdiutil attach "$setup_temp/Docker.dmg" -nobrowse -mountpoint "$setup_temp/Docker"
  spctl --assess --type execute "$setup_temp/Docker/Docker.app"
  sudo "$setup_temp/Docker/Docker.app/Contents/MacOS/install"
  hdiutil detach "$setup_temp/Docker"
fi

if [[ "$(node --version)" != "v$node_version" || "$(pnpm_version_installed)" != "$pnpm_version" ]] || ! has_rust || ! has_build_tools; then
  echo 'A required tool is not ready. Complete its installation and run setup again.' >&2
  exit 1
fi
if [[ "$(docker info --format '{{.OSType}}' 2>/dev/null || true)" != linux ]]; then
  confirm 'Start Docker Desktop with Linux containers?'
  open -a Docker
  read -r -p 'Complete Docker setup and its license prompt, then press Enter. '
  for ((attempt = 0; attempt < 60; attempt++)); do
    [[ "$(docker info --format '{{.OSType}}' 2>/dev/null || true)" == linux ]] && break
    sleep 2
  done
  if [[ "$(docker info --format '{{.OSType}}' 2>/dev/null || true)" != linux ]]; then
    echo 'Docker is not ready with Linux containers. Start Docker and run setup again.' >&2
    exit 1
  fi
fi

confirm 'Install project packages, download missing models and runtime files, build the guest image, and start Garden Desk?'
unset COREPACK_ENABLE_NETWORK RUSTUP_AUTO_INSTALL
pnpm install --frozen-lockfile --prefer-offline
pnpm setup:assets
pnpm start
