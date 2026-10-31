#!/usr/bin/env bash
set -Eeuo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker CLI is missing on the Jenkins agent. Install it or use a Docker-capable agent.' >&2
  exit 127
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker daemon is unavailable to the Jenkins agent. Check its Docker socket/remote context and permissions.' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose plugin is missing on the Jenkins agent.' >&2
  exit 1
fi
if ! docker buildx version >/dev/null 2>&1; then
  echo 'Docker Buildx plugin is missing on the Jenkins agent.' >&2
  exit 1
fi

echo 'Docker CLI, daemon, Compose and Buildx are available'
