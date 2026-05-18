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

test('launchd install does not unload a running Codex Web service', async () => {
  const script = await readScript('scripts/service/install-codex-web-launchd-user.sh');

  assert.doesNotMatch(script, /launchctl bootout/u);
  assert.match(script, /if launchctl print "\$\{LAUNCHD_TARGET\}"/u);
  assert.match(script, /launchctl bootstrap "\$\{LAUNCHD_DOMAIN\}" "\$\{PLIST_PATH\}"/u);
  assert.match(script, /launchctl kickstart -k "\$\{LAUNCHD_TARGET\}"/u);
});
