#!/usr/bin/env bash
set -Eeuo pipefail

env_file=${1:?Jenkins secret env file required}
build_number=${2:?Build number required}
if [[ ! $build_number =~ ^[0-9]+$ || ! -r $env_file ]]; then
  echo 'Invalid build number or unreadable deploy env file' >&2
  exit 2
fi

export APP_IMAGE="tiktok-cungduong-app:$build_number"
docker image inspect "$APP_IMAGE" >/dev/null
docker compose --env-file "$env_file" config -q
docker compose --env-file "$env_file" up -d --no-build --wait
echo "Deployed $APP_IMAGE"
