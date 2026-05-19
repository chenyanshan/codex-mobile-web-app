import test from 'node:test';
import assert from 'node:assert/strict';

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
