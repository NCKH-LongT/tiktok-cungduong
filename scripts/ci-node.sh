#!/usr/bin/env bash
set -Eeuo pipefail

if (( $# == 0 )); then
  echo 'Usage: ci-node.sh <node or npm command> [args...]' >&2
  exit 2
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)
  if [[ $major == 22 ]]; then
    exec "$@"
  fi
fi

version=v22.23.2
case $(uname -m) in
  x86_64|amd64)
    arch=x64
    checksum=b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a
    ;;
  aarch64|arm64)
    arch=arm64
    checksum=013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30
    ;;
  *)
    echo "Unsupported Node.js architecture: $(uname -m)" >&2
    exit 2
    ;;
esac

tool_root="${WORKSPACE:-$PWD}/.ci-tools"
node_home="$tool_root/node-$version"
if [[ ! -x $node_home/bin/node ]]; then
  for program in curl tar sha256sum mktemp; do
    if ! command -v "$program" >/dev/null 2>&1; then
      echo "Node.js bootstrap requires $program on the Jenkins agent" >&2
      exit 127
    fi
  done
  mkdir -p "$tool_root"
  archive=$(mktemp "$tool_root/node.XXXXXXXX.tar.gz")
  extract=$(mktemp -d "$tool_root/extract.XXXXXXXX")
  cleanup() {
    if [[ -e $archive ]]; then rm -- "$archive"; fi
    if [[ -d $extract ]]; then rm -r -- "$extract"; fi
  }
  trap cleanup EXIT
  echo "Installing Node.js $version ($arch) in Jenkins workspace"
  curl --fail --silent --show-error --location --retry 3 \
    "https://nodejs.org/dist/$version/node-$version-linux-$arch.tar.gz" \
    --output "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C "$extract" --strip-components=1
  mv -- "$extract" "$node_home"
fi

export PATH="$node_home/bin:$PATH"
exec "$@"
