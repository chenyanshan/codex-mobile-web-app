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

test('identity store persists a normalized global site title', async () => {
  const identityPath = await tempIdentityPath();
  const store = new FileIdentityStore({ identityPath });

  assert.equal((await store.readState()).settings.siteTitle, 'Codex Web');

  const updated = await store.setSiteTitle('  Yan Shan Lab  ');

  assert.deepEqual(updated.settings, {
    multiUserEnabled: false,
    siteTitle: 'Yan Shan Lab',
  });
  assert.equal((await store.readState()).settings.siteTitle, 'Yan Shan Lab');
});

test('identity store updates user access without changing password hash', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'secret-password',
    canNewSession: true,
    roleIds: ['role_reader'],
  });
  const before = await store.readState();
  const originalHash = before.users[0]?.passwordHash;

  const updated = await store.updateUserAccess({
    id: 'user_alice',
    enabled: true,
    canNewSession: false,
    roleIds: ['role_viewer'],
  });

  assert.equal(updated.passwordHash, originalHash);
  assert.deepEqual(updated.roleIds, ['role_viewer']);
  assert.equal(updated.canNewSession, false);
  assert.equal(await store.verifyUserPassword('alice', 'secret-password'), 'user_alice');
});

test('identity store preserves existing direct project grants when user access update omits them', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'secret-password',
    roleIds: ['role_reader'],
    directProjectGrants: [{ projectId: 'project_one', canRead: true, canCreate: true, canWrite: true }],
  });

  const updated = await store.updateUserAccess({
    id: 'user_alice',
    enabled: false,
    roleIds: ['role_viewer'],
  });

  assert.equal(updated.enabled, false);
  assert.deepEqual(updated.roleIds, ['role_viewer']);
  assert.deepEqual(updated.directProjectGrants, [
    { projectId: 'project_one', canRead: true, canCreate: true, canWrite: true },
  ]);
});

test('identity store derives blank project display names from the cwd leaf', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const project = await store.upsertProject({
    id: 'project_mobile_web',
    internalName: 'legacy-internal-name',
    cwd: '/Users/alice/codex-mobile-web-app',
    displayName: '',
    enabled: true,
  });

  assert.equal(project.displayName, 'codex-mobile-web-app');
  assert.equal((await store.readState()).projects[0]?.displayName, 'codex-mobile-web-app');
});

test('identity store collapses path-like project display names to the final segment', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });

  const project = await store.upsertProject({
    id: 'project_mobile_web',
    internalName: 'vibecoding/codex-mobile-web-app',
    cwd: '/Users/alice/codex-mobile-web-app',
    displayName: 'vibecoding/codex-mobile-web-app',
    enabled: true,
  });

  assert.equal(project.displayName, 'codex-mobile-web-app');
});

test('identity store deletes a user and cleans related sessions, shares, and auth sessions', async () => {
  const store = new FileIdentityStore({ identityPath: await tempIdentityPath() });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'secret-password',
    roleIds: [],
    directProjectGrants: [],
  });
  await store.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_one',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  await store.createShare({
    sessionId: 'app_alice',
    createdByUserId: 'user_alice',
  });
  await store.addUserSession({
    id: 'auth_alice',
    tokenHash: 'hashed-token',
    deviceName: 'Alice Phone',
    createdAt: '2026-05-27T00:00:00.000Z',
    lastSeenAt: '2026-05-27T00:00:00.000Z',
    userId: 'user_alice',
  });

  await store.deleteUser('user_alice');

  const state = await store.readState();
  assert.equal(state.users.some((user) => user.id === 'user_alice'), false);
  assert.equal(state.sessions.some((session) => session.ownerUserId === 'user_alice'), false);
  assert.equal(state.shares.some((share) => share.createdByUserId === 'user_alice' || share.sessionId === 'app_alice'), false);
  assert.equal(state.userSessions.some((session) => session.userId === 'user_alice'), false);
});

test('access control merges role grants and direct user grants', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      canNewSession: true,
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
    canCreate: true,
    canWrite: true,
  });
  assert.deepEqual(effectiveProjectGrant(state, principal, 'project_two'), {
    projectId: 'project_two',
    canRead: true,
    canCreate: true,
    canWrite: true,
  });
  assert.equal(canCreateProjectSession(state, principal, 'project_two'), true);
  assert.equal(canCreateProjectSession(state, principal, 'project_one'), true);
});

test('project assignment still allows creation even when legacy canNewSession is false', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      canNewSession: false,
      roleIds: ['role_reader'],
      directProjectGrants: [],
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
    userSessions: [],
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
    canCreate: true,
    canWrite: true,
  });
  assert.equal(canCreateProjectSession(state, principal, 'project_one'), true);
});

test('access control restricts ordinary users to owned sessions', async () => {
  const state = {
    settings: { multiUserEnabled: true },
    users: [{
      id: 'user_alice',
      username: 'alice',
      enabled: true,
      canNewSession: true,
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
