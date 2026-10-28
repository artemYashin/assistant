#!/usr/bin/env bash
# Run in an already downloaded Orbit checkout. Never clones or resets a repository.
set -euo pipefail
if [[ ${ORBIT_OPTIONAL_DOCKER_CREDENTIALS:-} != 1 ]]; then
  orbit_entry_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  exec bash "$orbit_entry_dir/scripts/with-optional-docker-credentials.sh" bash "$orbit_entry_dir/install.sh" "$@"
fi
if (($#)); then echo 'Usage: bash install.sh'; exit 1; fi
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source scripts/orbit-launch.sh
trap 'echo "Installation failed; startup NOT confirmed. See the error above. Data was not reset." >&2' ERR
export PATH="$PATH:$HOME/.rd/bin:/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin:/opt/rancher-desktop/resources/resources/linux/bin:/opt/homebrew/bin:/usr/local/bin"
if docker info >/dev/null 2>&1; then
  echo 'Docker is already running; skipping Rancher installation and configuration.'
else
  # Do not replace a stopped existing engine or silently change an existing Rancher setup.
  if command -v docker >/dev/null || command -v rdctl >/dev/null; then
    orbit_fail 'An existing container engine was found. Start it (Linux containers / Moby), then rerun. Its settings were not changed.'
  fi
  case "$(uname -s)" in
    Darwin)
      if ! command -v brew >/dev/null; then
        command -v curl >/dev/null || orbit_fail 'curl is required.'
        installer=$(mktemp)
        curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
        /bin/bash "$installer"
        rm -f "$installer"
      fi
      brew install --cask rancher
      ;;
    Linux)
      if [[ -n ${WSL_DISTRO_NAME:-} ]]; then orbit_fail 'Enable Docker/Rancher integration for this WSL distribution, then rerun.'; fi
      [[ -n ${DISPLAY:-}${WAYLAND_DISPLAY:-} && -r /dev/kvm && -w /dev/kvm ]] || orbit_fail 'Rancher needs a graphical desktop and read/write access to /dev/kvm. Configure these, or use an existing Docker Engine.'
      command -v apt-get >/dev/null || orbit_fail 'Automatic Linux installation supports Debian/Ubuntu. Install Rancher or Docker manually on this distribution, then rerun.'
      sudo apt-get update
      sudo apt-get install -y curl gpg ca-certificates
      key=$(mktemp)
      curl -fsSL https://download.opensuse.org/repositories/isv:/Rancher:/stable/deb/Release.key -o "$key"
      gpg --dearmor < "$key" | sudo tee /usr/share/keyrings/isv-rancher-stable-archive-keyring.gpg >/dev/null
      rm -f "$key"
      echo 'deb [signed-by=/usr/share/keyrings/isv-rancher-stable-archive-keyring.gpg] https://download.opensuse.org/repositories/isv:/Rancher:/stable/deb/ ./' | sudo tee /etc/apt/sources.list.d/isv-rancher-stable.list >/dev/null
      sudo apt-get update
      sudo apt-get install -y rancher-desktop
      ;;
    *) orbit_fail 'Use install.ps1 on Windows, or install.sh on macOS/Linux.' ;;
  esac
  rdctl start --container-engine.name=moby --kubernetes.enabled=false
  for ((attempt=0; attempt<120; attempt++)); do
    if docker --context rancher-desktop info >/dev/null 2>&1; then break; fi
    sleep 2
  done
  export DOCKER_CONTEXT=rancher-desktop
fi
orbit_check_engine
orbit_start
orbit_wait
