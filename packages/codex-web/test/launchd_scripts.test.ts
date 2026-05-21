import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function readScript(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('launchd restart keeps the job loaded so KeepAlive can recover it', async () => {
  const script = await readScript('scripts/service/restart-codex-web-launchd-user.sh');

  assert.doesNotMatch(script, /launchctl bootout/u);
  assert.match(script, /launchctl print "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_TARGET\}"/u);
});

test('launchd detached restart schedules a one-shot helper before killing the service', async () => {
  const script = await readScript('scripts/service/restart-codex-web-launchd-user-detached.sh');

  assert.match(script, /HELPER_LABEL="com\.ganxing\.codex-web\.restart"/u);
  assert.match(script, /StartInterval/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{HELPER_PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_DOMAIN\}\/\$\{HELPER_LABEL\}"/u);
  assert.match(script, /launchctl kickstart -k %s/u);
  assert.match(script, /shell_escape "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /echo "scheduled detached restart:/u);
  assert.doesNotMatch(script, /RESTART_SCRIPT/u);
  assert.doesNotMatch(script, /scripts\/service\/restart-codex-web-launchd-user\.sh/u);
});

test('launchd install does not unload a running Codex Web service', async () => {
  const script = await readScript('scripts/service/install-codex-web-launchd-user.sh');

  assert.doesNotMatch(script, /launchctl bootout/u);
  assert.match(script, /if launchctl print "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_TARGET\}"/u);
});

test('macOS installer script installs dependencies, configures password, and optionally installs launchd', async () => {
  const script = await readScript('scripts/install/install-codex-web-macos.sh');

  assert.match(script, /uname -s/u);
  assert.match(script, /npm install/u);
  assert.match(script, /CODEX_WEB_PASSWORD="\$\{PASSWORD\}" npm run codex-web -- auth set-password/u);
  assert.match(script, /install-codex-web-launchd-user\.sh/u);
  assert.match(script, /--autostart/u);
});
