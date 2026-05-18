#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ganxing.codex-web"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LAUNCHD_DOMAIN="gui/${UID}"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LABEL}"

if [[ ! -f "${PLIST_PATH}" ]]; then
  echo "missing plist: ${PLIST_PATH}" >&2
  exit 1
fi

# Keep the LaunchAgent loaded. If this script is invoked from a Codex turn
# inside Codex Web, bootout removes the job and kills the caller before any
# bootstrap can run, leaving KeepAlive with nothing to supervise.
launchctl enable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
if ! launchctl print "${LAUNCHD_TARGET}" >/dev/null 2>&1; then
  launchctl bootstrap "${LAUNCHD_DOMAIN}" "${PLIST_PATH}"
fi
launchctl kickstart -k "${LAUNCHD_TARGET}"

echo "restarted: ${LAUNCHD_TARGET}"
