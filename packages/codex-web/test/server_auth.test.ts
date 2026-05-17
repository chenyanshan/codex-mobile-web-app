import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexWebServer } from '../src/server.js';

function createConfig() {
  return {
    host: '127.0.0.1',
    port: 0,
    defaultCwd: '/tmp',
    codexBin: 'codex',
    stateDir: '/tmp',
    authPath: '/tmp/auth.json',
    envPath: '/tmp/service.env',
    debug: false,
  };
}

function createRuntimeStub() {
  return {
    listModels: async () => [],
    readUsage: async () => null,
    listSessions: async () => [],
    createSession: async () => ({ id: 'thread_1' }),
    readSession: async () => ({ id: 'thread_1' }),
    updateSessionSettings: async () => ({ id: 'thread_1' }),
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

    const scriptResponse = await fetch(`${server.baseUrl}/app.js`);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type') ?? '', /^application\/javascript\b/i);
    assert.match(await scriptResponse.text(), /localStorage|codexWebToken|fetch/u);

    const styleResponse = await fetch(`${server.baseUrl}/styles.css`);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get('content-type') ?? '', /^text\/css\b/i);
    assert.match(await styleResponse.text(), /body|--bg|font-family/u);
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

test('POST /api/sessions/:id/turns returns session_not_found for stale sessions', async () => {
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
      startTurn: async () => {
        throw new Error('Unknown session: stale_thread');
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
      message: 'Selected session was not found. Start a new session.',
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
