#!/usr/bin/env bash
set -Eeuo pipefail

repo=tiktok-cungduong-app
image_list=$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$repo:*")
mapfile -t versions < <(
  printf '%s\n' "$image_list" |
    sed -n "s/^$repo:\([0-9][0-9]*\)$/\1/p" |
    sort -nr -u
)

running_images=$(docker ps --filter label=com.docker.compose.project=tiktok-cungduong --format '{{.Image}}')
mapfile -t running_versions < <(
  printf '%s\n' "$running_images" |
    sed -n "s/^$repo:\([0-9][0-9]*\)$/\1/p" |
    sort -nr -u
)
if (( ${#running_versions[@]} > 3 )); then
  echo 'More than three CI images are used by running containers; refusing to remove a deployed image' >&2
  exit 1
fi

declare -A kept=()
kept_order=()
for version in "${running_versions[@]}"; do
  kept["$version"]=1
  kept_order+=("$version")
done
for version in "${versions[@]}"; do
  if (( ${#kept_order[@]} >= 3 )); then break; fi
  if [[ -z ${kept[$version]:-} ]]; then
    kept["$version"]=1
    kept_order+=("$version")
  fi
done
for version in "${versions[@]}"; do
  if [[ -z ${kept[$version]:-} ]]; then
    tag="$repo:$version"
    docker image rm --force "$tag"
    echo "Removed old CI image $tag"
  fi
done
legacy_list=$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter 'reference=tiktok-cungduong:*')
while IFS= read -r tag; do
  if [[ $tag =~ ^tiktok-cungduong:[0-9]+$ ]]; then
    docker image rm --force "$tag"
    echo "Removed legacy CI image $tag"
  fi
done <<< "$legacy_list"

echo "Kept ${#kept_order[@]} CI image tags (deployed image protected): ${kept_order[*]}"
