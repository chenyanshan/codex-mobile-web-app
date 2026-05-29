import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProviderApprovalRequest,
  ProviderThreadListResult,
  ProviderThreadGoal,
  ProviderThreadStartResult,
  ProviderThreadSummary,
  ProviderTurnResult,
  ProviderUsageReport,
} from '../../codex-native-api/src/index.js';
import { CodexWebEventBus } from '../src/event_bus.js';
import { CodexWebRuntime, type CodexWebRuntimeClient } from '../src/runtime.js';
import { FileSessionTimelineStore } from '../src/session_timeline_store.js';

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

test('runtime handles goal slash commands without starting a native turn', async () => {
  let currentGoal: ProviderThreadGoal | null = null;
  let startTurnCalls = 0;
  const setCalls: Array<{
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }> = [];
  let clearCalls = 0;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_goal')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_goal', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_goal'),
    writeConfigValue: async () => {},
    getThreadGoal: async () => currentGoal,
    setThreadGoal: async ({ threadId, objective = null, status = null, suppressAutoTurn = false }) => {
      setCalls.push({ threadId, objective, status, suppressAutoTurn });
      currentGoal = {
        threadId,
        objective: objective ?? currentGoal?.objective ?? '',
        status: status ?? currentGoal?.status ?? 'active',
        tokenBudget: null,
        tokensUsed: null,
        timeUsedSeconds: null,
      };
      return currentGoal;
    },
    clearThreadGoal: async () => {
      clearCalls += 1;
      currentGoal = null;
      return true;
    },
    startTurn: async (): Promise<ProviderTurnResult> => {
      startTurnCalls += 1;
      return {
        outputText: 'should not run',
        status: 'completed',
        turnId: 'turn_unexpected',
        threadId: 'thread_goal',
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

  const created = await runtime.startTurn('thread_goal', { text: '/goal improve benchmark coverage' });
  assert.equal((created as any).type, 'command');
  assert.equal((created as any).command.name, 'goal');
  assert.match((created as any).command.message, /Goal set/u);
  assert.equal((created as any).command.goal.objective, 'improve benchmark coverage');

  const paused = await runtime.startTurn('thread_goal', { text: '/goal pause' });
  assert.equal((paused as any).command.goal.status, 'paused');

  const resumed = await runtime.startTurn('thread_goal', { text: '/goal resume' });
  assert.equal((resumed as any).command.goal.status, 'active');

  const reported = await runtime.startTurn('thread_goal', { text: '/goal' });
  assert.match((reported as any).command.message, /improve benchmark coverage/u);

  const cleared = await runtime.startTurn('thread_goal', { text: '/goal clear' });
  assert.equal((cleared as any).command.goal, null);
  assert.match((cleared as any).command.message, /Goal cleared/u);

  assert.equal(startTurnCalls, 0);
  assert.equal(clearCalls, 1);
  assert.deepEqual(setCalls, [
    {
      threadId: 'thread_goal',
      objective: 'improve benchmark coverage',
      status: null,
      suppressAutoTurn: true,
    },
    {
      threadId: 'thread_goal',
      objective: null,
      status: 'paused',
      suppressAutoTurn: true,
    },
    {
      threadId: 'thread_goal',
      objective: null,
      status: 'active',
      suppressAutoTurn: true,
    },
  ]);
});

test('runtime handles help slash command without starting a native turn', async () => {
  let startTurnCalls = 0;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_help')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_help', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_help'),
    writeConfigValue: async () => {},
    startTurn: async (): Promise<ProviderTurnResult> => {
      startTurnCalls += 1;
      return {
        outputText: 'should not run',
        status: 'completed',
        turnId: 'turn_unexpected',
        threadId: 'thread_help',
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
    helpReportPath: '/tmp/codex-web-state/reports/codex-mobile-web-app/2026-05-22/codex-web-help.md',
  });

  const result = await runtime.startTurn('thread_help', { text: '/help' });

  assert.equal((result as any).type, 'command');
  assert.equal((result as any).command.name, 'help');
  assert.equal((result as any).command.action, 'show');
  assert.match((result as any).command.message, /支持的命令/u);
  assert.match((result as any).command.message, /\/goal <objective>/u);
  assert.match((result as any).command.message, /\/goal set <objective>/u);
  assert.match((result as any).command.message, /\/goal edit <objective>/u);
  assert.match((result as any).command.message, /\/goal pause/u);
  assert.match((result as any).command.message, /\/goal resume/u);
  assert.match((result as any).command.message, /\/goal clear/u);
  assert.match((result as any).command.message, /\/goal/u);
  assert.match((result as any).command.message, /\/help/u);
  assert.match(
    (result as any).command.message,
    /\/tmp\/codex-web-state\/reports\/codex-mobile-web-app\/2026-05-22\/codex-web-help\.md/u,
  );
  assert.equal(startTurnCalls, 0);
});

test('runtime readSession exposes backend-managed slash command timeline entries', async () => {
  const timelinePath = `/tmp/codex-web-runtime-timeline-${process.pid}-${Date.now()}.json`;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_goal')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_goal', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_goal'),
      turns: [
        {
          id: 'turn_1',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Earlier question' },
            { type: 'message', role: 'assistant', phase: null, text: 'Earlier answer' },
          ],
        },
      ],
    }),
    resumeThread: async () => {},
    getThreadGoal: async () => ({
      threadId: 'thread_goal',
      objective: 'ship slash goal support',
      status: 'active',
    }),
    setThreadGoal: async () => ({
      threadId: 'thread_goal',
      objective: 'ship slash goal support',
      status: 'active',
    }),
    clearThreadGoal: async () => true,
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'should not run',
      status: 'completed',
      turnId: 'turn_unexpected',
      threadId: 'thread_goal',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    timelineStore: new FileSessionTimelineStore({ timelinePath }),
  });

  await runtime.startTurn('thread_goal', { text: '/goal resume' });
  const session = await runtime.readSession('thread_goal');

  assert.deepEqual(session?.timeline.map((item) => item.text), [
    'Earlier question',
    'Earlier answer',
    '/goal resume',
    'Goal resumed: ship slash goal support',
  ]);
});

test('runtime readSession exposes the current thread goal as session state', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_goal_state')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_goal_state', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_goal_state'),
    getThreadGoal: async () => ({
      threadId: 'thread_goal_state',
      objective: 'ship goal status indicator',
      status: 'paused',
      tokensUsed: 1200,
    }),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'done',
      status: 'completed',
      turnId: 'turn_1',
      threadId: 'thread_goal_state',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
  });

  const session = await runtime.readSession('thread_goal_state');

  assert.deepEqual(session?.goal, {
    threadId: 'thread_goal_state',
    objective: 'ship goal status indicator',
    status: 'paused',
    tokensUsed: 1200,
  });
});

test('runtime readSession exposes only process-active turn state', async () => {
  let resolveTurn: ((result: ProviderTurnResult) => void) | null = null;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_active_state')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_active_state', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_active_state'),
      turns: [
        {
          id: 'turn_active_state',
          status: 'in_progress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Still working' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_active_state', threadId: 'thread_active_state' });
      return new Promise<ProviderTurnResult>((resolve) => {
        resolveTurn = resolve;
      });
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

  assert.equal((await runtime.readSession('thread_active_state'))?.activeTurnId, null);
  const started = await runtime.startTurn('thread_active_state', { text: 'hi' });

  assert.deepEqual(started, { turnId: 'turn_active_state' });
  assert.equal((await runtime.readSession('thread_active_state'))?.activeTurnId, 'turn_active_state');

  resolveTurn?.({
    outputText: 'done',
    status: 'completed',
    turnId: 'turn_active_state',
    threadId: 'thread_active_state',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal((await runtime.readSession('thread_active_state'))?.activeTurnId, null);
});

test('runtime ignores stale historical active turns when starting a new non-command turn', async () => {
  let startTurnCalls = 0;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_busy')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_busy', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_busy'),
      turns: [
        {
          id: 'turn_existing_active_1',
          status: 'in_progress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Still working' },
          ],
        },
        {
          id: 'turn_existing_active_2',
          status: 'in_progress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Still also working' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }): Promise<ProviderTurnResult> => {
      startTurnCalls += 1;
      await onTurnStarted?.({ turnId: 'turn_new', threadId: 'thread_busy' });
      return {
        outputText: 'started',
        status: 'completed',
        turnId: 'turn_new',
        threadId: 'thread_busy',
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

  assert.deepEqual(await runtime.startTurn('thread_busy', { text: 'new question' }), { turnId: 'turn_new' });
  assert.equal(startTurnCalls, 1);
});

test('runtime rejects overlapping non-command turns that are active in this process', async () => {
  let resolveFirstTurn: ((result: ProviderTurnResult) => void) | null = null;
  let startTurnCalls = 0;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_busy')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_busy', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_busy'),
      turns: [
        {
          id: 'turn_process_active',
          status: 'in_progress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Still working' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }): Promise<ProviderTurnResult> => {
      startTurnCalls += 1;
      await onTurnStarted?.({ turnId: 'turn_process_active', threadId: 'thread_busy' });
      return new Promise<ProviderTurnResult>((resolve) => {
        resolveFirstTurn = resolve;
      });
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

  await runtime.startTurn('thread_busy', { text: 'first question' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(
    runtime.startTurn('thread_busy', { text: 'second question' }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error & { code?: string }).code, 'turn_conflict');
      assert.equal((error as Error & { activeTurnId?: string }).activeTurnId, 'turn_process_active');
      assert.match((error as Error).message, /already has an active turn/u);
      return true;
    },
  );

  resolveFirstTurn?.({
    outputText: 'done',
    status: 'completed',
    turnId: 'turn_process_active',
    threadId: 'thread_busy',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(startTurnCalls, 1);
});

test('runtime still allows slash commands while thread history shows an active turn', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_busy_command')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_busy_command', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_busy_command'),
      turns: [
        {
          id: 'turn_existing_active_1',
          status: 'in_progress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Still working' },
          ],
        },
        {
          id: 'turn_existing_active_2',
          status: 'in_progress',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Still also working' },
          ],
        },
      ],
    }),
    getThreadGoal: async () => ({
      threadId: 'thread_busy_command',
      objective: 'ship slash goal support',
      status: 'active',
    }),
    writeConfigValue: async () => {},
    startTurn: async (): Promise<ProviderTurnResult> => ({
      outputText: 'should not start',
      status: 'completed',
      turnId: 'turn_unexpected',
      threadId: 'thread_busy_command',
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

  const result = await runtime.startTurn('thread_busy_command', { text: '/goal' });

  assert.equal(result.type, 'command');
  assert.equal(result.command.name, 'goal');
  assert.match(result.command.message, /ship slash goal support/u);
});

test('runtime readSession exposes backend-managed turn failure timeline entries', async () => {
  const timelinePath = `/tmp/codex-web-runtime-timeline-${process.pid}-${Date.now()}-failed.json`;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_failed')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_failed', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_failed'),
      turns: [
        {
          id: 'turn_403',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Trigger auth failure' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_403', threadId: 'thread_failed' });
      throw new Error('unexpected status 403 Forbidden');
    },
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    timelineStore: new FileSessionTimelineStore({ timelinePath }),
  });

  const started = await runtime.startTurn('thread_failed', { text: 'Trigger auth failure' });
  assert.equal(started.turnId, 'turn_403');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const session = await runtime.readSession('thread_failed');
  assert.deepEqual(session?.timeline.map((item) => item.text), [
    'Trigger auth failure',
    'unexpected status 403 Forbidden',
  ]);
  const errorEntry = session?.timeline.find((item) => item.id === 'error_turn_403');
  assert.equal(errorEntry?.severity, 'error');
});

test('runtime upserts backend-managed session timeline entries by id', async () => {
  const timelinePath = `/tmp/codex-web-runtime-timeline-${process.pid}-${Date.now()}-upsert.json`;
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_timeline')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_timeline', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_timeline'),
      turns: [
        {
          id: 'turn_1',
          status: 'completed',
          error: null,
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Question' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'unused',
      status: 'completed',
      turnId: 'turn_unused',
      threadId: 'thread_timeline',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    timelineStore: new FileSessionTimelineStore({ timelinePath }),
  });

  const first = runtime.appendSessionTimelineEntry('thread_timeline', {
    id: 'error_turn_1',
    kind: 'message',
    role: 'system',
    label: 'Error',
    meta: 'failed',
    text: 'Load failed',
    severity: 'error',
  });
  const second = runtime.appendSessionTimelineEntry('thread_timeline', {
    id: 'error_turn_1',
    kind: 'message',
    role: 'system',
    label: 'Error',
    meta: 'failed',
    text: 'Load failed again',
    severity: 'error',
  });

  const session = await runtime.readSession('thread_timeline');

  assert.equal(first?.text, 'Load failed');
  assert.equal(second?.text, 'Load failed again');
  assert.deepEqual(session?.timeline.map((item) => item.text), [
    'Question',
    'Load failed again',
  ]);
});

test('runtime readSession deduplicates backend failure timeline entries already present in native thread history', async () => {
  const timelinePath = `/tmp/codex-web-runtime-timeline-${process.pid}-${Date.now()}-dedupe.json`;
  const timelineStore = new FileSessionTimelineStore({ timelinePath });
  timelineStore.append('thread_failed', {
    id: 'error_turn_403',
    kind: 'message',
    role: 'system',
    label: 'Error',
    meta: 'failed',
    text: 'unexpected status 403 Forbidden',
    severity: 'error',
  });

  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_failed')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_failed', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => ({
      ...createThread('thread_failed'),
      turns: [
        {
          id: 'turn_403',
          status: 'failed',
          error: 'unexpected status 403 Forbidden',
          items: [
            { type: 'message', role: 'user', phase: null, text: 'Trigger auth failure' },
          ],
        },
      ],
    }),
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'unused',
      status: 'completed',
      turnId: 'turn_unused',
      threadId: 'thread_failed',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    timelineStore,
  });

  const session = await runtime.readSession('thread_failed');
  assert.deepEqual(session?.timeline.map((item) => item.text), [
    'Trigger auth failure',
    'unexpected status 403 Forbidden',
  ]);
});

test('runtime archiveSession removes backend-managed session timeline entries', async () => {
  const timelinePath = `/tmp/codex-web-runtime-timeline-${process.pid}-${Date.now()}-archive.json`;
  const timelineStore = new FileSessionTimelineStore({ timelinePath });
  timelineStore.append('thread_archived', {
    id: 'command_goal_1',
    kind: 'message',
    role: 'system',
    label: '/goal',
    meta: 'show',
    text: 'Goal (active): ship slash goal support',
  });

  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_archived')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_archived', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_archived'),
    archiveThread: async () => {},
    writeConfigValue: async () => {},
    startTurn: async () => ({
      outputText: 'unused',
      status: 'completed',
      turnId: 'turn_unused',
      threadId: 'thread_archived',
    }),
    interruptTurn: async () => {},
    respondToApproval: async () => {},
  };

  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    timelineStore,
  });

  assert.deepEqual(timelineStore.list('thread_archived').map((item) => item.text), [
    'Goal (active): ship slash goal support',
  ]);
  assert.equal(await runtime.archiveSession('thread_archived'), true);
  assert.deepEqual(timelineStore.list('thread_archived'), []);
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

test('runtime exposes owning thread ids for active turns and approvals', async () => {
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_guard')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_guard', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_guard'),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted, onApprovalRequest }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_guard', threadId: 'thread_guard' });
      await onApprovalRequest?.({
        requestId: 'approval_guard',
        turnId: 'turn_guard',
        itemId: 'approval_item',
        kind: 'command',
        command: 'npm test',
        reason: 'test',
        summary: {},
      } as ProviderApprovalRequest);
      return {
        outputText: 'Final answer',
        status: 'completed',
        turnId: 'turn_guard',
        threadId: 'thread_guard',
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

  await runtime.startTurn('thread_guard', { text: 'hi' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtime.threadIdForTurn('turn_guard'), 'thread_guard');
  assert.equal(runtime.threadIdForApproval('approval_guard'), 'thread_guard');
  assert.equal(runtime.threadIdForTurn('missing_turn'), null);
  assert.equal(runtime.threadIdForApproval('missing_approval'), null);
});

test('runtime guarded interrupt and approval helpers reject mismatched threads', async () => {
  const calls: string[] = [];
  const client: CodexWebRuntimeClient = {
    listModels: async () => [],
    readUsage: async (): Promise<ProviderUsageReport | null> => null,
    listThreads: async () => ({ items: [createThread('thread_guard')], nextCursor: null }),
    startThread: async () => ({ threadId: 'thread_guard', cwd: '/workspace', title: 'Thread' }),
    readThread: async () => createThread('thread_guard'),
    writeConfigValue: async () => {},
    startTurn: async ({ onTurnStarted, onApprovalRequest }): Promise<ProviderTurnResult> => {
      await onTurnStarted?.({ turnId: 'turn_guard', threadId: 'thread_guard' });
      await onApprovalRequest?.({
        requestId: 'approval_guard',
        turnId: 'turn_guard',
        itemId: 'approval_item',
        kind: 'command',
        command: 'npm test',
        reason: 'test',
        summary: {},
      } as ProviderApprovalRequest);
      return {
        outputText: 'Final answer',
        status: 'completed',
        turnId: 'turn_guard',
        threadId: 'thread_guard',
      };
    },
    interruptTurn: async ({ threadId, turnId }) => {
      calls.push(`interrupt:${threadId}:${turnId}`);
    },
    respondToApproval: async ({ requestId, option }) => {
      calls.push(`approval:${requestId}:${option}`);
    },
  };
  const runtime = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
  });

  await runtime.startTurn('thread_guard', { text: 'hi' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await assert.rejects(
    runtime.interruptTurnForThread('thread_other', 'turn_guard'),
    /does not belong to thread/u,
  );
  await assert.rejects(
    runtime.resolveApprovalForThread('thread_other', 'approval_guard', 'accept'),
    /does not belong to thread/u,
  );

  await runtime.interruptTurnForThread('thread_guard', 'turn_guard');
  await runtime.resolveApprovalForThread('thread_guard', 'approval_guard', 'accept');

  assert.deepEqual(calls, [
    'interrupt:thread_guard:turn_guard',
    'approval:approval_guard:1',
  ]);
});
