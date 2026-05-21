#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ganxing.codex-web"
HELPER_LABEL="com.ganxing.codex-web.restart"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
HELPER_PLIST_PATH="${HOME}/Library/LaunchAgents/${HELPER_LABEL}.plist"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"
LOG_DIR="${HOME}/.codex-web/logs"
HELPER_LOG="${LOG_DIR}/codex-web-restart-helper.log"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "${value}"
}

shell_escape() {
  printf '%q' "$1"
}

if [[ ! -f "${PLIST_PATH}" ]]; then
  echo "missing plist: ${PLIST_PATH}" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}" "$(dirname "${HELPER_PLIST_PATH}")"

HELPER_COMMAND=$(
  printf 'set -euo pipefail; sleep 3; { launchctl enable %s >/dev/null 2>&1 || true; if ! launchctl print %s >/dev/null 2>&1; then launchctl bootstrap %s %s; fi; launchctl kickstart -k %s; } >> %s 2>&1; launchctl bootout %s/%s >/dev/null 2>&1 || true; rm -f %s' \
    "$(shell_escape "${LAUNCHD_TARGET}")" \
    "$(shell_escape "${LAUNCHD_TARGET}")" \
    "$(shell_escape "${LAUNCHD_DOMAIN}")" \
    "$(shell_escape "${PLIST_PATH}")" \
    "$(shell_escape "${LAUNCHD_TARGET}")" \
    "$(shell_escape "${HELPER_LOG}")" \
    "$(shell_escape "${LAUNCHD_DOMAIN}")" \
    "$(shell_escape "${HELPER_LABEL}")" \
    "$(shell_escape "${HELPER_PLIST_PATH}")"
)

cat > "${HELPER_PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$(xml_escape "${HELPER_LABEL}")</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>$(xml_escape "${HELPER_COMMAND}")</string>
    </array>
    <key>StartInterval</key>
    <integer>86400</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$(xml_escape "${HELPER_LOG}")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "${HELPER_LOG}")</string>
  </dict>
</plist>
EOF

launchctl bootout "${LAUNCHD_DOMAIN}/${HELPER_LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "${LAUNCHD_DOMAIN}" "${HELPER_PLIST_PATH}"
launchctl kickstart -k "${LAUNCHD_DOMAIN}/${HELPER_LABEL}"

echo "scheduled detached restart: ${LAUNCHD_TARGET}"
echo "helper label: ${LAUNCHD_DOMAIN}/${HELPER_LABEL}"
echo "helper log: ${HELPER_LOG}"
