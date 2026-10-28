#!/usr/bin/env bash
# Run from the group-view-test checkout. Never clears application storage.
set -euo pipefail
orbit_entry_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ ${ORBIT_OPTIONAL_DOCKER_CREDENTIALS:-} != 1 ]]; then
  exec bash "$orbit_entry_dir/scripts/with-optional-docker-credentials.sh" bash "$orbit_entry_dir/scripts/return-to-master.sh" "$@"
fi

# Bash parses this entire function before switching branches removes this file.
orbit_return_to_master() {
  (($# == 0)) || { echo 'Usage: bash scripts/return-to-master.sh' >&2; return 1; }
  cd -- "$orbit_entry_dir"
  source scripts/orbit-launch.sh
  command -v git >/dev/null || orbit_fail 'Git is required.'
  [[ $(git branch --show-current) == group-view-test ]] || orbit_fail 'Run this script from group-view-test.'
  [[ -z $(git status --porcelain) ]] || orbit_fail 'Save or commit local changes first. Nothing was stopped or discarded.'
  orbit_check_engine
  # Fetch into FETCH_HEAD, without overwriting any local branches.
  git fetch origin master
  local target previous
  target=$(git rev-parse FETCH_HEAD)
  previous=$(git rev-parse HEAD)
  if git show-ref --verify --quiet refs/heads/master; then
    git merge-base --is-ancestor master "$target" || orbit_fail 'Local master has unpublished or divergent commits. Resolve this manually; nothing was stopped.'
  fi
  [[ -z $(git worktree list --porcelain | sed -n '/^branch refs\/heads\/master$/p') ]] || orbit_fail 'master is open in another worktree. Nothing was stopped.'
  # Load helpers before checkout; leave all databases, files and browser settings intact.
  echo "Returning from group-view-test ($previous) to master ($target)."
  echo 'Application data and the group-view-test branch will be retained.'
  trap 'echo "Return failed. Data was not reset. Check git status and docker compose ps. If checkout failed, run docker compose start; otherwise retry docker compose up --build -d. Do not delete docker-data." >&2' ERR
  docker compose stop
  if git show-ref --verify --quiet refs/heads/master; then
    git switch --no-overwrite-ignore master
    git merge --ff-only "$target"
  else
    git switch --no-overwrite-ignore -c master "$target"
    git branch --set-upstream-to=origin/master master
  fi
  docker compose up --build -d
  orbit_wait
  trap - ERR
  echo 'Done: master. Grouping is disabled by this version; its unused cache is preserved.'
}
orbit_return_to_master "$@"
