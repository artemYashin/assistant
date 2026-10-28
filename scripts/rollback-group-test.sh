#!/usr/bin/env bash
# Remove only the experimental hierarchy cache; do not start the group-test app again.
set -euo pipefail
if (($#)); then echo 'Usage: bash scripts/rollback-group-test.sh'; exit 1; fi
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source scripts/orbit-launch.sh
orbit_check_engine
command -v git >/dev/null || orbit_fail 'Git is required.'
[[ $(git branch --show-current) == group-test ]] || orbit_fail 'Run this script from group-test.'
[[ -z $(git status --porcelain) ]] || orbit_fail 'Save local changes before rollback. Nothing was stopped.'
git rev-parse --verify master >/dev/null || orbit_fail 'Local master branch is missing. Nothing was stopped.'
[[ -n $(docker compose images -q orbit) ]] || orbit_fail 'Existing Orbit image is required. No image will be built or downloaded.'
trap 'echo "Rollback did not finish. Orbit may be stopped. Do not delete data or backups. To return to the current version: docker compose start orbit. Do not switch branches until the error is resolved." >&2' ERR
# The application is the only writer. Never invoke Store or application startup during cleanup.
docker compose stop orbit
docker compose run --rm --no-deps --pull never -T --entrypoint node orbit --input-type=module < scripts/rollback-group-test.mjs
echo 'Rollback prepared. Orbit remains STOPPED; startup has not been confirmed.'
echo 'Switch to master and rebuild using the SAME data folders:'
echo '  git switch master && docker compose up --build -d'
echo 'Check startup: docker compose ps; docker compose logs --tail=100 orbit'
echo 'After Orbit is healthy, open http://localhost:43871 and reload the browser page.'
