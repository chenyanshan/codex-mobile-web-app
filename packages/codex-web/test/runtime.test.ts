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

  const reloaded = new CodexWebRuntime({
    codexBin: 'codex',
    defaultCwd: '/workspace',
    client,
    eventBus: new CodexWebEventBus(),
    settingsStore,
  });
  const listed = await reloaded.listSessions();
  assert.equal(listed[0]?.favorite, true);

  const unfavorited = await reloaded.updateSessionFavorite('thread_favorite', false);
  assert.equal(unfavorited?.favorite, false);
  assert.equal(storedSettings.favorite, false);
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
