#!/usr/bin/env bash
# Keep Docker's config/context and working credential helpers intact. Public pulls
# may proceed anonymously when a standard desktop helper is no longer installed.
set -euo pipefail
(($#)) || { echo 'Usage: with-optional-docker-credentials.sh COMMAND [ARGS...]' >&2; exit 1; }
orbit_helper_dir=$(mktemp -d "${TMPDIR:-/tmp}/orbit-docker-credentials.XXXXXXXX")
trap 'rm -rf -- "$orbit_helper_dir"' EXIT
for orbit_helper in osxkeychain desktop desktop.exe wincred wincred.exe pass secretservice; do
  if ! command -v "docker-credential-$orbit_helper" >/dev/null 2>&1; then
    cat > "$orbit_helper_dir/docker-credential-$orbit_helper" <<'HELPER'
#!/usr/bin/env sh
# An installer may have added a real helper since this wrapper was prepared.
orbit_lookup_path=""
orbit_saved_ifs=$IFS
IFS=:
for orbit_path in $PATH; do
  [ "$orbit_path" = "${0%/*}" ] && continue
  orbit_lookup_path="${orbit_lookup_path:+$orbit_lookup_path:}$orbit_path"
done
IFS=$orbit_saved_ifs
if orbit_real_helper=$(PATH="$orbit_lookup_path" command -v "${0##*/}"); then
  exec "$orbit_real_helper" "$@"
fi
case "$1" in
  get)
    echo 'Orbit: Docker credential helper is unavailable; trying anonymous registry access.' >&2
    # Exact Docker credential-helper protocol sentinel; do not expose/store secrets.
    echo 'credentials not found in native keychain'
    exit 1
    ;;
  *) echo 'Orbit fallback cannot store or erase Docker credentials. Install the original helper for docker login.' >&2; exit 1 ;;
esac
HELPER
    chmod 700 "$orbit_helper_dir/docker-credential-$orbit_helper"
  fi
done
export PATH="$orbit_helper_dir:$PATH"
export ORBIT_OPTIONAL_DOCKER_CREDENTIALS=1
"$@"
