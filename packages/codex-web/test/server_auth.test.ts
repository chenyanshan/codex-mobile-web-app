import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexWebServer } from '../src/server.js';

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

function createAcceptingAuth() {
  return {
    isConfigured: async () => true,
    login: async () => ({
      token: 'cw_token',
      session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' },
      configuredNow: false,
    }),
    verifyToken: async (token: string | null | undefined) => token === 'cw_token'
      ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
      : null,
    logout: async () => {},
  };
}

function createRuntimeStub() {
  return {
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [],
    createSession: async () => ({ id: 'thread_1' }),
    readSession: async () => ({ id: 'thread_1' }),
    archiveSession: async () => true,
    updateSessionFavorite: async () => ({ id: 'thread_1', favorite: true }),
    updateSessionSettings: async () => ({ id: 'thread_1' }),
    reloadRuntime: async () => ({ mcpServersReloaded: true }),
    startTurn: async () => ({ turnId: 'turn_1' }),
    interruptTurn: async () => {},
    resolveApproval: async () => {},
    getTurnEvents: () => [],
    subscribeToTurn: () => () => {},
  };
}

test('API routes reject missing bearer token', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});

test('API routes accept valid bearer token', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login is public', async () => {
  let called = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async ({ password, deviceName }) => {
        called = true;
        assert.equal(password, 'secret-password');
        assert.equal(deviceName, 'iPhone Safari');
        return {
          token: 'cw_token',
          session: { id: 's1', deviceName: 'iPhone Safari', createdAt: '', lastSeenAt: '' },
          configuredNow: false,
        };
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'secret-password',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(called, true);
    assert.match((await response.json()).token, /^cw_/);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login returns 401 for invalid passwords', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        throw new Error('Invalid password');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'bad-password',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'invalid_password',
      message: 'Invalid password',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rate limits repeated attempts before password verification', async () => {
  let loginCalls = 0;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalls += 1;
        throw new Error('Invalid password');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: `bad-password-${index}`,
          deviceName: 'iPhone Safari',
        }),
      });
      assert.equal(response.status, 401);
    }

    const limited = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'bad-password-limited',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(limited.status, 429);
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.equal(Number.isInteger(retryAfter), true);
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    const payload = await limited.json();
    assert.equal(payload.error, 'rate_limited');
    assert.equal(payload.message, 'Too many login attempts. Try again later.');
    assert.equal(Number.isInteger(payload.retryAfterSeconds), true);
    assert.ok(payload.retryAfterSeconds >= 1 && payload.retryAfterSeconds <= 60);
    assert.deepEqual(Object.keys(payload).sort(), ['error', 'message', 'retryAfterSeconds']);
    assert.equal(loginCalls, 10);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login does not trust spoofed forwarded headers for rate limits', async () => {
  let loginCalls = 0;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalls += 1;
        throw new Error('Invalid password');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `203.0.113.${index}`,
        },
        body: JSON.stringify({
          password: `bad-password-${index}`,
          deviceName: 'iPhone Safari',
        }),
      });
      assert.equal(response.status, 401);
    }

    const limited = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.250',
      },
      body: JSON.stringify({
        password: 'bad-password-limited',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(limited.status, 429);
    assert.equal(loginCalls, 10);
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rejects oversized bodies before password verification', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalled = true;
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'x'.repeat(70 * 1024),
      }),
    });
    assert.equal(response.status, 413);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'payload_too_large',
      message: 'Request body is too large.',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rejects malformed JSON with 400', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalled = true;
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"password":',
    });
    assert.equal(response.status, 400);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'invalid_json',
      message: 'Request body must be valid JSON.',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login rejects non-object JSON with 400', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => {
        loginCalled = true;
        throw new Error('unused');
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(response.status, 400);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'invalid_json',
      message: 'Request body must be a JSON object.',
    });
  } finally {
    await server.stop();
  }
});

test('POST /api/auth/login returns setup_required when password is not configured', async () => {
  let loginCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => false,
      login: async () => {
        loginCalled = true;
        return {
          token: 'cw_token',
          session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' },
          configuredNow: false,
        };
      },
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'secret-password',
        deviceName: 'iPhone Safari',
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(loginCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'setup_required',
      message: 'Password not configured. Run codex-web auth set-password.',
    });
  } finally {
    await server.stop();
  }
});

test('static root is public', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Codex Web/);
    assert.match(html, /app\.js/);
    assert.match(html, /styles\.css/);

    const indexResponse = await fetch(`${server.baseUrl}/index.html`);
    assert.equal(indexResponse.status, 200);
    assert.equal(await indexResponse.text(), html);

    const scriptResponse = await fetch(`${server.baseUrl}/app.js`);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type') ?? '', /^application\/javascript\b/i);
    assert.match(await scriptResponse.text(), /localStorage|codexWebToken|fetch/u);

    const styleResponse = await fetch(`${server.baseUrl}/styles.css`);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get('content-type') ?? '', /^text\/css\b/i);
    assert.match(await styleResponse.text(), /body|--bg|font-family/u);

    const manifestResponse = await fetch(`${server.baseUrl}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type') ?? '', /^application\/manifest\+json\b/i);
    assert.equal((await manifestResponse.json()).display, 'standalone');

    const serviceWorkerResponse = await fetch(`${server.baseUrl}/service-worker.js`);
    assert.equal(serviceWorkerResponse.status, 200);
    assert.match(serviceWorkerResponse.headers.get('content-type') ?? '', /^application\/javascript\b/i);
    assert.match(await serviceWorkerResponse.text(), /self\.addEventListener/u);

    const iconResponse = await fetch(`${server.baseUrl}/icon-192.png`);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get('content-type') ?? '', /^image\/png\b/i);
  } finally {
    await server.stop();
  }
});

test('GET / shows setup-required page when password is not configured', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => false,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
    assert.match(await response.text(), /codex-web auth set-password/);
  } finally {
    await server.stop();
  }
});

test('protected API routes return setup_required when password is not configured', async () => {
  let verifyTokenCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => false,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => {
        verifyTokenCalled = true;
        return null;
      },
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 503);
    assert.equal(verifyTokenCalled, false);
    assert.deepEqual(await response.json(), {
      error: 'setup_required',
      message: 'Password not configured. Run codex-web auth set-password.',
    });
  } finally {
    await server.stop();
  }
});

test('SSE route rejects missing bearer token', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async () => null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events`);
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});

test('POST /api/sessions/:id/turns returns 404 without starting a replacement session', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      createSession: async () => {
        calls.push('createSession');
        return { id: 'thread_recovered', cwd: '/tmp', settings: {}, thread: {} };
      },
      startTurn: async (sessionId: string) => {
        calls.push(`startTurn:${sessionId}`);
        if (sessionId === 'stale_thread') {
          throw new Error('Unknown session: stale_thread');
        }
        return { turnId: 'turn_recovered' };
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/stale_thread/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'session_not_found',
      message: 'Selected session was not found.',
    });
    assert.deepEqual(calls, [
      'startTurn:stale_thread',
    ]);
  } finally {
    await server.stop();
  }
});

test('POST /api/runtime/reload reloads the runtime for authenticated clients', async () => {
  let reloadCalls = 0;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      reloadRuntime: async () => {
        reloadCalls += 1;
        return { mcpServersReloaded: true };
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/runtime/reload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      mcpServersReloaded: true,
    });
    assert.equal(reloadCalls, 1);
  } finally {
    await server.stop();
  }
});

test('DELETE /api/sessions/:id archives a session', async () => {
  const calls: string[] = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      archiveSession: async (sessionId: string) => {
        calls.push(sessionId);
        return sessionId === 'thread_1';
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, ['thread_1']);
  } finally {
    await server.stop();
  }
});

test('PATCH /api/sessions/:id/favorite updates favorite state and order', async () => {
  const calls: Array<{ sessionId: string; favorite: boolean; favoriteOrder?: number | null }> = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      updateSessionFavorite: async (sessionId: string, favorite: boolean, favoriteOrder?: number | null) => {
        calls.push({ sessionId, favorite, favoriteOrder });
        return sessionId === 'thread_1' ? { id: sessionId, favorite, favoriteOrder } : null;
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/sessions/thread_1/favorite`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ favorite: true, favoriteOrder: 3 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      session: { id: 'thread_1', favorite: true, favoriteOrder: 3 },
    });
    assert.deepEqual(calls, [{ sessionId: 'thread_1', favorite: true, favoriteOrder: 3 }]);
  } finally {
    await server.stop();
  }
});

test('GET /api/sessions passes the favorite filter to the runtime', async () => {
  const calls: Array<{ favorite?: boolean }> = [];
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      listSessions: async (options?: { favorite?: boolean }) => {
        calls.push(options ?? {});
        return [{ id: options?.favorite ? 'favorite_thread' : 'thread_1', favorite: options?.favorite === true }];
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const favoritesResponse = await fetch(`${server.baseUrl}/api/sessions?favorite=true`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(favoritesResponse.status, 200);
    assert.equal((await favoritesResponse.json()).items[0].id, 'favorite_thread');

    const allResponse = await fetch(`${server.baseUrl}/api/sessions`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(allResponse.status, 200);
    assert.equal((await allResponse.json()).items[0].id, 'thread_1');
    assert.deepEqual(calls, [{ favorite: true }, {}]);
  } finally {
    await server.stop();
  }
});

test('GET /api/reports lists reports for authenticated clients', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'summary.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/reports`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { items: Array<{ id: string; project: string; kind: string }> };
    assert.deepEqual(payload.items.map((report) => ({
      id: report.id,
      project: report.project,
      kind: report.kind,
    })), [
      {
        id: 'project-a/2026-05-19/summary.md',
        project: 'project-a',
        kind: 'markdown',
      },
    ]);
  } finally {
    await server.stop();
  }
});

test('GET /api/reports/:id/content returns report content', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'audit.html');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '<h1>Audit</h1>\n', 'utf8');
  const reportId = 'project-a/2026-05-19/audit.html';
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/reports/${encodeURIComponent(reportId)}/content`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { report: { id: string; kind: string }; content: string };
    assert.equal(payload.report.id, reportId);
    assert.equal(payload.report.kind, 'html');
    assert.equal(payload.content, '<h1>Audit</h1>\n');
  } finally {
    await server.stop();
  }
});

test('PATCH /api/reports/:id/favorite updates report favorite state', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'summary.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');
  const reportId = 'project-a/2026-05-19/summary.md';
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/reports/${encodeURIComponent(reportId)}/favorite`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { report: { favorite: boolean } };
    assert.equal(payload.report.favorite, true);
  } finally {
    await server.stop();
  }
});

test('POST /api/reports/resolve accepts report-root absolute paths and rejects outside paths', async (t) => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-server-reports-'));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  const reportPath = path.join(stateDir, 'reports', 'project-a', '2026-05-19', 'summary.md');
  const outsidePath = path.join(stateDir, 'outside.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');
  await fs.writeFile(outsidePath, '# Outside\n', 'utf8');
  const server = createCodexWebServer({
    auth: createAcceptingAuth(),
    runtime: createRuntimeStub() as any,
    config: createConfig({ stateDir }),
  });
  await server.start();
  try {
    const resolved = await fetch(`${server.baseUrl}/api/reports/resolve`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: reportPath }),
    });
    assert.equal(resolved.status, 200);
    assert.equal(((await resolved.json()) as { report: { id: string } }).report.id, 'project-a/2026-05-19/summary.md');

    const rejected = await fetch(`${server.baseUrl}/api/reports/resolve`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cw_token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: outsidePath }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), {
      error: 'invalid_report_path',
      message: 'Report path is outside the reports directory.',
    });
  } finally {
    await server.stop();
  }
});

test('SSE route accepts bearer auth and streams events', async () => {
  let unsubscribeCalled = false;
  let resolveUnsubscribed: (() => void) | null = null;
  const unsubscribed = new Promise<void>((resolve) => {
    resolveUnsubscribed = resolve;
  });
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      getTurnEvents: () => [
        {
          sequence: 1,
          event: {
            id: 'evt_1',
            type: 'turn.started',
            turnId: 'turn_1',
            threadId: 'thread_1',
          },
        },
      ],
      subscribeToTurn: () => () => {
        unsubscribeCalled = true;
        resolveUnsubscribed?.();
      },
    } as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);
    assert.match(text, /turn.started/);
    await reader!.cancel();
    await Promise.race([
      unsubscribed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('unsubscribe not called')), 1_000)),
    ]);
    assert.equal(unsubscribeCalled, true);
  } finally {
    await server.stop();
  }
});

test('server stop closes live SSE streams promptly', async () => {
  let unsubscribeCalled = false;
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: {
      ...createRuntimeStub(),
      getTurnEvents: () => [
        {
          sequence: 1,
          event: {
            id: 'evt_1',
            type: 'turn.started',
            turnId: 'turn_1',
            threadId: 'thread_1',
          },
        },
      ],
      subscribeToTurn: () => () => {
        unsubscribeCalled = true;
      },
    } as any,
    config: createConfig(),
  });
  let stopPromise: Promise<void> | null = null;
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events`, {
      headers: { Authorization: 'Bearer cw_token' },
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader!.read();
    assert.equal(firstChunk.done, false);

    stopPromise = server.stop();
    await Promise.race([
      stopPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('server.stop() did not resolve')), 1_000)),
    ]);
    assert.equal(unsubscribeCalled, true);

    const finalChunk = await reader!.read().catch(() => ({ done: true, value: undefined }));
    assert.equal(finalChunk.done, true);
  } finally {
    if (stopPromise) {
      await stopPromise.catch(() => {});
    } else {
      await server.stop();
    }
  }
});

test('SSE route rejects query token without bearer auth', async () => {
  const server = createCodexWebServer({
    auth: {
      isConfigured: async () => true,
      login: async () => ({ token: 'cw_token', session: { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }, configuredNow: false }),
      verifyToken: async (token) => token === 'cw_token'
        ? { id: 's1', deviceName: 'phone', createdAt: '', lastSeenAt: '' }
        : null,
      logout: async () => {},
    },
    runtime: createRuntimeStub() as any,
    config: createConfig(),
  });
  await server.start();
  try {
    const response = await fetch(`${server.baseUrl}/api/turns/turn_1/events?token=cw_token`);
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});
