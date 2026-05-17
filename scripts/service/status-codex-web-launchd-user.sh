#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ganxing.codex-web"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LAUNCHD_TARGET="gui/${UID}/${LABEL}"

if [[ ! -f "${PLIST_PATH}" ]]; then
  echo "missing plist: ${PLIST_PATH}" >&2
  exit 1
fi

echo "plist: ${PLIST_PATH}"
echo "label: ${LAUNCHD_TARGET}"
launchctl print "${LAUNCHD_TARGET}"
