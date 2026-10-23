#!/usr/bin/env bash
# Run from any directory. Requires Bash and Docker Compose v2; no host Python needed.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
mode=migrate
project_override=""
while (($#)); do
  case "$1" in
    --init) mode=init; shift ;;
    --diagnose) mode=diagnose; shift ;;
    --project) project_override=${2:?Specify the existing Compose project name}; shift 2 ;;
    -h|--help) echo "Usage: bash scripts/migrate-docker-storage.sh [--project NAME] [--init | --diagnose]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
fail() { echo "ERROR: $*" >&2; exit 1; }
command -v docker >/dev/null || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Start Docker Desktop / Docker daemon, then retry."
docker compose version >/dev/null
# Pull before stopping anything. This image only provides cp and Python verification.
helper=python:3.12-slim-bookworm
docker image inspect "$helper" >/dev/null 2>&1 || docker pull "$helper"
legacy=(--project-directory "$root" -f "$root/compose.named-volumes.yaml")
if [[ -n "$project_override" ]]; then legacy+=(-p "$project_override"); fi
project=$(docker compose "${legacy[@]}" config --format json | docker run --rm -i --network none "$helper" python -c 'import json,sys; print(json.load(sys.stdin)["name"])')
current=(--project-directory "$root" -f "$root/compose.yaml" -p "$project")
base="$root/docker-data"
[[ "$base" != *,* ]] || fail "Docker --mount requires a project path without commas."
[[ ! -L "$base" ]] || fail "docker-data must not be a symlink."
folders=(orbit repositories repo-control whisper)
volume_keys=(orbit-data repository-cache repo-control whisper-models)
services=(orbit code-browser orbit voice)
targets=(/data /cache /repo-control /models)
volumes=()
# Inspect the actual existing mounts first; labels also support stopped/removed containers.
for i in 0 1 2 3; do
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=${services[$i]}" --filter "label=com.docker.compose.oneoff=False")
  volume=""
  if [[ -n "$ids" ]]; then
    [[ $(echo "$ids" | wc -l | tr -d ' ') == 1 ]] || fail "Multiple containers found for ${services[$i]}."
    volume=$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"${targets[$i]}\"}}{{if eq .Type \"volume\"}}{{.Name}}{{else}}BIND_MOUNT{{end}}{{end}}{{end}}" "$ids")
    [[ "$volume" != BIND_MOUNT ]] || fail "${services[$i]} already uses bind mounts. No migration performed."
  fi
  if [[ -z "$volume" ]]; then
    volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.volume=${volume_keys[$i]}")
  fi
  if [[ "$mode" == init ]]; then
    [[ -z "$volume" ]] || fail "Existing volume detected. Run without --init to migrate it."
  else
    [[ -n "$volume" ]] || fail "Volume ${volume_keys[$i]} not found for project '$project'. Check --project NAME. For a NEW installation only, use --init."
    [[ $(echo "$volume" | wc -l | tr -d ' ') == 1 ]] || fail "Ambiguous volume ${volume_keys[$i]}."
    docker volume inspect "$volume" >/dev/null
    echo "${volume_keys[$i]}: $volume -> docker-data/${folders[$i]}"
  fi
  volumes+=("$volume")
  [[ "$mode" == diagnose || ( ! -e "$base/${folders[$i]}" && ! -L "$base/${folders[$i]}" ) ]] || fail "docker-data/${folders[$i]} already exists. Nothing will be overwritten."
done
if [[ "$mode" == diagnose ]]; then
  [[ -d "$base" ]] || fail "No docker-data directory; no staging copy found."
  [[ ! -d "$base/.migration-lock" ]] || fail "Migration lock exists. Ensure no migration is running before removing a stale lock."
  for volume in "${volumes[@]}"; do
    [[ -z $(docker ps -q --filter "volume=$volume") ]] || fail "Stop the old services before verification: docker compose -f compose.named-volumes.yaml stop (with your --project name)."
  done
  stage_name=$(docker run --rm --network none --user 0 --mount "type=bind,src=$base,dst=/storage,readonly" "$helper" python -c 'from pathlib import Path; import re; paths=[p for p in Path("/storage").iterdir() if re.fullmatch(r".migration-[A-Za-z0-9]{8}",p.name) and p.is_dir() and not p.is_symlink()]; print(max(paths,key=lambda p:p.stat().st_mtime).name if paths else "")')
  [[ -n "$stage_name" ]] || fail "No staging copy found. Run migration again to obtain detailed diagnostics."
  stage="$base/$stage_name"
  echo "Diagnostic only: checking the latest staging copy ($stage_name). No files will be changed."
  failed=0
  for i in 0 1 2 3; do
    echo "Checking ${volume_keys[$i]}..."
    if docker run --rm --network none --user 0 \
      --mount "type=volume,src=${volumes[$i]},dst=/source,readonly" \
      --mount "type=bind,src=$stage,dst=/destination,readonly" \
      --mount "type=bind,src=$root/scripts/docker-storage-copy.py,dst=/copy.py,readonly" \
      "$helper" python /copy.py --verify /source "/destination/${folders[$i]}"; then
      :
    else
      failed=1
    fi
  done
  exit "$failed"
fi
mkdir -p "$base"
chmod 700 "$base"
mkdir "$base/.migration-lock" 2>/dev/null || fail "Another migration may be running (docker-data/.migration-lock)."
trap 'rmdir "$base/.migration-lock" 2>/dev/null || true' EXIT
if [[ "$mode" == init ]]; then
  docker run --rm --network none --user 0 --mount "type=bind,src=$base,dst=/destination" "$helper" sh -ec '
    mkdir /destination/orbit /destination/repositories /destination/repo-control /destination/whisper
    chown 1000:1000 /destination/orbit /destination/repositories /destination/repo-control
    chown 10001:10001 /destination/whisper
    chmod 700 /destination/orbit /destination/repositories /destination/repo-control /destination/whisper
  '
else
  # Keep sources untouched. A failed copy leaves services stopped for a consistent retry.
  stage=$(mktemp -d "$base/.migration-XXXXXXXX")
  echo "Stopping project '$project' for a consistent database and Git copy..."
  docker compose "${legacy[@]}" stop --timeout 60 orbit code-browser voice
  for volume in "${volumes[@]}"; do
    [[ -z $(docker ps -q --filter "volume=$volume") ]] || fail "A running container still uses $volume. Stop it before copying."
  done
  for i in 0 1 2 3; do
    echo "Copying and verifying ${volume_keys[$i]}..."
    docker run --rm --network none --user 0 \
      --mount "type=volume,src=${volumes[$i]},dst=/source,readonly" \
      --mount "type=bind,src=$stage,dst=/destination" \
      --mount "type=bind,src=$root/scripts/docker-storage-copy.py,dst=/copy.py,readonly" \
      "$helper" python /copy.py /source "/destination/${folders[$i]}"
  done
  # Publish only after every volume has been copied and verified.
  for folder in "${folders[@]}"; do mv "$stage/$folder" "$base/$folder"; done
  rmdir "$stage"
  echo "All copies verified. Original named volumes have NOT been deleted."
fi
printf 'Starting project %s using docker-data bind mounts...\n' "$project"
docker compose "${current[@]}" up -d --build
docker compose "${current[@]}" ps
echo "Done. Check http://localhost:43871 and keep the original volumes until you verify your data."
