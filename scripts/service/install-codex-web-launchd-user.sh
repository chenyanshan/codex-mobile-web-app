#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ganxing.codex-web"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_DIR="${HOME}/.config/codex-web"
ENV_FILE="${CONFIG_DIR}/service.env"
STATE_DIR="${HOME}/.codex-web"
LOG_DIR="${STATE_DIR}/logs"
STDOUT_LOG="${LOG_DIR}/codex-web.stdout.log"
STDERR_LOG="${LOG_DIR}/codex-web.stderr.log"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"

shell_escape() {
  printf '%q' "$1"
}

env_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "${value}"
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "${value}"
}

write_default_env_file_if_missing() {
  if [[ -f "${ENV_FILE}" ]]; then
    return
  fi

  mkdir -p "${CONFIG_DIR}"
  umask 077
  cat > "${ENV_FILE}" <<EOF
# Codex Web launchd service configuration.
# Do not store CODEX_WEB_PASSWORD in this file.
CODEX_WEB_HOST=$(env_escape "0.0.0.0")
CODEX_WEB_PORT=$(env_escape "43210")
CODEX_WEB_DEFAULT_CWD=$(env_escape "${REPO_ROOT}")
CODEX_REAL_BIN=$(env_escape "codex")
CODEX_WEB_DEBUG=$(env_escape "0")
EOF
  chmod 600 "${ENV_FILE}"
}

write_plist() {
  local command
  command=$(
    printf 'set -euo pipefail; mkdir -p %s; set -a; source %s; set +a; cd %s; exec npm run serve --workspace packages/codex-web' \
      "$(shell_escape "${LOG_DIR}")" \
      "$(shell_escape "${ENV_FILE}")" \
      "$(shell_escape "${REPO_ROOT}")"
  )

  mkdir -p "${PLIST_DIR}"
  cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$(xml_escape "${LABEL}")</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>$(xml_escape "${command}")</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$(xml_escape "${REPO_ROOT}")</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$(xml_escape "${STDOUT_LOG}")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "${STDERR_LOG}")</string>
  </dict>
</plist>
EOF
}

mkdir -p "${LOG_DIR}"
touch "${STDOUT_LOG}" "${STDERR_LOG}"
chmod 700 "${STATE_DIR}" "${LOG_DIR}" 2>/dev/null || true

write_default_env_file_if_missing
write_plist

launchctl bootout "${LAUNCHD_DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "${LAUNCHD_DOMAIN}" "${PLIST_PATH}"
launchctl enable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
launchctl kickstart -k "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true

echo "installed launch agent: ${PLIST_PATH}"
echo "config file: ${ENV_FILE}"
echo "logs: ${LOG_DIR}"
echo "status label: ${LAUNCHD_TARGET}"
