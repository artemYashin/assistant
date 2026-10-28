#!/usr/bin/env bash
set -euo pipefail
if [[ ${ORBIT_OPTIONAL_DOCKER_CREDENTIALS:-} != 1 ]]; then
  orbit_entry_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  exec bash "$orbit_entry_dir/scripts/with-optional-docker-credentials.sh" bash "$orbit_entry_dir/update.sh" "$@"
fi
if (($#)); then echo 'Usage: bash update.sh'; exit 1; fi
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source scripts/orbit-launch.sh
orbit_check_engine
command -v git >/dev/null || orbit_fail 'Git is required.'
[[ -z $(git status --porcelain) ]] || orbit_fail 'Save or commit local changes before updating. Nothing was stopped.'
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null || orbit_fail 'The current branch needs an upstream.'
# Fetch before downtime: authentication/network errors do not stop the application.
git fetch
trap 'echo "Update failed; startup NOT confirmed. Data was not reset. If pull failed, use docker compose start; after a build failure, retry docker compose up --build -d." >&2' ERR
docker compose stop
git pull --ff-only
docker compose up --build -d
orbit_wait
