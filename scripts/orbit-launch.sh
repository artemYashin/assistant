#!/usr/bin/env bash
# Shared startup checks. Source from a root-level entry point.
orbit_fail() { echo "ERROR: $*" >&2; echo "Startup NOT confirmed." >&2; exit 1; }
orbit_check_engine() {
  command -v docker >/dev/null || orbit_fail "Docker CLI not found."
  docker info >/dev/null 2>&1 || orbit_fail "Docker is unavailable. Start your container engine and retry."
  docker compose version >/dev/null || orbit_fail "Docker Compose v2 is required."
  local endpoint
  endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
  case "$endpoint" in unix://*|npipe://*) ;; *) orbit_fail "Use a local Docker engine; current endpoint: $endpoint" ;; esac
  [[ $(docker info --format '{{.OSType}}') == linux ]] || orbit_fail "Switch Docker to Linux containers."
}
orbit_start() {
  local count=0 folder
  [[ ! -L docker-data && ! -d docker-data/.migration-lock ]] || orbit_fail "Storage is linked or locked; inspect docker-data before retrying."
  for folder in orbit repositories repo-control whisper; do
    [[ ! -L docker-data/$folder ]] || orbit_fail "Storage symlink detected: $folder"
    if [[ -d docker-data/$folder ]]; then count=$((count + 1));
    elif [[ -e docker-data/$folder ]]; then orbit_fail "Expected a directory: docker-data/$folder"; fi
  done
  case "$count" in
    0) bash scripts/first-start.sh ;;
    4) echo 'Existing storage found; keeping all data.'; docker compose up --build -d ;;
    *) orbit_fail "Incomplete storage. Restore missing folders before retrying; existing data was not changed." ;;
  esac
}
orbit_wait() {
  local attempt container status
  echo 'Waiting for Orbit health check (up to 180 seconds)...'
  for ((attempt=0; attempt<90; attempt++)); do
    container=$(docker compose ps -q orbit)
    if [[ -n "$container" ]]; then
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$container")
      if [[ "$status" == healthy ]]; then
        echo 'Orbit successfully started: http://localhost:43871'
        return 0
      fi
    fi
    sleep 2
  done
  docker compose ps
  orbit_fail 'Orbit did not become healthy. Check: docker compose logs --tail=100 orbit. Address after recovery: http://localhost:43871 (startup NOT confirmed).'
}
