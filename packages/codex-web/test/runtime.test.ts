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
  assert.equal(sessions[0]?.settings.approvalPolicy, 'on-request');

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
