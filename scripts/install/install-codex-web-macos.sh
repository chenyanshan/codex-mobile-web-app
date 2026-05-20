#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${HOME}/.config/codex-web/service.env"
MANUAL_LOG_DIR="${HOME}/.codex-web/logs"
MANUAL_STDOUT_LOG="${MANUAL_LOG_DIR}/codex-web-manual.stdout.log"
MANUAL_STDERR_LOG="${MANUAL_LOG_DIR}/codex-web-manual.stderr.log"

PASSWORD="${CODEX_WEB_INSTALL_PASSWORD:-}"
AUTOSTART="ask"

usage() {
  cat <<'EOF'
Usage:
  scripts/install/install-codex-web-macos.sh --password <password> --autostart <yes|no>

Options:
  --password <password>  Password to store for Codex Web login.
  --autostart <value>    yes or no. yes installs launchd startup.
  --help                 Show this help.

Environment:
  CODEX_WEB_INSTALL_PASSWORD  Optional password alternative to --password.
EOF
}

normalize_autostart() {
  local value="${1:-}"
  case "${value}" in
    yes|y|true|1)
      printf 'yes'
      ;;
    no|n|false|0)
      printf 'no'
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_password() {
  local first second
  while true; do
    read -r -s -p "Codex Web password: " first
    printf '\n'
    read -r -s -p "Confirm password: " second
    printf '\n'
    if [[ -z "${first}" ]]; then
      echo "password cannot be empty" >&2
      continue
    fi
    if [[ "${first}" != "${second}" ]]; then
      echo "passwords did not match" >&2
      continue
    fi
    PASSWORD="${first}"
    break
  done
}

prompt_autostart() {
  local answer
  while true; do
    read -r -p "Install as a macOS startup service? [y/n]: " answer
    if AUTOSTART="$(normalize_autostart "${answer}")"; then
      break
    fi
    echo "please answer yes or no" >&2
  done
}

detect_port() {
  if [[ -f "${ENV_FILE}" ]]; then
    local matched
    matched="$(awk -F= '/^CODEX_WEB_PORT=/{gsub(/"/, "", $2); print $2; exit}' "${ENV_FILE}")"
    if [[ -n "${matched}" ]]; then
      printf '%s' "${matched}"
      return
    fi
  fi
  printf '43210'
}

detect_lan_ip() {
  local candidate
  for device in en0 en1; do
    candidate="$(ipconfig getifaddr "${device}" 2>/dev/null || true)"
    if [[ -n "${candidate}" ]]; then
      printf '%s' "${candidate}"
      return
    fi
  done
}

wait_for_http() {
  local url="${1}"
  local attempts=20
  local index
  for ((index=1; index<=attempts; index+=1)); do
    if curl -fsS --max-time 2 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --password)
      [[ $# -ge 2 ]] || { echo "missing value for --password" >&2; exit 1; }
      PASSWORD="$2"
      shift 2
      ;;
    --autostart)
      [[ $# -ge 2 ]] || { echo "missing value for --autostart" >&2; exit 1; }
      AUTOSTART="$(normalize_autostart "$2")" || {
        echo "invalid value for --autostart: $2" >&2
        exit 1
      }
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only supports macOS." >&2
  exit 1
fi

command -v npm >/dev/null 2>&1 || {
  echo "npm is required but was not found in PATH." >&2
  exit 1
}

command -v codex >/dev/null 2>&1 || {
  echo "codex CLI is required but was not found in PATH." >&2
  exit 1
}

if [[ -z "${PASSWORD}" ]]; then
  prompt_password
fi

if [[ "${AUTOSTART}" == "ask" ]]; then
  prompt_autostart
fi

cd "${REPO_ROOT}"

echo "installing npm dependencies"
npm install

echo "saving Codex Web password hash"
CODEX_WEB_PASSWORD="${PASSWORD}" npm run codex-web -- auth set-password

mkdir -p "${MANUAL_LOG_DIR}"
touch "${MANUAL_STDOUT_LOG}" "${MANUAL_STDERR_LOG}"

if [[ "${AUTOSTART}" == "yes" ]]; then
  echo "installing launchd service"
  "${REPO_ROOT}/scripts/service/install-codex-web-launchd-user.sh"
else
  echo "starting Codex Web without launchd autostart"
  nohup npm run serve --workspace packages/codex-web >"${MANUAL_STDOUT_LOG}" 2>"${MANUAL_STDERR_LOG}" &
fi

PORT="$(detect_port)"
LOCAL_URL="http://127.0.0.1:${PORT}/"
if ! wait_for_http "${LOCAL_URL}"; then
  echo "Codex Web did not become reachable at ${LOCAL_URL}" >&2
  exit 1
fi

echo "Codex Web is running."
echo "local_url: ${LOCAL_URL}"

LAN_IP="$(detect_lan_ip || true)"
if [[ -n "${LAN_IP}" ]]; then
  echo "lan_url: http://${LAN_IP}:${PORT}/"
fi

echo "PWA instructions: docs/pwa-setup.md"
