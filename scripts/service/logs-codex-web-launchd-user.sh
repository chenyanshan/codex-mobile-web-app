#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ganxing.codex-web"
LOG_DIR="${HOME}/.codex-web/logs"
STDOUT_LOG="${LOG_DIR}/codex-web.stdout.log"
STDERR_LOG="${LOG_DIR}/codex-web.stderr.log"
LAUNCHD_TARGET="gui/${UID}/${LABEL}"

mkdir -p "${LOG_DIR}"
touch "${STDOUT_LOG}" "${STDERR_LOG}"

if launchctl print "${LAUNCHD_TARGET}" >/dev/null 2>&1; then
  echo "service loaded: ${LAUNCHD_TARGET}"
else
  echo "service not currently loaded: ${LAUNCHD_TARGET}" >&2
fi

echo "stdout: ${STDOUT_LOG}"
echo "stderr: ${STDERR_LOG}"
exec tail -n 80 -F "${STDOUT_LOG}" "${STDERR_LOG}"
