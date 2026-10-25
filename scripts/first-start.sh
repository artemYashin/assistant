#!/usr/bin/env bash
# Prepare storage and start a NEW Orbit installation. Existing data is never overwritten.
set -euo pipefail
if (($#)); then
  echo "Usage: bash scripts/first-start.sh"
  exit 1
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$script_dir/migrate-docker-storage.sh" --init
