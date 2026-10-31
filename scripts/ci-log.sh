#!/usr/bin/env bash
set -u

stage=${1:?Stage name required}
shift
if [[ ! $stage =~ ^[a-z0-9-]+$ || $# -eq 0 ]]; then
  echo 'Invalid CI stage or missing command' >&2
  exit 2
fi

mkdir -p ci-logs
"$@" 2>&1 | tee "ci-logs/$stage.log"
statuses=("${PIPESTATUS[@]}")
if (( statuses[0] != 0 )); then
  printf 'ERROR: %s failed with exit code %s\n' "$stage" "${statuses[0]}" | tee -a "ci-logs/$stage.log" >&2
  exit "${statuses[0]}"
fi
if (( statuses[1] != 0 )); then
  echo "ERROR: could not write log for $stage" >&2
  exit "${statuses[1]}"
fi
