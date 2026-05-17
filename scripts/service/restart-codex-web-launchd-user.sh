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

launchctl bootout "${LAUNCHD_DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "${LAUNCHD_DOMAIN}" "${PLIST_PATH}"
launchctl enable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
launchctl kickstart -k "${LAUNCHD_TARGET}"

echo "restarted: ${LAUNCHD_TARGET}"
