import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  effectiveProjectGrant,
  canCreateProjectSession,
  canReadAppSession,
  canWriteAppSession,
} from '../src/access_control.js';
import { FileIdentityStore } from '../src/identity_store.js';

async function tempIdentityPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-identity-'));
  return path.join(dir, 'identity.json');
}

test('identity store hashes user passwords and verifies credentials', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'secret-password',
    roleIds: [],
    directProjectGrants: [],
  });

  const state = await store.readState();
  const [user] = state.users;
  assert.equal(user?.username, 'alice');
  assert.notEqual(user?.passwordHash, 'secret-password');
  assert.equal(typeof user?.passwordSalt, 'string');
  assert.equal(await store.verifyUserPassword('alice', 'secret-password'), 'user_alice');
  assert.equal(await store.verifyUserPassword('alice', 'wrong-password'), null);
});

test('access control merges role grants and direct user grants', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      roleIds: ['role_reader'],
      directProjectGrants: [{ projectId: 'project_two', canRead: true, canCreate: true, canWrite: false }],
    }],
    roles: [{
      id: 'role_reader',
      name: 'Reader',
      isAdmin: false,
      projectGrants: [{ projectId: 'project_one', canRead: true, canCreate: false, canWrite: false }],
    }],
    projects: [],
    sessions: [],
    shares: [],
  };
  const principal = {
    userId: 'user_alice',
    username: 'alice',
    roleIds: ['role_reader'],
    isAdmin: false,
    mode: 'multi' as const,
  };

  assert.deepEqual(effectiveProjectGrant(state, principal, 'project_one'), {
    projectId: 'project_one',
    canRead: true,
    canCreate: false,
    canWrite: false,
  });
  assert.deepEqual(effectiveProjectGrant(state, principal, 'project_two'), {
    projectId: 'project_two',
    canRead: true,
    canCreate: true,
    canWrite: false,
  });
  assert.equal(canCreateProjectSession(state, principal, 'project_two'), true);
  assert.equal(canCreateProjectSession(state, principal, 'project_one'), false);
});

test('access control restricts ordinary users to owned sessions', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      roleIds: [],
      directProjectGrants: [{ projectId: 'project_one', canRead: true, canCreate: true, canWrite: true }],
    }],
    roles: [],
    projects: [],
    sessions: [
      { id: 'app_own', codexThreadId: 'thread_own', projectId: 'project_one', ownerUserId: 'user_alice', createdAt: '', updatedAt: '' },
      { id: 'app_other', codexThreadId: 'thread_other', projectId: 'project_one', ownerUserId: 'user_bob', createdAt: '', updatedAt: '' },
    ],
    shares: [],
  };
  const principal = {
    userId: 'user_alice',
    username: 'alice',
    roleIds: [],
    isAdmin: false,
    mode: 'multi' as const,
  };

  assert.equal(canReadAppSession(state, principal, state.sessions[0]!), true);
  assert.equal(canWriteAppSession(state, principal, state.sessions[0]!), true);
  assert.equal(canReadAppSession(state, principal, state.sessions[1]!), false);
  assert.equal(canWriteAppSession(state, principal, state.sessions[1]!), false);
});

test('identity store stores only hashed share tokens', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const created = await store.createShare({ sessionId: 'app_session_1', createdByUserId: 'user_admin' });
  const state = await store.readState();
  const [share] = state.shares;

  assert.match(created.token, /^cws_/u);
  assert.equal(share?.tokenHash.includes(created.token), false);
  assert.equal(await store.findShareByToken(created.token), share?.id);
  assert.equal(await store.findShareByToken('wrong-token'), null);
});

