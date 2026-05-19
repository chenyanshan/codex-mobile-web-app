import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileSessionSettingsStore } from '../src/session_settings_store.js';

test('file session settings store persists session favorite flag', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-session-settings-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const settingsPath = path.join(dir, 'session-settings.json');
  const store = new FileSessionSettingsStore({ settingsPath });

  store.set('thread_favorite', {
    bridgeSessionId: 'thread_favorite',
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    locale: null,
    metadata: {},
    updatedAt: 1,
    favorite: true,
    favoriteOrder: 4,
  } as any);

  const reloaded = new FileSessionSettingsStore({ settingsPath });
  assert.equal((reloaded.get('thread_favorite') as any)?.favorite, true);
  assert.equal((reloaded.get('thread_favorite') as any)?.favoriteOrder, 4);
});
