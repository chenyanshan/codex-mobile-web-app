import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CodexAppClient,
  type ProviderTurnWorkEvent,
} from '../src/index.js';

test('app client extracts work details from function call notifications', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];
  let emitted = false;

  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'function_call',
            call_id: 'call_exec_1',
            name: 'exec_command',
            arguments: JSON.stringify({
              cmd: 'sed -n "1,80p" packages/codex-web/public/app.js',
              workdir: '/workspace',
            }),
          },
        },
      });
      client.emit('notification', {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'function_call_output',
            call_id: 'call_exec_1',
            output: 'const TOKEN_KEY = "codexWebToken";',
          },
        },
      });
      client.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          item: {
            type: 'function_call',
            call_id: 'call_patch_1',
            name: 'apply_patch',
            arguments: [
              '*** Begin Patch',
              '*** Update File: packages/codex-web/public/app.js',
              '@@',
              '-old',
              '+new',
              '*** End Patch',
            ].join('\n'),
          },
        },
      });
    }
    return {
      threadId: 'thread_1',
      turns: [{
        id: 'turn_1',
        status: 'completed',
        items: [{
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Done',
        }],
      }],
    } as any;
  };

  await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_1',
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.equal(workEvents[0]?.itemId, 'call_exec_1');
  assert.equal(workEvents[0]?.kind, 'command');
  assert.equal(workEvents[0]?.summary?.command, 'sed -n "1,80p" packages/codex-web/public/app.js');
  assert.equal(workEvents[0]?.summary?.cwd, '/workspace');
  assert.equal(workEvents[1]?.itemId, 'call_exec_1');
  assert.equal(workEvents[1]?.summary?.output, 'const TOKEN_KEY = "codexWebToken";');
  assert.equal(workEvents[2]?.itemId, 'call_patch_1');
  assert.equal(workEvents[2]?.kind, 'file_change');
  assert.deepEqual(workEvents[2]?.summary?.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String(workEvents[2]?.summary?.diff), /Update File: packages\/codex-web\/public\/app\.js/u);
});

test('app client extracts work details from polled turn items when notifications are unavailable', async () => {
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];

  client.readThread = async () => ({
    threadId: 'thread_1',
    turns: [{
      id: 'turn_1',
      status: 'completed',
      items: [{
        type: 'function_call',
        call_id: 'call_exec_1',
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: 'sed -n "1,80p" packages/codex-web/public/app.js',
          workdir: '/workspace',
        }),
      }, {
        type: 'function_call_output',
        call_id: 'call_exec_1',
        output: 'const TOKEN_KEY = "codexWebToken";',
      }, {
        type: 'custom_tool_call',
        call_id: 'call_patch_1',
        name: 'apply_patch',
        input: [
          '*** Begin Patch',
          '*** Update File: packages/codex-web/public/app.js',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      }, {
        type: 'custom_tool_call_output',
        call_id: 'call_patch_1',
        output: 'Success. Updated the following files:\nM packages/codex-web/public/app.js',
      }, {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Done',
      }],
    }],
  } as any);

  await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_1',
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.equal(workEvents[0]?.type, 'started');
  assert.equal(workEvents[0]?.itemId, 'call_exec_1');
  assert.equal(workEvents[0]?.kind, 'command');
  assert.equal(workEvents[0]?.summary?.command, 'sed -n "1,80p" packages/codex-web/public/app.js');
  assert.equal(workEvents[0]?.summary?.cwd, '/workspace');
  assert.equal(workEvents[1]?.type, 'completed');
  assert.equal(workEvents[1]?.itemId, 'call_exec_1');
  assert.equal(workEvents[1]?.summary?.output, 'const TOKEN_KEY = "codexWebToken";');
  assert.equal(workEvents[2]?.type, 'started');
  assert.equal(workEvents[2]?.itemId, 'call_patch_1');
  assert.equal(workEvents[2]?.kind, 'file_change');
  assert.deepEqual(workEvents[2]?.summary?.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String(workEvents[2]?.summary?.diff), /Update File: packages\/codex-web\/public\/app\.js/u);
  assert.equal(workEvents[3]?.type, 'completed');
  assert.equal(workEvents[3]?.itemId, 'call_patch_1');
  assert.match(String(workEvents[3]?.summary?.output), /Success/u);
});

test('app client extracts work details from session jsonl response items when turn snapshots omit tools', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-work-jsonl-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  const turnId = 'turn_jsonl_1';
  fs.writeFileSync(sessionPath, [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'call_exec_1',
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: 'rg "Activity details" packages/codex-web/public/app.js',
          workdir: '/workspace',
        }),
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_exec_1',
        output: 'packages/codex-web/public/app.js:Activity details',
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'call_patch_1',
        name: 'apply_patch',
        input: [
          '*** Begin Patch',
          '*** Update File: packages/codex-web/public/app.js',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call_patch_1',
        output: 'Success. Updated the following files:\nM packages/codex-web/public/app.js',
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: turnId,
        last_agent_message: 'Done',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollSleep: async () => {},
  });
  const workEvents: ProviderTurnWorkEvent[] = [];

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: sessionPath,
    turns: [{
      id: turnId,
      status: 'completed',
      items: [{
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Done',
      }],
    }],
  } as any);

  await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId,
    timeoutMs: 1000,
    onWorkEvent: (event) => {
      workEvents.push(event);
    },
  });

  assert.deepEqual(workEvents.map((event) => `${event.type}:${event.itemId}:${event.kind}`), [
    'started:call_exec_1:command',
    'completed:call_exec_1:command',
    'started:call_patch_1:file_change',
    'completed:call_patch_1:file_change',
  ]);
  assert.equal(workEvents[0]?.summary?.command, 'rg "Activity details" packages/codex-web/public/app.js');
  assert.equal(workEvents[1]?.summary?.output, 'packages/codex-web/public/app.js:Activity details');
  assert.deepEqual(workEvents[2]?.summary?.fileChanges, [
    { path: 'packages/codex-web/public/app.js', action: 'modified' },
  ]);
  assert.match(String(workEvents[3]?.summary?.output), /Success/u);
});

test('app client fails open turns from session jsonl runtime errors without task complete', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-runtime-error-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  const turnId = 'turn_invalid_key';
  const message = 'unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"Invalid API key"}, url: https://allinai7.cloud/v1/responses, request id: a12befc6-4026-4e7b-94dc-7e184daca4e4';
  fs.writeFileSync(sessionPath, [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'error',
        message,
        codex_error_info: 'other',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: sessionPath,
    turns: [{
      id: turnId,
      status: 'running',
      items: [],
    }],
  } as any);

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId,
      timeoutMs: 1000,
    }),
    /INVALID_API_KEY/u,
  );
});

test('app client fails open turns from generic session failed events', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-native-api-generic-runtime-error-'));
  const sessionPath = path.join(sessionDir, 'rollout.jsonl');
  const turnId = 'turn_generic_failure';
  fs.writeFileSync(sessionPath, [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'model_request_failed',
        error: 'upstream provider returned a non-retryable failure',
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: sessionPath,
    turns: [{
      id: turnId,
      status: 'running',
      items: [],
    }],
  } as any);

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId,
      timeoutMs: 1000,
    }),
    /upstream provider returned a non-retryable failure/u,
  );
});

test('app client fails turns from matching Codex error notifications before completed snapshots', async () => {
  const message = 'unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}';
  let now = 0;
  let emitted = false;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    if (!emitted) {
      emitted = true;
      client.emit('notification', {
        method: 'error',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_notification_error',
          error: {
            message,
          },
        },
      });
    }
    return {
      threadId: 'thread_1',
      path: null,
      turns: [{
        id: 'turn_notification_error',
        status: 'completed',
        items: [{
          type: 'message',
          role: 'assistant',
          text: '',
        }],
      }],
    } as any;
  };

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId: 'turn_notification_error',
      timeoutMs: 1000,
    }),
    /403 Forbidden/u,
  );
});

test('app client ignores transient reconnecting error notifications while turn is still running', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    readCount += 1;
    if (readCount === 1) {
      client.emit('notification', {
        method: 'error',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_reconnect',
          message: 'Reconnecting... 1/5',
        },
      });
    }
    return {
      threadId: 'thread_1',
      path: null,
      turns: [{
        id: 'turn_reconnect',
        status: readCount < 2 ? 'inProgress' : 'completed',
        items: readCount < 2
          ? []
          : [{
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            text: 'Recovered after reconnect.',
          }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_reconnect',
    timeoutMs: 3000,
  });

  assert.equal(result.outputText, 'Recovered after reconnect.');
});

test('app client retries transient rollout materialization read errors after turn starts', async () => {
  let now = 0;
  let readCount = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });

  client.readThread = async () => {
    readCount += 1;
    if (readCount === 1) {
      throw new Error(
        'failed to read thread: thread-store internal error: failed to read thread '
        + '/Users/test/.codex/sessions/rollout.jsonl: rollout at '
        + '/Users/test/.codex/sessions/rollout.jsonl is empty',
      );
    }
    return {
      threadId: 'thread_1',
      path: null,
      turns: [{
        id: 'turn_materializing',
        status: 'completed',
        items: [{
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          text: 'Recovered after materialization.',
        }],
      }],
    } as any;
  };

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_materializing',
    timeoutMs: 3000,
  });

  assert.equal(readCount, 2);
  assert.equal(result.outputText, 'Recovered after materialization.');
});

test('app client fails open turns from Codex stderr runtime errors', async () => {
  const message = 'unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}, url: https://allinai7.cloud/v1/responses, request id: req_forbidden';
  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });
  (client as any).childStderrSequence += 1;
  (client as any).childStderrTail.push({
    sequence: (client as any).childStderrSequence,
    text: `■ ${message}`,
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: null,
    turns: [{
      id: 'turn_stderr_failure',
      status: 'running',
      items: [],
    }],
  } as any);

  await assert.rejects(
    client.waitForTurnResult({
      threadId: 'thread_1',
      turnId: 'turn_stderr_failure',
      timeoutMs: 1000,
    }),
    /403 Forbidden/u,
  );
});

test('app client ignores stderr runtime errors emitted before a turn wait starts', async () => {
  let now = 0;
  const client = new CodexAppClient({
    codexCliBin: 'codex',
    turnPollNow: () => now,
    turnPollSleep: async (ms) => {
      now += ms;
    },
  });
  (client as any).childStderrSequence += 1;
  (client as any).childStderrTail.push({
    sequence: (client as any).childStderrSequence,
    text: 'unexpected status 403 Forbidden from an earlier turn',
  });

  client.readThread = async () => ({
    threadId: 'thread_1',
    path: null,
    turns: [{
      id: 'turn_after_stderr',
      status: 'completed',
      items: [{
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        text: 'Recovered',
      }],
    }],
  } as any);

  const result = await client.waitForTurnResult({
    threadId: 'thread_1',
    turnId: 'turn_after_stderr',
    timeoutMs: 1000,
    stderrBaseline: 1,
  } as any);

  assert.equal(result.outputText, 'Recovered');
});
