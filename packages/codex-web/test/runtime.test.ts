import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProviderApprovalRequest,
  ProviderThreadListResult,
  ProviderThreadStartResult,
  ProviderThreadSummary,
  ProviderTurnResult,
  ProviderUsageReport,
} from '../../codex-native-api/src/index.js';
import { CodexWebEventBus } from '../src/event_bus.js';
import { CodexWebRuntime, type CodexWebRuntimeClient } from '../src/runtime.js';

function createThread(threadId = 'thread_1'): ProviderThreadSummary {
  return {
    threadId,
    cwd: '/workspace',
    title: 'Thread',
    updatedAt: 1,
    preview: 'Preview',
    turns: [],
  };
}

test('session summary extracts user inputs from turns and project name from cwd', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_summary')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_summary', cwd: '/Users/alice/project', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_summary'),
      cwd: '/Users/alice/project',
      updatedAt: 123,
      preview: 'Preview fallback',
      turns: [
        {
          id: 'turn_1',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'assistant', phase: null, text: 'Assistant preface' },
            { type: 'message', role: 'user', phase: null, text: 'First user request' },
          ],
        },
        {
          id: 'turn_2',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Latest user request' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_summary',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const session = await runtime.readSession('thread_summary');

  assert.equal(session?.projectName, 'alice/project');
  assert.equal(session?.firstUserInput, 'First user request');
  assert.equal(session?.lastUserInput, 'Latest user request');
  assert.equal(session?.lastInputAt, 123);
});

test('session summary falls back to preview when turns have no user input', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_preview')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_preview', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_preview'),
      cwd: '/single',
      updatedAt: 456,
      preview: 'Preview fallback text',
      turns: [],
    }),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_preview',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const session = await runtime.readSession('thread_preview');

  assert.equal(session?.projectName, 'single');
  assert.equal(session?.firstUserInput, 'Preview fallback text');
  assert.equal(session?.lastUserInput, 'Preview fallback text');
  assert.equal(session?.lastInputAt, 456);
});

test('runtime lists sessions from thread summaries without hydrating every thread', async () => {
  let readThreadCalls = 0;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({
      items: [
        {
          ...createThread('thread_fast_1'),
          cwd: '/workspace/one',
          updatedAt: 30,
          preview: 'Fast preview one',
        },
        {
          ...createThread('thread_fast_2'),
          cwd: '/workspace/two',
          updatedAt: 20,
          preview: 'Fast preview two',
        },
      ],
      nextCursor: null,
    }),
    startThread: async () => ({ threadId: 'thread_fast_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => {
      readThreadCalls += 1;
      return createThread('thread_fast_1');
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_fast_1',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const sessions = await runtime.listSessions();

  assert.equal(readThreadCalls, 0);
  assert.deepEqual(sessions.map((session) => session.id), ['thread_fast_1', 'thread_fast_2']);
  assert.equal(sessions[0]?.firstUserInput, 'Fast preview one');
});

test('runtime reloads MCP servers through the Codex app client', async () => {
  let reloadCalls = 0;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_1'),
    writeConfigValue: async () => {},
    reloadMcpServers: async () => {
      reloadCalls += 1;
    },
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_1',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const result = await runtime.reloadRuntime();

  assert.deepEqual(result, { mcpServersReloaded: true });
  assert.equal(reloadCalls, 1);
});

test('runtime marks thread settings that only come from defaults', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_defaults_only')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_defaults_only', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_defaults_only'),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_defaults_only',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const session = await runtime.readSession('thread_defaults_only');

  assert.equal(session?.settings.metadata?.codexWebDefaultsOnly, true);
});

test('runtime falls back from includeTurns reads and escapes hyphenated profile config paths', async () => {
  const writes: Array<{ keyPath: string; value: unknown }> = [];
  const readCalls: boolean[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async (): Promise<ProviderThreadListResult> => ({
      items: [createThread('thread-native-tools-1')],
      nextCursor: null,
    }),
    startThread: async (): Promise<ProviderThreadStartResult> => ({
      threadId: 'thread-native-tools-1',
      cwd: '/workspace',
      title: 'Thread',
    }),
    readThread: async (_threadId, includeTurns) => {
      readCalls.push(Boolean(includeTurns));
      if (includeTurns) {
        throw new Error('includeTurns is unavailable before first user message');
      }
      return createThread('thread-native-tools-1');
    },
    writeConfigValue: async ({ keyPath, value }) => {
      writes.push({ keyPath, value });
    },
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread-native-tools-1',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const sessions = await runtime.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.id, 'thread-native-tools-1');
  assert.equal(sessions[0]?.settings.model, 'gpt-5.4');
  assert.equal(sessions[0]?.settings.reasoningEffort, 'xhigh');
  assert.equal(sessions[0]?.settings.accessPreset, 'full-access');
  assert.equal(sessions[0]?.settings.approvalPolicy, 'never');
  assert.equal(sessions[0]?.settings.sandboxMode, 'danger-full-access');

  const created = await runtime.createSession();
  assert.equal(created.id, 'thread-native-tools-1');

  const reread = await runtime.readSession('thread-native-tools-1');
  assert.equal(reread?.id, 'thread-native-tools-1');

  const updated = await runtime.updateSessionSettings('thread-native-tools-1', {
    model: 'gpt-5',
    reasoningEffort: 'high',
  });
  assert.equal(updated?.settings.model, 'gpt-5');
  assert.equal(updated?.settings.reasoningEffort, 'high');
  assert.deepEqual(readCalls, [true, false, true, false, true, false]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.keyPath, 'profiles."thread-native-tools-1"');
});

test('runtime omits null session settings when writing Codex profile config', async () => {
  const writes: Array<{ keyPath: string; value: Record<string, unknown> }> = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_profile_config')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_profile_config', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_profile_config'),
    writeConfigValue: async ({ keyPath, value }) => {
      writes.push({ keyPath, value: value as Record<string, unknown> });
    },
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_profile_config',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  await runtime.updateSessionSettings('thread_profile_config', {
    model: 'gpt-5',
    reasoningEffort: 'high',
  });

  assert.equal(writes[0]?.keyPath, 'profiles.thread_profile_config');
  assert.deepEqual(writes[0]?.value, {
    model: 'gpt-5',
    reasoningEffort: 'high',
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    metadata: {},
  });
  assert.equal(Object.values(writes[0]?.value ?? {}).includes(null), false);
});

test('runtime passes requested cwd and settings when creating a session', async () => {
  const startThreadCalls: Array<{
    cwd?: string | null;
    title?: string | null;
    model?: string | null;
    serviceTier?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    ephemeral?: boolean | null;
  }> = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async (args): Promise<ProviderThreadStartResult> => {
      const request = args ?? {};
      startThreadCalls.push(request);
      return {
        threadId: 'thread_custom_cwd',
        cwd: request.cwd ?? null,
        title: 'Thread',
      };
    },
    readThread: async () => ({
      ...createThread('thread_custom_cwd'),
      cwd: '/custom/workspace',
    }),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_custom_cwd',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/default/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const created = await runtime.createSession({
    cwd: '/custom/workspace',
    settings: {
      model: 'gpt-5.5',
      serviceTier: 'flex',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    },
  });

  assert.equal(created.cwd, '/custom/workspace');
  assert.deepEqual(startThreadCalls, [{
    cwd: '/custom/workspace',
    title: null,
    model: 'gpt-5.5',
    serviceTier: 'flex',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    ephemeral: false,
  }]);
});

test('runtime uses full-access gpt-5.4 xhigh defaults and persists turn settings', async () => {
  const storedSettings: Array<{ sessionId: string; settings: any }> = [];
  const startThreadCalls: Array<{
    model?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
  }> = [];
  const startTurnCalls: Array<{
    model?: string | null;
    effort?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
  }> = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_defaults')], nextCursor: null }),
    startThread: async (args): Promise<ProviderThreadStartResult> => {
      startThreadCalls.push(args ?? {});
      return { threadId: 'thread_defaults', cwd: '/workspace', title: 'Thread' };
    },
    readThread: async () => createThread('thread_defaults'),
    writeConfigValue: async () => {},
    startTurn: async (args) => {
      startTurnCalls.push(args);
      await args.onTurnStarted?.({ turnId: 'turn_defaults', threadId: 'thread_defaults' });
      return {
        outputText: 'done',
        status: 'completed',
        turnId: 'turn_defaults',
        threadId: 'thread_defaults',
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: () => null,
      set: (sessionId, settings) => {
        storedSettings.push({ sessionId, settings });
      },
      delete: () => {},
    },
  });

  const created = await runtime.createSession();
  assert.equal(created.settings.model, 'gpt-5.4');
  assert.equal(created.settings.reasoningEffort, 'xhigh');
  assert.equal(created.settings.accessPreset, 'full-access');
  assert.equal(created.settings.approvalPolicy, 'never');
  assert.equal(created.settings.sandboxMode, 'danger-full-access');
  assert.deepEqual(startThreadCalls, [{
    cwd: '/workspace',
    title: null,
    model: 'gpt-5.4',
    serviceTier: null,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    ephemeral: false,
  }]);

  await runtime.startTurn('thread_defaults', {
    text: 'hello',
    settings: {
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
    },
  });

  assert.equal(startTurnCalls[0]?.model, 'gpt-5.5');
  assert.equal(startTurnCalls[0]?.effort, 'high');
  assert.equal(startTurnCalls[0]?.approvalPolicy, 'on-request');
  assert.equal(startTurnCalls[0]?.sandboxMode, 'workspace-write');
  assert.equal(storedSettings.at(-1)?.sessionId, 'thread_defaults');
  assert.equal(storedSettings.at(-1)?.settings.model, 'gpt-5.5');
  assert.equal(storedSettings.at(-1)?.settings.reasoningEffort, 'high');
});

test('runtime persists session favorite state and exposes it on session summaries', async () => {
  let storedSettings: any = null;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_favorite')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_favorite', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_favorite'),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const settingsStore = {
    get: () => storedSettings,
    set: (_sessionId: string, settings: any) => {
      storedSettings = settings;
    },
    delete: () => {
      storedSettings = null;
    },
  };
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore,
  });

  const initial = await runtime.readSession('thread_favorite');
  assert.equal(initial?.favorite, false);

  const favorited = await runtime.updateSessionFavorite('thread_favorite', true);
  assert.equal(favorited?.favorite, true);
  assert.equal(storedSettings.favorite, true);
  assert.equal(storedSettings.favoriteOrder, 1);

  const reordered = await runtime.updateSessionFavorite('thread_favorite', true, 7);
  assert.equal(reordered?.favoriteOrder, 7);
  assert.equal(storedSettings.favoriteOrder, 7);

  const reloaded = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore,
  });
  const listed = await reloaded.listSessions();
  assert.equal(listed[0]?.favorite, true);
  const favoriteListed = await reloaded.listSessions({ favorite: true });
  assert.equal(favoriteListed.length, 1);
  assert.equal(favoriteListed[0]?.id, 'thread_favorite');

  const unfavorited = await reloaded.updateSessionFavorite('thread_favorite', false);
  assert.equal(unfavorited?.favorite, false);
  assert.equal(storedSettings.favorite, false);
  assert.equal(storedSettings.favoriteOrder, null);
  const emptyFavoriteListed = await reloaded.listSessions({ favorite: true });
  assert.equal(emptyFavoriteListed.length, 0);
});

test('runtime reorders an existing favorite without hydrating its thread', async () => {
  const readCalls: Array<{ threadId: string; includeTurns: boolean | undefined }> = [];
  const store = new Map([
    ['thread_favorite', {
      bridgeSessionId: 'thread_favorite',
      favorite: true,
      favoriteOrder: 5,
      updatedAt: 10,
      metadata: {},
    }],
  ]);
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_favorite', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId, includeTurns) => {
      readCalls.push({ threadId, includeTurns });
      throw new Error(`no rollout found for thread id ${threadId}`);
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: (sessionId) => store.get(sessionId) as any,
      list: () => [...store.entries()] as any,
      set: (sessionId, settings) => {
        store.set(sessionId, settings as any);
      },
      delete: (sessionId) => {
        store.delete(sessionId);
      },
    },
  });

  const reordered = await runtime.updateSessionFavorite('thread_favorite', true, 1);

  assert.deepEqual(readCalls, []);
  assert.equal(reordered?.id, 'thread_favorite');
  assert.equal(reordered?.favorite, true);
  assert.equal(reordered?.favoriteOrder, 1);
  assert.equal(store.get('thread_favorite')?.favoriteOrder, 1);
});

test('runtime lists favorite sessions by reading only favorite thread summaries', async () => {
  let listCalls = 0;
  const readCalls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => {
      listCalls += 1;
      return {
        items: [
          createThread('thread_favorite_a'),
          createThread('thread_favorite_b'),
          createThread('thread_other'),
        ],
        nextCursor: null,
      };
    },
    startThread: async () => ({ threadId: 'thread_favorite_a', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId, includeTurns) => {
      readCalls.push(threadId);
      assert.equal(includeTurns, false);
      return createThread(threadId);
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite_a',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const store = new Map([
    ['thread_favorite_a', { bridgeSessionId: 'thread_favorite_a', favorite: true, favoriteOrder: 2, metadata: {} }],
    ['thread_favorite_b', { bridgeSessionId: 'thread_favorite_b', favorite: true, favoriteOrder: 1, metadata: {} }],
  ]);
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: (sessionId) => store.get(sessionId) as any,
      list: () => [...store.entries()] as any,
      set: (sessionId, settings) => {
        store.set(sessionId, settings as any);
      },
      delete: (sessionId) => {
        store.delete(sessionId);
      },
    },
  });

  const favorites = await runtime.listSessions({ favorite: true });

  assert.deepEqual(favorites.map((session) => session.id), ['thread_favorite_b', 'thread_favorite_a']);
  assert.equal(listCalls, 0);
  assert.deepEqual(readCalls.sort(), ['thread_favorite_a', 'thread_favorite_b']);
});

test('runtime resumes favorite historical threads before hiding them', async () => {
  let resumed = false;
  const readCalls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_favorite_history', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId, includeTurns) => {
      assert.equal(includeTurns, false);
      readCalls.push(threadId);
      if (!resumed) {
        return null;
      }
      return createThread(threadId);
    },
    resumeThread: async ({ threadId }) => {
      assert.equal(threadId, 'thread_favorite_history');
      resumed = true;
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite_history',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const store = new Map([
    ['thread_favorite_history', { bridgeSessionId: 'thread_favorite_history', favorite: true, favoriteOrder: 1, metadata: {} }],
  ]);
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: (sessionId) => store.get(sessionId) as any,
      list: () => [...store.entries()] as any,
      set: (sessionId, settings) => {
        store.set(sessionId, settings as any);
      },
      delete: (sessionId) => {
        store.delete(sessionId);
      },
    },
  });

  const favorites = await runtime.listSessions({ favorite: true });

  assert.equal(resumed, true);
  assert.deepEqual(readCalls, ['thread_favorite_history', 'thread_favorite_history']);
  assert.deepEqual(favorites.map((session) => session.id), ['thread_favorite_history']);
});

test('runtime skips unavailable favorite threads without hiding readable favorites', async () => {
  const readCalls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_favorite_visible', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId, includeTurns) => {
      assert.equal(includeTurns, false);
      readCalls.push(threadId);
      if (threadId === 'thread_favorite_missing') {
        throw new Error(`thread not loaded: ${threadId}`);
      }
      return createThread(threadId);
    },
    resumeThread: async ({ threadId }) => {
      assert.equal(threadId, 'thread_favorite_missing');
      throw new Error(`thread not loaded: ${threadId}`);
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite_visible',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const store = new Map([
    ['thread_favorite_missing', { bridgeSessionId: 'thread_favorite_missing', favorite: true, favoriteOrder: 1, metadata: {} }],
    ['thread_favorite_visible', { bridgeSessionId: 'thread_favorite_visible', favorite: true, favoriteOrder: 2, metadata: {} }],
  ]);
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: (sessionId) => store.get(sessionId) as any,
      list: () => [...store.entries()] as any,
      set: (sessionId, settings) => {
        store.set(sessionId, settings as any);
      },
      delete: (sessionId) => {
        store.delete(sessionId);
      },
    },
  });

  const favorites = await runtime.listSessions({ favorite: true });

  assert.deepEqual(readCalls, ['thread_favorite_missing', 'thread_favorite_visible']);
  assert.deepEqual(favorites.map((session) => session.id), ['thread_favorite_visible']);
  assert.equal(favorites[0]?.title, 'Thread');
});

test('runtime returns no favorite sessions when every favorite thread is unavailable', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_favorite_a', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId, includeTurns) => {
      assert.equal(includeTurns, false);
      throw new Error(`no rollout found for thread id ${threadId}`);
    },
    resumeThread: async ({ threadId }) => {
      throw new Error(`no rollout found for thread id ${threadId}`);
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite_a',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const store = new Map([
    ['thread_favorite_a', {
      bridgeSessionId: 'thread_favorite_a',
      favorite: true,
      favoriteOrder: 2,
      updatedAt: 20,
      metadata: {},
    }],
    ['thread_favorite_b', {
      bridgeSessionId: 'thread_favorite_b',
      favorite: true,
      favoriteOrder: 1,
      updatedAt: 30,
      metadata: {},
    }],
  ]);
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: (sessionId) => store.get(sessionId) as any,
      list: () => [...store.entries()] as any,
      set: (sessionId, settings) => {
        store.set(sessionId, settings as any);
      },
      delete: (sessionId) => {
        store.delete(sessionId);
      },
    },
  });

  const favorites = await runtime.listSessions({ favorite: true });

  assert.deepEqual(favorites, []);
});

test('runtime archives an unavailable favorite by removing local favorite settings', async () => {
  let archiveCalled = false;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_favorite_missing', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => {
      throw new Error('no rollout found for thread id thread_favorite_missing');
    },
    archiveThread: async () => {
      archiveCalled = true;
      throw new Error('archive should not be attempted for fallback-only favorite');
    },
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_favorite_missing',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const store = new Map([
    ['thread_favorite_missing', {
      bridgeSessionId: 'thread_favorite_missing',
      favorite: true,
      favoriteOrder: 1,
      updatedAt: 20,
      metadata: {},
    }],
  ]);
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore: {
      get: (sessionId) => store.get(sessionId) as any,
      list: () => [...store.entries()] as any,
      set: (sessionId, settings) => {
        store.set(sessionId, settings as any);
      },
      delete: (sessionId) => {
        store.delete(sessionId);
      },
    },
  });

  const archived = await runtime.archiveSession('thread_favorite_missing');
  const favorites = await runtime.listSessions({ favorite: true });

  assert.equal(archived, true);
  assert.equal(archiveCalled, false);
  assert.equal(store.has('thread_favorite_missing'), false);
  assert.deepEqual(favorites.map((item) => item.id), []);
});

test('runtime resumes historical threads before treating them as missing', async () => {
  let resumed = false;
  const readCalls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('history_thread')], nextCursor: null }),
    startThread: async () => ({ threadId: 'history_thread', cwd: '/workspace', title: 'Thread' }),
    readThread: async (threadId) => {
      readCalls.push(threadId);
      if (!resumed) {
        throw new Error(`thread not found: ${threadId}`);
      }
      return createThread(threadId);
    },
    resumeThread: async ({ threadId }) => {
      assert.equal(threadId, 'history_thread');
      resumed = true;
    },
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }) => {
      await onTurnStarted?.({ turnId: 'turn_history', threadId: 'history_thread' });
      return {
        outputText: 'done',
        status: 'completed',
        turnId: 'turn_history',
        threadId: 'history_thread',
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const session = await runtime.readSession('history_thread');
  assert.equal(session?.id, 'history_thread');
  assert.equal(resumed, true);
  assert.deepEqual(readCalls, ['history_thread', 'history_thread']);
});

test('runtime resumes a readable historical thread before starting a turn', async () => {
  const calls: string[] = [];
  let resumed = false;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('turn_history_thread')], nextCursor: null }),
    startThread: async () => ({ threadId: 'turn_history_thread', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('turn_history_thread'),
    resumeThread: async ({ threadId }) => {
      calls.push(`resume:${threadId}`);
      resumed = true;
    },
    writeConfigValue: async () => {},
    startTurn: async ({ threadId, onTurnStarted }) => {
      calls.push(`turn:${threadId}`);
      if (!resumed) {
        throw new Error(`thread not found: ${threadId}`);
      }
      await onTurnStarted?.({ turnId: 'turn_history_started', threadId });
      return {
        outputText: 'done',
        status: 'completed',
        turnId: 'turn_history_started',
        threadId,
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  await runtime.startTurn('turn_history_thread', { text: 'continue' });

  assert.deepEqual(calls, [
    'resume:turn_history_thread',
    'turn:turn_history_thread',
  ]);
});

test('runtime starts the first turn when a new thread has no rollout to resume', async () => {
  const calls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('new_thread')], nextCursor: null }),
    startThread: async () => ({ threadId: 'new_thread', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('new_thread'),
    resumeThread: async ({ threadId }) => {
      calls.push(`resume:${threadId}`);
      throw new Error(`no rollout found for thread id ${threadId}`);
    },
    writeConfigValue: async () => {},
    startTurn: async ({ threadId, onTurnStarted }) => {
      calls.push(`turn:${threadId}`);
      await onTurnStarted?.({ turnId: 'turn_new_thread', threadId });
      return {
        outputText: 'done',
        status: 'completed',
        turnId: 'turn_new_thread',
        threadId,
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  await runtime.startTurn('new_thread', { text: 'first message' });

  assert.deepEqual(calls, [
    'resume:new_thread',
    'turn:new_thread',
  ]);
});

test('runtime treats empty rollout thread-store errors as a recoverable first-turn case', async () => {
  const calls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('empty_rollout_thread')], nextCursor: null }),
    startThread: async () => ({ threadId: 'empty_rollout_thread', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('empty_rollout_thread'),
    resumeThread: async ({ threadId }) => {
      calls.push(`resume:${threadId}`);
      throw new Error(
        'failed to read thread: thread-store internal error: failed to read thread '
        + '/Users/test/.codex/sessions/2026/05/20/rollout-2026-05-20T14-51-03.jsonl: '
        + 'rollout at /Users/test/.codex/sessions/2026/05/20/rollout-2026-05-20T14-51-03.jsonl is empty',
      );
    },
    writeConfigValue: async () => {},
    startTurn: async ({ threadId, onTurnStarted }) => {
      calls.push(`turn:${threadId}`);
      await onTurnStarted?.({ turnId: 'turn_empty_rollout_thread', threadId });
      return {
        outputText: 'done',
        status: 'completed',
        turnId: 'turn_empty_rollout_thread',
        threadId,
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  await runtime.startTurn('empty_rollout_thread', { text: 'first message' });

  assert.deepEqual(calls, [
    'resume:empty_rollout_thread',
    'turn:empty_rollout_thread',
  ]);
});

test('runtime treats missing native threads as absent when opened or used', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async () => null,
    listThreads: async () => ({ items: [createThread('thread_missing')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => {
      throw new Error('Thread not found');
    },
    writeConfigValue: async () => {},
    startTurn: async () => {
      throw new Error('unused');
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  assert.equal(await runtime.readSession('thread_missing'), null);
  await assert.rejects(
    runtime.startTurn('thread_missing', { text: 'hi' }),
    /Unknown session: thread_missing/u,
  );
});

test('runtime emits normalized turn and approval events and maps approval decisions', async () => {
  const responded: Array<{ requestId: string; option: 1 | 2 | 3 }> = [];
  const approvalRequest: ProviderApprovalRequest = {
    requestId: 'approval_1',
    kind: 'command',
    threadId: 'thread_1',
    turnId: 'turn_1',
    itemId: 'item_1',
    reason: 'needs shell',
    command: 'npm test',
    cwd: '/workspace',
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  };
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async ({
      onTurnStarted,
      onProgress,
      onApprovalRequest,
    }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_1', threadId: 'thread_1' });
      await onProgress?.({ text: 'Hello', delta: 'He', outputKind: 'commentary' });
      await onApprovalRequest?.(approvalRequest);
      return {
        outputText: 'Final answer',
        status: 'completed',
        turnId: 'turn_1',
        threadId: 'thread_1',
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async ({ requestId, option }) => {
      responded.push({ requestId, option });
    },
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const started = await runtime.startTurn('thread_1', { text: 'hi' });
  assert.equal(started.turnId, 'turn_1');

  await new Promise((resolve) => setTimeout(resolve, 0));
  const events = runtime.getTurnEvents('turn_1').map((entry) => entry.event.type);
  assert.deepEqual(events, [
    'turn.started',
    'assistant.delta',
    'batch.started',
    'batch.updated',
    'approval.requested',
    'assistant.final',
    'turn.completed',
  ]);

  await runtime.resolveApproval('approval_1', 'accept_for_session');
  assert.deepEqual(responded, [{ requestId: 'approval_1', option: 2 }]);
  const resolvedTypes = runtime.getTurnEvents('turn_1').slice(-2).map((entry) => entry.event.type);
  assert.deepEqual(resolvedTypes, ['approval.resolved', 'batch.completed']);
});

test('runtime preserves raw turn failure details for UI display', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_429', threadId: 'thread_1' });
      const error = new Error('Codex request failed');
      (error as Error & { details?: string }).details = '429 Too Many Requests: model rate limit reached';
      throw error;
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const started = await runtime.startTurn('thread_1', { text: 'hi' });
  assert.equal(started.turnId, 'turn_429');

  await new Promise((resolve) => setTimeout(resolve, 0));
  const failed = runtime.getTurnEvents('turn_429').map((entry) => entry.event).find((event) => event.type === 'turn.failed');
  assert.equal(failed?.type, 'turn.failed');
  assert.equal((failed as any).message, 'Codex request failed');
  assert.equal((failed as any).details, '429 Too Many Requests: model rate limit reached');
});

test('runtime logs terminal turn diagnostics for failed native turns', async () => {
  const logs: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_403', threadId: 'thread_1' });
      throw new Error('unexpected status 403 Forbidden: invalid key');
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    logger: {
      debug: (message) => {
        logs.push(message);
      },
    },
  });

  const started = await runtime.startTurn('thread_1', { text: 'hi' });
  assert.equal(started.turnId, 'turn_403');

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(logs.join('\n'), /\[codex-web-runtime\] turn_error/u);
  assert.match(logs.join('\n'), /unexpected status 403 Forbidden/u);
  assert.match(logs.join('\n'), /\[codex-web-runtime\] event_append/u);
  assert.match(logs.join('\n'), /turn\.failed/u);
});

test('runtime uses completed turn id when start callback is missing', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async (): Promise<ProviderTurnResult> => ({
      outputText: 'Final answer',
      status: 'completed',
      turnId: 'turn_late',
      threadId: 'thread_1',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const started = await runtime.startTurn('thread_1', { text: 'hi' });
  assert.equal(started.turnId, 'turn_late');

  await new Promise((resolve) => setTimeout(resolve, 0));
  const events = runtime.getTurnEvents('turn_late').map((entry) => entry.event.type);
  assert.deepEqual(events, [
    'turn.started',
    'assistant.final',
    'turn.completed',
  ]);
});

test('runtime emits command and file work events from native work callbacks', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async ({
      onTurnStarted,
      onWorkEvent,
    }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_1', threadId: 'thread_1' });
      await onWorkEvent?.({
        type: 'started',
        itemId: 'cmd_1',
        kind: 'command',
        title: 'npm test',
        summary: {
          command: 'npm test',
          cwd: '/workspace',
        },
        raw: { method: 'item/started' },
      });
      await onWorkEvent?.({
        type: 'updated',
        itemId: 'cmd_1',
        kind: 'command',
        summary: {
          output: '42 passing',
          exitCode: 0,
        },
        raw: { method: 'item/completed' },
      });
      await onWorkEvent?.({
        type: 'started',
        itemId: 'edit_1',
        kind: 'file_change',
        title: 'Edited packages/codex-web/public/app.js',
        summary: {
          fileChanges: [{ path: 'packages/codex-web/public/app.js', action: 'modified' }],
        },
        raw: { method: 'item/started' },
      });
      await onWorkEvent?.({
        type: 'completed',
        itemId: 'edit_1',
        kind: 'file_change',
        status: 'completed',
        raw: { method: 'item/completed' },
      });
      return {
        outputText: 'Final answer',
        status: 'completed',
        turnId: 'turn_1',
        threadId: 'thread_1',
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const started = await runtime.startTurn('thread_1', { text: 'hi' });
  assert.equal(started.turnId, 'turn_1');

  await new Promise((resolve) => setTimeout(resolve, 0));
  const events = runtime.getTurnEvents('turn_1').map((entry) => entry.event);

  assert.deepEqual(events.map((event) => event.type), [
    'turn.started',
    'batch.started',
    'batch.updated',
    'batch.updated',
    'batch.started',
    'batch.updated',
    'batch.updated',
    'batch.completed',
    'assistant.final',
    'turn.completed',
  ]);
  assert.equal((events[1] as any).title, 'npm test');
  assert.deepEqual((events[2] as any).summary, {
    command: 'npm test',
    cwd: '/workspace',
  });
  assert.deepEqual((events[3] as any).summary, {
    command: 'npm test',
    cwd: '/workspace',
    output: '42 passing',
    exitCode: 0,
  });
  assert.deepEqual((events[5] as any).summary.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.deepEqual((events[6] as any).summary.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
});

test('runtime forwards work events extracted from native polled turn items', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async ({
      onTurnStarted,
      onWorkEvent,
    }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_1', threadId: 'thread_1' });
      await onWorkEvent?.({
        type: 'started',
        itemId: 'call_patch_1',
        kind: 'file_change',
        title: 'Edited packages/codex-web/public/app.js',
        summary: {
          fileChanges: [{ path: 'packages/codex-web/public/app.js', action: 'modified' }],
          diff: '*** Begin Patch\n*** Update File: packages/codex-web/public/app.js\n@@\n-old\n+new\n*** End Patch',
        },
        raw: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          call_id: 'call_patch_1',
        },
      });
      await onWorkEvent?.({
        type: 'completed',
        itemId: 'call_patch_1',
        kind: 'file_change',
        status: 'completed',
        summary: {
          output: 'Success. Updated the following files:\nM packages/codex-web/public/app.js',
        },
        raw: {
          type: 'custom_tool_call_output',
          call_id: 'call_patch_1',
        },
      });
      return {
        outputText: 'Final answer',
        status: 'completed',
        turnId: 'turn_1',
        threadId: 'thread_1',
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  const started = await runtime.startTurn('thread_1', { text: 'hi' });
  assert.equal(started.turnId, 'turn_1');

  await new Promise((resolve) => setTimeout(resolve, 0));
  const events = runtime.getTurnEvents('turn_1').map((entry) => entry.event);

  assert.deepEqual(events.map((event) => event.type), [
    'turn.started',
    'batch.started',
    'batch.updated',
    'batch.updated',
    'batch.completed',
    'assistant.final',
    'turn.completed',
  ]);
  assert.equal((events[1] as any).kind, 'file_change');
  assert.deepEqual((events[2] as any).summary.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String((events[2] as any).summary.diff), /Update File: packages\/codex-web\/public\/app\.js/u);
  assert.match(String((events[3] as any).summary.output), /Success/u);
  assert.deepEqual((events[3] as any).raw, {
    type: 'custom_tool_call_output',
    call_id: 'call_patch_1',
  });
});

test('runtime publishes live work update summaries to subscribers', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread()], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_1', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread(),
    writeConfigValue: async () => {},
    startTurn: async ({
      onTurnStarted,
      onWorkEvent,
    }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_1', threadId: 'thread_1' });
      await onWorkEvent?.({
        type: 'started',
        itemId: 'cmd_live',
        kind: 'command',
        title: 'rg TODO',
        summary: {
          command: 'rg TODO',
          cwd: '/workspace',
        },
      });
      await onWorkEvent?.({
        type: 'updated',
        itemId: 'cmd_live',
        kind: 'command',
        summary: {
          output: 'src/app.ts:12: TODO',
        },
      });
      await onWorkEvent?.({
        type: 'completed',
        itemId: 'cmd_live',
        kind: 'command',
        status: 'completed',
        summary: {
          exitCode: 0,
        },
      });
      return {
        outputText: 'Final answer',
        status: 'completed',
        turnId: 'turn_1',
        threadId: 'thread_1',
      };
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };
  const eventBus = new CodexWebEventBus();
  const published: string[] = [];
  eventBus.subscribe('turn_1', (entry) => {
    if (entry.event.type === 'batch.updated') {
      published.push(JSON.stringify(entry.event.summary));
    }
  });
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus,
  });

  await runtime.startTurn('thread_1', { text: 'hi' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(published, [
    JSON.stringify({ command: 'rg TODO', cwd: '/workspace' }),
    JSON.stringify({ command: 'rg TODO', cwd: '/workspace', output: 'src/app.ts:12: TODO' }),
    JSON.stringify({ command: 'rg TODO', cwd: '/workspace', output: 'src/app.ts:12: TODO', exitCode: 0 }),
  ]);
});
