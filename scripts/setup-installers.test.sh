#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
setup_temp=$(mktemp -d)
trap 'rm -f "$setup_temp/"*; rmdir "$setup_temp"' EXIT
export setup_temp
export need_rust=true need_docker=true rust_version=1.97.0

download() {
  case "$1" in
    *.sha256) printf '%064d  rustup-init\n' 0 > "$2" ;;
    *) printf '#!/bin/sh\ntouch "%s/installer-ran"\n' "$setup_temp" > "$2" ;;
  esac
}
command() {
  if [[ "$*" == '-v rustup' ]]; then return 1; fi
  builtin command "$@"
}
sudo() { touch "$setup_temp/installer-ran"; }
hdiutil() { :; }
spctl() { return 1; }
shasum() { return 1; }
export -f download command sudo hdiutil spctl shasum

for tool in rust docker; do
  block=$(sed -n "/^if \$need_$tool; then/,/^fi$/p" setup.sh)
  if bash -euc "$block"; then
    echo "FAIL: $tool accepted an invalid installer." >&2
    exit 1
  fi
  if [[ -e "$setup_temp/installer-ran" ]]; then
    echo "FAIL: $tool ran an invalid installer." >&2
    exit 1
  fi
done
echo 'PASS: Invalid Rust and Docker installers cannot run.'
