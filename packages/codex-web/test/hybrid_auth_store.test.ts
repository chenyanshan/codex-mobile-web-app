import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthStore } from '../src/auth_store.js';
import { HybridAuthStore } from '../src/hybrid_auth_store.js';
import { FileIdentityStore } from '../src/identity_store.js';

async function tempPaths(): Promise<{ authPath: string; identityPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-hybrid-auth-'));
  return {
    authPath: path.join(dir, 'auth.json'),
    identityPath: path.join(dir, 'identity.json'),
  };
}

test('hybrid auth keeps legacy single-user password login as local admin', async () => {
  const { authPath, identityPath } = await tempPaths();
  const legacyAuth = new AuthStore({ authPath });
  await legacyAuth.setPassword('single-password');
  const auth = new HybridAuthStore({
    legacyAuth,
    identityStore: new FileIdentityStore({ identityPath }),
  });

  const login = await auth.login({ password: 'single-password', deviceName: 'phone' });
  const verified = await auth.verifyToken(login.token);

  assert.equal(verified?.principal?.userId, 'local-admin');
  assert.equal(verified?.principal?.isAdmin, true);
  assert.equal(verified?.principal?.mode, 'single');
});

test('hybrid auth verifies multi-user username password and returns user principal', async () => {
  const { authPath, identityPath } = await tempPaths();
  const identityStore = new FileIdentityStore({ identityPath });
  await identityStore.setMultiUserEnabled(true);
  await identityStore.upsertRole({
    id: 'role_project',
    name: 'Project',
    isAdmin: false,
    projectGrants: [],
  });
  await identityStore.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'alice-password',
    roleIds: ['role_project'],
    directProjectGrants: [],
  });
  const auth = new HybridAuthStore({
    legacyAuth: new AuthStore({ authPath }),
    identityStore,
  });

  const login = await auth.login({ username: 'alice', password: 'alice-password', deviceName: 'phone' });
  const verified = await auth.verifyToken(login.token);

  assert.equal(verified?.principal?.userId, 'user_alice');
  assert.equal(verified?.principal?.username, 'alice');
  assert.deepEqual(verified?.principal?.roleIds, ['role_project']);
  assert.equal(verified?.principal?.isAdmin, false);
  assert.equal(verified?.principal?.mode, 'multi');
});

test('hybrid auth persists multi-user tokens across store instances', async () => {
  const { authPath, identityPath } = await tempPaths();
  const identityStore = new FileIdentityStore({ identityPath });
  await identityStore.setMultiUserEnabled(true);
  await identityStore.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'alice-password',
  });
  const first = new HybridAuthStore({
    legacyAuth: new AuthStore({ authPath }),
    identityStore,
  });

  const login = await first.login({ username: 'alice', password: 'alice-password', deviceName: 'phone' });
  const second = new HybridAuthStore({
    legacyAuth: new AuthStore({ authPath }),
    identityStore,
  });

  const verified = await second.verifyToken(login.token);
  assert.equal(verified?.principal?.userId, 'user_alice');
});


test('hybrid auth rejects disabled multi-user accounts', async () => {
  const { authPath, identityPath } = await tempPaths();
  const identityStore = new FileIdentityStore({ identityPath });
  await identityStore.setMultiUserEnabled(true);
  await identityStore.upsertUserWithPassword({
    id: 'user_disabled',
    username: 'disabled',
    password: 'disabled-password',
    enabled: false,
  });
  const auth = new HybridAuthStore({
    legacyAuth: new AuthStore({ authPath }),
    identityStore,
  });

  await assert.rejects(
    auth.login({ username: 'disabled', password: 'disabled-password', deviceName: 'phone' }),
    /Invalid username or password/u,
  );
});
