import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthStore } from '../src/auth_store.js';
import { HybridAuthStore } from '../src/hybrid_auth_store.js';
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
  await store.upsertRole({
    id: 'role_user',
    name: 'User',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: false, canWrite: false }],
  });
  await store.upsertUserWithPassword({
    id: 'user_alice',
    username: 'alice',
    password: 'alice-password',
    canNewSession: true,
    roleIds: ['role_user'],
    directProjectGrants: [],
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
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { favorite?: boolean }) => {
      runtime.calls.push(`list:${options?.favorite === true ? 'favorites' : 'all'}`);
      return [
        {
          id: 'thread_alice',
          cwd: '/secret/path',
          projectName: 'secret/path',
          settings: {},
          thread: { turns: [] },
          timeline: [],
        },
        {
          id: 'thread_bob',
          cwd: '/other/path',
          projectName: 'other/path',
          settings: {},
          thread: { turns: [] },
          timeline: [],
        },
      ];
    },
    readSession: async (threadId: string) => {
      runtime.calls.push(`read:${threadId}`);
      throw new Error(`session list should not hydrate ${threadId}`);
    },
  };
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
    assert.deepEqual(runtime.calls, ['list:all']);
  } finally {
    await server.stop();
  }
});

test('multi-user favorite session list uses the runtime favorite filter before hydrating sessions', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async (options?: { favorite?: boolean }) => {
      runtime.calls.push(`list:${options?.favorite === true ? 'favorites' : 'all'}`);
      return options?.favorite === true
        ? [{
          id: 'thread_alice',
          cwd: '/secret/path',
          projectName: 'secret/path',
          settings: {},
          thread: { turns: [] },
          timeline: [],
          favorite: true,
          favoriteOrder: 1,
        }]
        : [];
    },
    readSession: async (threadId: string) => {
      runtime.calls.push(`read:${threadId}`);
      if (threadId !== 'thread_alice') {
        throw new Error(`unexpected hydration for ${threadId}`);
      }
      return {
        id: threadId,
        cwd: '/secret/path',
        projectName: 'secret/path',
        settings: {},
        thread: { turns: [] },
        timeline: [],
        favorite: true,
        favoriteOrder: 1,
      };
    },
  };
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
    const response = await fetch(`${server.baseUrl}/api/sessions?favorite=true`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item: any) => item.id), ['app_alice']);
    assert.deepEqual(runtime.calls, ['list:favorites']);
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

test('admin projects list exposes every enabled project as creatable', async () => {
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
    const response = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        { id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, favorite: false },
        { id: 'project_denied', displayName: 'Other Project', canCreate: true, favorite: false },
      ],
    });
  } finally {
    await server.stop();
  }
});

test('admin projects list includes disabled legacy projects as creatable', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_legacy',
    internalName: 'legacy-repo',
    cwd: '/Users/admin/legacy-repo',
    displayName: 'Legacy Repo',
    enabled: false,
  });
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
    const projects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(projects.status, 200);
    const projectPayload = await projects.json();
    assert.equal(
      projectPayload.items.some((item: any) => item.id === 'project_legacy' && item.canCreate === true),
      true,
    );

    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_legacy' }),
    });
    assert.equal(create.status, 201);
    assert.deepEqual(runtime.calls, ['create:/Users/admin/legacy-repo']);
  } finally {
    await server.stop();
  }
});

test('multi-user role-assigned projects are creatable without a separate user toggle', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertUserWithPassword({
    id: 'user_viewer',
    username: 'viewer',
    password: 'viewer-password',
    canNewSession: false,
    roleIds: ['role_user'],
    directProjectGrants: [],
  });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      viewer: { userId: 'user_viewer', username: 'viewer', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const projects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer viewer' },
    });
    assert.equal(projects.status, 200);
    assert.deepEqual(await projects.json(), {
      items: [{ id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, favorite: false }],
    });

    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer viewer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed' }),
    });
    assert.equal(create.status, 201);
    assert.deepEqual(runtime.calls, ['create:/Users/alice/secret-repo']);
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

test('admin audit can filter sessions by project only', async () => {
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
    const allowed = await fetch(`${server.baseUrl}/api/admin/sessions?projectId=project_allowed`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(allowed.status, 200);
    const allowedPayload = await allowed.json();
    assert.deepEqual(allowedPayload.items.map((item: any) => item.id).sort(), ['app_alice', 'app_bob']);

    const denied = await fetch(`${server.baseUrl}/api/admin/sessions?projectId=project_denied`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(denied.status, 200);
    assert.deepEqual((await denied.json()).items, []);
  } finally {
    await server.stop();
  }
});

test('admin audit adopts unmapped legacy runtime sessions as enabled admin-owned sessions', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        title: null,
        updatedAt: 1_779_811_200_000,
        preview: 'Legacy prompt',
        firstUserInput: 'Legacy prompt',
        lastUserInput: 'Legacy prompt',
        lastInputAt: 1_779_811_200_000,
        favorite: false,
        favoriteOrder: null,
        goal: null,
        activeTurnId: null,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
      alice: { userId: 'user_alice', username: 'alice', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const adminList = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminList.status, 200);
    const adminPayload = await adminList.json();
    const legacyAudit = adminPayload.items.find((item: any) => item.codexThreadId === 'thread_legacy');
    assert.equal(legacyAudit.ownerUserId, 'user_admin');
    assert.equal(legacyAudit.projectDisplayName, 'legacy-repo');

    const state = await identityStore.readState();
    const legacySession = state.sessions.find((session) => session.codexThreadId === 'thread_legacy');
    assert.equal(legacySession?.ownerUserId, 'user_admin');
    assert.equal(state.projects.some((project) => project.id === legacySession?.projectId && project.enabled === true), true);

    const aliceList = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(aliceList.status, 200);
    const alicePayload = await aliceList.json();
    assert.equal(alicePayload.items.some((item: any) => item.id === legacySession?.id), false);
  } finally {
    await server.stop();
  }
});

test('admin audit re-enables previously imported legacy projects', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertProject({
    id: 'project_admin_legacy_cfd14b543e583280dd16',
    internalName: 'legacy-repo',
    cwd: '/Users/admin/legacy-repo',
    displayName: 'legacy-repo',
    enabled: false,
  });
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        updatedAt: 1_779_811_200_000,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
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
    const adminList = await fetch(`${server.baseUrl}/api/admin/sessions`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminList.status, 200);

    const state = await identityStore.readState();
    assert.equal(
      state.projects.some((project) => project.id === 'project_admin_legacy_cfd14b543e583280dd16' && project.enabled === true),
      true,
    );
  } finally {
    await server.stop();
  }
});

test('admin can start turns from an unmapped legacy runtime session id', async () => {
  const identityStore = await createIdentityStore();
  const runtime = {
    ...runtimeStub(),
    listSessions: async () => [
      {
        id: 'thread_legacy',
        cwd: '/Users/admin/legacy-repo',
        projectName: 'legacy-repo',
        title: null,
        updatedAt: 1_779_811_200_000,
        preview: 'Legacy prompt',
        firstUserInput: 'Legacy prompt',
        lastUserInput: 'Legacy prompt',
        lastInputAt: 1_779_811_200_000,
        favorite: false,
        favoriteOrder: null,
        goal: null,
        activeTurnId: null,
        settings: {},
        thread: { turns: [] },
        timeline: [],
      },
    ],
  };
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
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_legacy/turns`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello legacy' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { turnId: 'turn_1' });
    assert.equal(runtime.calls.includes('turn:thread_legacy'), true);

    const state = await identityStore.readState();
    const legacySession = state.sessions.find((session) => session.codexThreadId === 'thread_legacy');
    assert.equal(legacySession?.ownerUserId, 'user_admin');
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
        cwd: '/Users/admin/new-secret',
        displayName: '',
      }),
    });
    assert.equal(create.status, 201);
    const payload = await create.json();
    assert.deepEqual(payload.project, {
      id: 'project_new',
      internalName: 'project_new',
      cwd: '/Users/admin/new-secret',
      displayName: 'new-secret',
      enabled: true,
    });
  } finally {
    await server.stop();
  }
});

test('admin can create roles and users with project assignments', async () => {
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
        projectIds: ['project_allowed'],
      }),
    });
    assert.equal(role.status, 201);
    const rolePayload = await role.json();
    assert.equal(rolePayload.role.id, 'role_writer');
    assert.deepEqual(rolePayload.role.projectGrants, [
      { projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true },
    ]);

    const user = await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'user_writer',
        username: 'writer',
        password: 'writer-password',
        roleId: 'role_writer',
      }),
    });
    assert.equal(user.status, 201);
    const payload = await user.json();
    assert.equal(payload.user.id, 'user_writer');
    assert.equal(payload.user.passwordHash, undefined);
    assert.deepEqual(payload.user.roleIds, ['role_writer']);
    assert.equal(payload.user.roleId, 'role_writer');
    assert.equal(payload.user.canNewSession, undefined);

    const users = await fetch(`${server.baseUrl}/api/admin/users`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(users.status, 200);
    assert.equal((await users.json()).items.some((item: any) => item.username === 'writer'), true);
  } finally {
    await server.stop();
  }
});

test('admin can create users with direct project assignments that unlock project selection', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
      writer: { userId: 'user_writer', username: 'writer', roleIds: [], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const user = await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'user_writer',
        username: 'writer',
        password: 'writer-password',
        directProjectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
      }),
    });
    assert.equal(user.status, 201);

    const projects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer writer' },
    });
    assert.equal(projects.status, 200);
    assert.deepEqual(await projects.json(), {
      items: [{ id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, favorite: false }],
    });

    const create = await fetch(`${server.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer writer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_allowed' }),
    });
    assert.equal(create.status, 201);
    assert.deepEqual(runtime.calls, ['create:/Users/alice/secret-repo']);
  } finally {
    await server.stop();
  }
});

test('project favorites are stored per user and returned with projects', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
      admin: { userId: 'user_admin', username: 'admin', roleIds: ['role_admin'], isAdmin: true, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const favorite = await fetch(`${server.baseUrl}/api/projects/project_allowed/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(favorite.status, 200);
    assert.deepEqual(await favorite.json(), { projectId: 'project_allowed', favorite: true });

    const aliceProjects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer alice' },
    });
    assert.equal(aliceProjects.status, 200);
    assert.deepEqual(await aliceProjects.json(), {
      items: [{ id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, favorite: true }],
    });

    const adminProjects = await fetch(`${server.baseUrl}/api/projects`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(adminProjects.status, 200);
    assert.deepEqual(await adminProjects.json(), {
      items: [
        { id: 'project_allowed', displayName: 'Allowed Project', canCreate: true, favorite: false },
        { id: 'project_denied', displayName: 'Other Project', canCreate: true, favorite: false },
      ],
    });

    const state = await identityStore.readState();
    assert.deepEqual(state.users.find((user) => user.id === 'user_alice')?.favoriteProjectIds, ['project_allowed']);
    assert.deepEqual(state.users.find((user) => user.id === 'user_admin')?.favoriteProjectIds, []);
  } finally {
    await server.stop();
  }
});

test('project favorites reject unreadable projects', async () => {
  const identityStore = await createIdentityStore();
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      alice: { userId: 'user_alice', username: 'alice', roleIds: ['role_user'], isAdmin: false, mode: 'multi' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const favorite = await fetch(`${server.baseUrl}/api/projects/project_denied/favorite`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(favorite.status, 404);

    const state = await identityStore.readState();
    assert.deepEqual(state.users.find((user) => user.id === 'user_alice')?.favoriteProjectIds, []);
  } finally {
    await server.stop();
  }
});

test('admin can update existing user role without resetting password', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.upsertRole({
    id: 'role_viewer',
    name: 'Viewer',
    isAdmin: false,
    projectGrants: [{ projectId: 'project_allowed', canRead: true, canCreate: true, canWrite: true }],
  });
  const before = await identityStore.readState();
  const originalHash = before.users.find((user) => user.id === 'user_alice')?.passwordHash;
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
    const response = await fetch(`${server.baseUrl}/api/admin/users/user_alice`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: 'role_viewer' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.roleId, 'role_viewer');
    assert.deepEqual(payload.user.roleIds, ['role_viewer']);
    assert.equal(payload.user.canNewSession, undefined);
    assert.equal(payload.user.passwordHash, undefined);

    const after = await identityStore.readState();
    const alice = after.users.find((user) => user.id === 'user_alice');
    assert.equal(alice?.passwordHash, originalHash);
    assert.equal(await identityStore.verifyUserPassword('alice', 'alice-password'), 'user_alice');
  } finally {
    await server.stop();
  }
});

test('admin can delete a user and their related sessions, shares, and auth sessions', async () => {
  const identityStore = await createIdentityStore();
  await identityStore.addUserSession({
    id: 'auth_alice',
    tokenHash: 'hashed-token',
    deviceName: 'Alice Phone',
    createdAt: '2026-05-27T00:00:00.000Z',
    lastSeenAt: '2026-05-27T00:00:00.000Z',
    userId: 'user_alice',
  });
  await identityStore.createShare({
    sessionId: 'app_alice',
    createdByUserId: 'user_alice',
  });
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
    const response = await fetch(`${server.baseUrl}/api/admin/users/user_alice`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(response.status, 204);

    const state = await identityStore.readState();
    assert.equal(state.users.some((user) => user.id === 'user_alice'), false);
    assert.equal(state.sessions.some((session) => session.ownerUserId === 'user_alice'), false);
    assert.equal(state.userSessions.some((session) => session.userId === 'user_alice'), false);
    assert.equal(state.shares.some((share) => share.createdByUserId === 'user_alice' || share.sessionId === 'app_alice'), false);
  } finally {
    await server.stop();
  }
});

test('legacy local admin can enable multi-user mode from default single-user mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-toggle-'));
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth: authFor({
      legacy: { userId: 'local-admin', username: 'local-admin', roleIds: ['admin'], isAdmin: true, mode: 'single' },
    }),
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const before = await fetch(`${server.baseUrl}/api/admin/settings`, {
      headers: { Authorization: 'Bearer legacy' },
    });
    assert.equal(before.status, 200);
    assert.equal((await before.json()).settings.multiUserEnabled, false);

    const toggle = await fetch(`${server.baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer legacy', 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiUserEnabled: true }),
    });
    assert.equal(toggle.status, 200);
    assert.equal((await toggle.json()).settings.multiUserEnabled, true);

    const state = await identityStore.readState();
    assert.equal(state.settings.multiUserEnabled, true);
  } finally {
    await server.stop();
  }
});

test('enabling multi-user mode migrates the legacy password into an admin account', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-migrate-'));
  const legacyAuth = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  await legacyAuth.setPassword('single-password');
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  const auth = new HybridAuthStore({ legacyAuth, identityStore });
  const runtime = runtimeStub();
  const server = createCodexWebServer({
    auth,
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const legacyLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'single-password' }),
    });
    assert.equal(legacyLogin.status, 200);
    const { token } = await legacyLogin.json();

    const toggle = await fetch(`${server.baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiUserEnabled: true }),
    });
    assert.equal(toggle.status, 200);
    assert.equal(await auth.isConfigured(), true);

    const state = await identityStore.readState();
    const adminRole = state.roles.find((role) => role.isAdmin);
    const adminUser = state.users.find((user) => user.username === 'admin');
    assert.equal(adminRole?.id, 'role_admin');
    assert.deepEqual(adminUser?.roleIds, ['role_admin']);
    assert.notEqual(adminUser?.passwordHash, undefined);
    assert.equal(adminUser?.passwordHash?.includes('single-password'), false);

    const adminLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'single-password' }),
    });
    assert.equal(adminLogin.status, 200);
    const payload = await adminLogin.json();
    assert.equal(payload.session.principal.username, 'admin');
    assert.equal(payload.session.principal.isAdmin, true);
    assert.equal(payload.session.principal.mode, 'multi');
  } finally {
    await server.stop();
  }
});

test('legacy admin tokens continue writing admin-owned sessions after multi-user migration', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-mu-legacy-token-'));
  const legacyAuth = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  await legacyAuth.setPassword('single-password');
  const identityStore = new FileIdentityStore({ identityPath: path.join(dir, 'identity.json') });
  const auth = new HybridAuthStore({ legacyAuth, identityStore });
  const runtime = runtimeStub();

  const legacyLogin = await auth.login({ password: 'single-password', deviceName: 'phone' });
  await auth.setMultiUserEnabled(true);
  await identityStore.upsertProject({
    id: 'project_admin',
    internalName: 'admin-repo',
    cwd: '/Users/admin/admin-repo',
    displayName: 'Admin Project',
    enabled: true,
  });
  await identityStore.upsertSession({
    id: 'app_admin',
    codexThreadId: 'thread_admin',
    projectId: 'project_admin',
    ownerUserId: 'user_admin',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  });

  const server = createCodexWebServer({
    auth,
    identityStore,
    runtime: runtime as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/app_admin/turns`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${legacyLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'continue after migration' }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { turnId: 'turn_1' });
    assert.equal(runtime.calls.includes('turn:thread_admin'), true);
  } finally {
    await server.stop();
  }
});
