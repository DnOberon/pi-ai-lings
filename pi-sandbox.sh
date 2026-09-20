#!/bin/bash
# Launch pi with access limited to one workspace and pi's installed dependencies.
set -eu

usage() {
  echo "Usage: $0 /path/to/workspace [pi arguments...]" >&2
  exit 64
}

[ "$#" -ge 1 ] || usage
WORKSPACE=$(cd "$1" 2>/dev/null && pwd -P) || {
  echo "Workspace does not exist: $1" >&2
  exit 66
}
shift
PI_ARGS=("$@")

PI_AGENT_DIR=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
[ -d "$PI_AGENT_DIR" ] || {
  echo "Pi agent directory does not exist: $PI_AGENT_DIR" >&2
  exit 66
}

# Values discovered when this script was built on Darwin.
NODE=/opt/homebrew/bin/node
PI_CLI=/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
NPM_ROOT=/opt/homebrew/lib/node_modules

run_macos() {
  command -v sandbox-exec >/dev/null 2>&1 || {
    echo "sandbox-exec not installed; cannot launch sandbox" >&2
    exit 69
  }
  [ -x "$NODE" ] || {
    echo "Node not found: $NODE" >&2
    exit 69
  }
  [ -f "$PI_CLI" ] || {
    echo "Pi CLI not found: $PI_CLI" >&2
    exit 69
  }

  PROFILE=$(mktemp "${TMPDIR:-/tmp}/pipu.XXXXXX.sb")
  trap 'rm -f "$PROFILE"' EXIT HUP INT TERM
  cat >"$PROFILE" <<'SBPROFILE'
(version 1)
(deny default)

; Workspace is only writable project location.
(allow file-read* file-write* (subpath (param "WORKSPACE")))
; Workspace credentials stay outside sandbox even though workspace is broadly allowed.
(deny file-read* file-write* (literal (param "WORKSPACE_AUTH_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_ENV_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_ENV_LOCAL_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_ENV_DEVELOPMENT_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_ENV_PRODUCTION_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_ENV_TEST_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_ENVRC_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_CREDENTIALS_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_SECRETS_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_SERVICE_ACCOUNT_FILE")))
(deny file-read* file-write* (literal (param "WORKSPACE_NPMRC_FILE")))

; Pi configuration and installed JavaScript dependencies are readable only.
(allow file-read* (subpath (param "PI_AGENT_DIR")))
; Broad agent-dir read is needed for installed packages, but auth must stay host-only.
(deny file-read* file-write* (literal (param "AUTH_FILE")))
; Pi persists session transcripts under this directory.
(allow file-read* file-write* (subpath (param "PI_SESSION_DIR")))
(allow file-read* file-write* (literal (param "SETTINGS_LOCK")))
(allow file-read* (subpath (param "NPM_ROOT")))
(allow file-read* (literal (param "NODE")))
(allow file-read* (literal (param "PI_CLI")))

; macOS 26 dyld needs metadata access to filesystem root while resolving
; absolute library paths. Literal root exposes directory metadata only.
(allow file-read* (literal "/"))
(allow file-read-metadata)

; Runtime and standard system libraries.
(allow file-read* (subpath "/usr/bin"))
(allow file-read* (subpath "/usr/sbin"))
(allow file-read* (subpath "/usr/lib"))
(allow file-read* (subpath "/usr/local/bin"))
(allow file-read* (subpath "/System/Library"))
(allow file-read* (subpath "/System/Applications"))
(allow file-read* (subpath "/Library/Developer/CommandLineTools"))
(allow file-read* (subpath "/opt/homebrew/Cellar"))
; Homebrew Node links system libraries through /opt/homebrew/opt.
(allow file-read* (subpath "/opt/homebrew/opt"))
(allow file-read* (subpath "/opt/homebrew/etc"))
(allow file-read* (subpath "/opt/homebrew/lib"))
(allow file-read* (subpath "/opt/homebrew/bin"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/sbin"))
(allow file-read* (subpath "/private/var/db"))
; Go toolchain and user-installed Go commands/cache.
(allow file-read* file-write* (subpath (param "HOME_GO")))
(allow file-read* file-write* (subpath (param "HOME_GO_CACHE")))

; Temporary files, npm cache, and process runtime state.
(allow file-read* file-write* (subpath "/private/tmp"))
(allow file-read* file-write* (subpath "/tmp"))
(allow file-read* file-write* (subpath "/private/var/folders"))

; Required child-process, Node runtime, terminal, and network operations.
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow mach-host*)
(allow mach-lookup)
(allow iokit-open)
(allow ipc-posix-sem)
(allow file-ioctl)
(allow pseudo-tty)
(allow file-read* file-write* (literal "/dev/ptmx"))
(allow file-read* file-write* (regex "^/dev/ttys[0-9]+"))
(allow file-read* file-write* (literal "/dev/null"))
(allow file-read* file-write* (literal "/dev/zero"))
(allow file-read* (literal "/dev/random"))
(allow file-read* (literal "/dev/urandom"))
(allow network*)

; Explicit sensitive-path denials remain in force if policy changes later.
(deny file-read* file-write* (subpath (param "HOME_SSH")))
(deny file-read* file-write* (subpath (param "HOME_DOCUMENTS")))
(deny file-read* file-write* (subpath (param "HOME_DESKTOP")))
(deny file-read* file-write* (subpath (param "HOME_DOWNLOADS")))
(deny file-read* file-write* (subpath (param "HOME_AWS")))
(deny file-read* file-write* (subpath (param "HOME_GCLOUD")))
(deny file-read* file-write* (subpath "/System/Library/Keychains"))
(deny file-read* file-write* (subpath "/Library/Keychains"))
SBPROFILE

  cd "$WORKSPACE"
  safe_environment_args
  env -i "${SAFE_ENV_ARGS[@]}" \
    sandbox-exec -f "$PROFILE" \
    -D WORKSPACE="$WORKSPACE" \
    -D PI_AGENT_DIR="$PI_AGENT_DIR" \
    -D PI_SESSION_DIR="$PI_AGENT_DIR/sessions" \
    -D SETTINGS_LOCK="$PI_AGENT_DIR/settings.json.lock" \
    -D AUTH_FILE="$PI_AGENT_DIR/auth.json" \
    -D WORKSPACE_AUTH_FILE="$WORKSPACE/auth.json" \
    -D WORKSPACE_ENV_FILE="$WORKSPACE/.env" \
    -D WORKSPACE_ENV_LOCAL_FILE="$WORKSPACE/.env.local" \
    -D WORKSPACE_ENV_DEVELOPMENT_FILE="$WORKSPACE/.env.development" \
    -D WORKSPACE_ENV_PRODUCTION_FILE="$WORKSPACE/.env.production" \
    -D WORKSPACE_ENV_TEST_FILE="$WORKSPACE/.env.test" \
    -D WORKSPACE_ENVRC_FILE="$WORKSPACE/.envrc" \
    -D WORKSPACE_CREDENTIALS_FILE="$WORKSPACE/credentials.json" \
    -D WORKSPACE_SECRETS_FILE="$WORKSPACE/secrets.json" \
    -D WORKSPACE_SERVICE_ACCOUNT_FILE="$WORKSPACE/service-account.json" \
    -D WORKSPACE_NPMRC_FILE="$WORKSPACE/.npmrc" \
    -D NPM_ROOT="$NPM_ROOT" \
    -D NODE="$NODE" \
    -D PI_CLI="$PI_CLI" \
    -D HOME_SSH="$HOME/.ssh" \
    -D HOME_DOCUMENTS="$HOME/Documents" \
    -D HOME_DESKTOP="$HOME/Desktop" \
    -D HOME_DOWNLOADS="$HOME/Downloads" \
    -D HOME_AWS="$HOME/.aws" \
    -D HOME_GCLOUD="$HOME/.config/gcloud" \
    -D HOME_GO="$HOME/go" \
    -D HOME_GO_CACHE="$HOME/Library/Caches/go-build" \
    "$NODE" "$PI_CLI" "${PI_ARGS[@]}"
}

safe_environment_args() {
  SAFE_ENV_ARGS=(
    "HOME=$HOME"
    "PATH=$PATH"
    "TERM=${TERM:-}"
    "TMPDIR=${TMPDIR:-/tmp}"
    "PI_CODING_AGENT_DIR=$PI_AGENT_DIR"
    "PI_SANDBOXED=1"
    "npm_config_cache=${TMPDIR:-/tmp}/pipu-npm-cache"
  )
  [ -n "${LANG:-}" ] && SAFE_ENV_ARGS+=("LANG=$LANG")
  for name in LC_ALL LC_CTYPE LC_MESSAGES LC_MONETARY LC_NUMERIC LC_TIME; do
    value=$(printenv "$name" 2>/dev/null || true)
    [ -n "$value" ] && SAFE_ENV_ARGS+=("$name=$value")
  done
}

run_linux() {
  command -v bwrap >/dev/null 2>&1 || {
    echo "bwrap not installed; install bubblewrap to launch Linux sandbox" >&2
    exit 69
  }
  command -v tar >/dev/null 2>&1 || {
    echo "tar not installed; cannot create sanitized Pi runtime" >&2
    exit 69
  }
  NODE=$(command -v node) || {
    echo "node not found" >&2
    exit 69
  }
  PI=$(command -v pi) || {
    echo "pi not found" >&2
    exit 69
  }
  NPM_ROOT=$(npm prefix -g 2>/dev/null)/lib/node_modules

  # Never bind the host Pi directory: it contains auth.json and private history.
  SANITIZED_AGENT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pipu-agent.XXXXXX")
  SANITIZED_WORKSPACE=$(mktemp -d "${TMPDIR:-/tmp}/pipu-workspace.XXXXXX")
  SANITIZED_HOME="$SANITIZED_AGENT_DIR/home"
  mkdir -p "$SANITIZED_HOME"
  cleanup_linux() { rm -rf "$SANITIZED_AGENT_DIR" "$SANITIZED_WORKSPACE"; }
  trap cleanup_linux EXIT HUP INT TERM
  tar -C "$PI_AGENT_DIR" \
    --exclude=./auth.json --exclude=./sessions --exclude=./missions \
    -cf - . | tar -C "$SANITIZED_AGENT_DIR" -xf -
  # Stage workspace without common credential files. This is Linux equivalent
  # of profile deny rules because bubblewrap cannot subtract paths from a bind.
  tar -C "$WORKSPACE" \
    --exclude=./auth.json --exclude=./.env --exclude=./.env.* \
    --exclude=./.envrc --exclude=./credentials.json --exclude=./secrets.json \
    --exclude=./service-account.json --exclude=./.npmrc \
    -cf - . | tar -C "$SANITIZED_WORKSPACE" -xf -

  cd "$WORKSPACE"
  safe_environment_args
  # Network remains enabled for provider access; credentials are not inherited.
  set +e
  env -i "${SAFE_ENV_ARGS[@]}" \
    bwrap --die-with-parent --new-session --unshare-pid \
    --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
    --ro-bind /bin /bin --ro-bind /sbin /sbin \
    --bind "$SANITIZED_AGENT_DIR" /pi-runtime \
    --ro-bind "$NPM_ROOT" "$NPM_ROOT" \
    --ro-bind "$NODE" "$NODE" --ro-bind "$PI" "$PI" \
    --bind "$SANITIZED_WORKSPACE" "$WORKSPACE" \
    --tmpfs /tmp --proc /proc --dev /dev --share-net \
    --setenv PI_CODING_AGENT_DIR /pi-runtime \
    --setenv PI_SANDBOXED 1 \
    --setenv HOME /pi-runtime/home --chdir "$WORKSPACE" \
    "$PI" "${PI_ARGS[@]}"
  pi_status=$?
  set -e
  # Preserve sandbox writes while never copying credential-shaped files back.
  tar -C "$SANITIZED_WORKSPACE" \
    --exclude=./auth.json --exclude=./.env --exclude=./.env.* \
    --exclude=./.envrc --exclude=./credentials.json --exclude=./secrets.json \
    --exclude=./service-account.json --exclude=./.npmrc \
    -cf - . | tar -C "$WORKSPACE" -xf -
  sync_status=$?
  if [ "$pi_status" -ne 0 ]; then return "$pi_status"; fi
  return "$sync_status"
}

case "$(uname -s)" in
Darwin) run_macos ;;
Linux) run_linux ;;
*)
  echo "Unsupported OS: $(uname -s)" >&2
  exit 69
  ;;
esac
