#!/usr/bin/env bash
set -Eeuo pipefail

build_number=${BUILD_NUMBER:?Jenkins BUILD_NUMBER required}
if [[ ! $build_number =~ ^[0-9]+$ ]]; then
  echo 'BUILD_NUMBER must be numeric' >&2
  exit 2
fi

workspace=${WORKSPACE:-$(pwd)}
cache_file="$workspace/.docker-build-cache.tar"
builder=tiktok-cungduong-ci
work=$(mktemp -d "$workspace/.docker-cache-work.XXXXXXXX")
cleanup() {
  local status=$?
  if (( status != 0 )); then
    docker buildx prune --builder "$builder" --all --force >/dev/null 2>&1 || true
  fi
  rm -r "$work"
}
trap cleanup EXIT

if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container >/dev/null
fi
docker buildx inspect "$builder" --bootstrap >/dev/null

cache_args=()
if [[ -f $cache_file ]]; then
  mkdir -p "$work/import"
  tar -xf "$cache_file" -C "$work/import"
  cache_args+=(--cache-from "type=local,src=$work/import")
fi

docker buildx build --builder "$builder" --file infrastructure/docker/Dockerfile \
  --tag "tiktok-cungduong-app:$build_number" --load \
  --cache-to "type=local,dest=$work/export,mode=max" \
  "${cache_args[@]}" .

tar -cf "$work/cache.tar" -C "$work/export" .
mv -f "$work/cache.tar" "$cache_file"
docker buildx prune --builder "$builder" --all --force >/dev/null
echo "Docker image tiktok-cungduong-app:$build_number built; one cache archive kept at $cache_file"
