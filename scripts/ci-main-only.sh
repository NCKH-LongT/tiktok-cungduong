#!/usr/bin/env bash
set -Eeuo pipefail

branch=${GIT_BRANCH:-}
if [[ -n $branch && $branch != main && $branch != origin/main ]]; then
  echo "Refusing CI/CD: checked-out branch is $branch, expected main" >&2
  exit 1
fi

if ! main_commit=$(git rev-parse --verify 'refs/remotes/origin/main^{commit}' 2>/dev/null); then
  echo 'Refusing CI/CD: origin/main is missing from the checkout' >&2
  exit 1
fi
head_commit=$(git rev-parse --verify HEAD)
if [[ $head_commit != "$main_commit" ]]; then
  echo 'Refusing CI/CD: HEAD does not match origin/main' >&2
  exit 1
fi

echo "Verified main commit $head_commit"
