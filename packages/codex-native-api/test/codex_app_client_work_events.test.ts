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
