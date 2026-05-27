import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexWebServer } from '../src/server.js';
import { FileIdentityStore } from '../src/identity_store.js';
import type { CodexWebPrincipal } from '../src/access_control.js';

interface TestConfig {
  host: string;
  port: number;
  defaultCwd: string;
  codexBin: string;
  stateDir: string;
  authPath: string;
  reportsDir: string;
  reportIndexPath: string;
  envPath: string;
  debug: boolean;
}

function createConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  const stateDir = overrides.stateDir ?? '/tmp';
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd: '/tmp',
    codexBin: 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'report-index.json'),
    envPath: '/tmp/service.env',
    debug: false,
    ...overrides,
  };
}

function authFor(principals: Record<string, CodexWebPrincipal>) {
  return {
    isConfigured: async () => true,
    login: async () => {
      throw new Error('unused');
    },
    verifyToken: async (token: string | null | undefined) => {
      const principal = token ? principals[token] : null;
      return principal
        ? { id: `session_${principal.userId}`, deviceName: 'test', createdAt: '', lastSeenAt: '', principal }
        : null;
    },
    logout: async () => {},
  };
}

function runtimeStub() {
  const calls: string[] = [];
  const runtime = {
    calls,
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [],
    createSession: async ({ cwd }: { cwd?: string | null }) => {
      calls.push(`create:${cwd}`);
      return { id: 'thread_new', cwd: cwd ?? null, projectName: 'hidden', settings: {}, thread: { turns: [] } };
    },
    readSession: async (threadId: string) => {
      calls.push(`read:${threadId}`);
      return { id: threadId, cwd: '/secret/path', projectName: 'secret/path', settings: {}, thread: { turns: [] }, timeline: [] };
    },
    archiveSession: async (threadId: string) => {
      calls.push(`archive:${threadId}`);
      return true;
    },
    updateSessionFavorite: async (threadId: string) => {
      calls.push(`favorite:${threadId}`);
      return { id: threadId, cwd: '/secret/path', settings: {}, thread: { turns: [] } };
    },
    updateSessionSettings: async (threadId: string) => {
      calls.push(`settings:${threadId}`);
      return { id: threadId, cwd: '/secret/path', settings: {}, thread: { turns: [] } };
    },
    reloadRuntime: async () => ({ mcpServersReloaded: true }),
    startTurn: async (threadId: string) => {
      calls.push(`turn:${threadId}`);
      return { turnId: 'turn_1' };
    },
    interruptTurnForThread: async (threadId: string, turnId: string) => {
      calls.push(`interrupt:${threadId}:${turnId}`);
    },
    resolveApprovalForThread: async (threadId: string, approvalId: string) => {
      calls.push(`approval:${threadId}:${approvalId}`);
    },
    interruptTurn: async (turnId: string) => {
      calls.push(`legacy-interrupt:${turnId}`);
    },
    resolveApproval: async (approvalId: string) => {
      calls.push(`legacy-approval:${approvalId}`);
    },
    threadIdForTurn: () => 'thread_alice',
    threadIdForApproval: () => 'thread_alice',
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
  return runtime;
}

async function createIdentityStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-'));
  const store = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  await store.setMultiUserEnabled(true);
  await store.upsertProject({
    id: 'project_allowed',
    internalName: 'secret-repo',
    cwd: '/Users/alice/secret-repo',
    displayName: 'Allowed Project',
    enabled: true,
  });
  await store.upsertProject({
    id: 'project_denied',
    internalName: 'other-repo',
    cwd: '/Users/bob/other-repo',
    displayName: 'Other Project',
    enabled: true,
  });
  await store.upsertRole({
    id: 'role_admin',
    name: 'Admin',
    isAdmin: true,
    projectGrants: [],
  });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'alice-password',
    directProjectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
  });
  await store.upsertUserWithPassword({
    id: 'user_admin',
    username: 'admin',
    password: 'admin-password',
    roleIds: ['role_admin'],
  });
  await store.upsertSession({
    id: 'app_alice',
    codexThreadId: 'thread_alice',
    projectId: 'project_allowed',
    ownerUserId: 'user_alice',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  await store.upsertSession({
    id: 'app_bob',
    codexThreadId: 'thread_bob',
    projectId: 'project_allowed',
    ownerUserId: 'user_bob',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });
  return store;
}

test('multi-user session list returns only owned authorized sessions with display names', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_alice']);
    assert.equal(payload.items[0].projectDisplayName, 'Allowed Project');
    assert.equal(payload.items[0].cwd, undefined);
    assert.deepEqual(runtime.calls, ['read:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('multi-user read and write reject sessions owned by another user', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const read = await fetch(`${server.baseUrl}/api/sessions/app_bob`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(read.status, 404);

    const write = await fetch(`${server.baseUrl}/api/sessions/app_bob/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(write.status, 404);
    assert.deepEqual(runtime.calls, []);
  } finally {
    await server.stop();
  }
});

test('multi-user session create uses project cwd and stores app session mapping', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed', cwd: '/tmp/ignored' }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.notEqual(payload.session.id, 'thread_new');
    assert.equal(payload.session.projectDisplayName, 'Allowed Project');
    assert.equal(payload.session.cwd, undefined);
    assert.deepEqual(runtime.calls, ['create:/Users/alice/secret-repo']);
    const state = await identityStore.readState();
    assert.equal(state.sessions.some((session) => session.codexThreadId === 'thread_new'), true);
  } finally {
    await server.stop();
  }
});

test('admin can audit all sessions and read any session with observer mode', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const list = await fetch(`${server.baseUrl}/api/admin/sessions?userId=user_bob`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(list.status, 200);
    const listPayload = await list.json();
    assert.deepEqual(listPayload.items.map((item: any) => item.id), ['app_bob']);

    const read = await fetch(`${server.baseUrl}/api/admin/sessions/app_bob`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(read.status, 200);
    const readPayload = await read.json();
    assert.equal(readPayload.mode, 'observer');
    assert.equal(readPayload.session.id, 'app_bob');
    assert.equal(readPayload.session.cwd, '/secret/path');
    assert.deepEqual(runtime.calls, ['read:thread_bob']);
  } finally {
    await server.stop();
  }
});

test('share links read sessions without bearer auth and stay read-only', async () => {
  const identityStore = await createIdentityStore();
  const { token } = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({}),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const read = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/session`);
    assert.equal(read.status, 200);
    const payload = await read.json();
    assert.equal(payload.mode, 'share');
    assert.equal(payload.session.id, 'app_alice');
    assert.equal(payload.session.cwd, undefined);

    const write = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'not allowed' }),
    });
    assert.equal(write.status, 404);
    assert.deepEqual(runtime.calls, ['read:thread_alice']);
  } finally {
    await server.stop();
  }
});

test('share event streams are limited to turns from the shared session', async () => {
  const identityStore = await createIdentityStore();
  const { token } = await identityStore.createShare({ sessionId: 'app_alice', createdByUserId: 'user_alice' });
  const runtime = {
    ...runtimeStub(),
    threadIdForTurn: (turnId: string) => turnId === 'turn_alice' ? 'thread_alice' : 'thread_bob',
    getTurnEvents: (turnId: string) => turnId === 'turn_alice'
      ? [{ sequence: 1, event: { type: 'turn.started', turnId: 'turn_alice', threadId: 'thread_alice' } }]
      : [],
  };
  const server = createCodexWebServer({
    auth: authFor({}),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const denied = await fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/turns/turn_bob/events`);
    assert.equal(denied.status, 404);

    const controller = new AbortController();
    const allowedPromise = fetch(`${server.baseUrl}/api/share/${encodeURIComponent(token)}/turns/turn_alice/events`, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    const allowed = await allowedPromise;
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('content-type') ?? '', /^text\/event-stream\b/i);
    controller.abort();
  } finally {
    await server.stop();
  }
});

test('authorized owners can create read-only share links for their sessions', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_alice/share`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.match(payload.shareUrl, /^\/share\//u);
    assert.match(payload.token, /^cws_/u);
    const state = await identityStore.readState();
    assert.equal(state.shares.length, 1);
    assert.equal(state.shares[0]?.sessionId, 'app_alice');
    assert.equal(state.shares[0]?.tokenHash.includes(payload.token), false);
  } finally {
    await server.stop();
  }
});

test('admin settings and project management APIs require admin principal', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const forbidden = await fetch(`${server.baseUrl}/api/admin/settings`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(forbidden.status, 403);

    const settings = await fetch(`${server.baseUrl}/api/admin/settings`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(settings.status, 200);
    assert.equal((await settings.json()).settings.multiUserEnabled, true);

    const create = await fetch(`${server.baseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'project_new',
        internalName: 'new-secret',
        cwd: '/Users/admin/new-secret',
        displayName: 'New Project',
      }),
    });
    assert.equal(create.status, 201);
    const payload = await create.json();
    assert.deepEqual(payload.project, {
      id: 'project_new',
      internalName: 'new-secret',
      cwd: '/Users/admin/new-secret',
      displayName: 'New Project',
      enabled: true,
    });
  } finally {
    await server.stop();
  }
});

test('admin can create roles and users with project grants', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const role = await fetch(`${server.baseUrl}/api/admin/roles`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'role_writer',
        name: 'Writer',
        projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
      }),
    });
    assert.equal(role.status, 201);
    assert.equal((await role.json()).role.id, 'role_writer');

    const user = await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'user_writer',
        username: 'writer',
        password: 'writer-password',
        roleIds: ['role_writer'],
      }),
    });
    assert.equal(user.status, 201);
    const payload = await user.json();
    assert.equal(payload.user.id, 'user_writer');
    assert.equal(payload.user.passwordHash, undefined);

    const users = await fetch(`${server.baseUrl}/api/admin/users`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(users.status, 200);
    assert.equal((await users.json()).items.some((item: any) => item.username === 'writer'), true);
  } finally {
    await server.stop();
  }
});
