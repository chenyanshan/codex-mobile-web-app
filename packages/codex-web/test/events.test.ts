import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeApprovalEvent,
  normalizeProgressEvent,
  normalizeTurnCompletedEvent,
  normalizeTurnFailedEvent,
} from '../src/event_model.js';

test('progress normalization emits assistant delta events with raw payload preserved', () => {
  const event = normalizeProgressEvent({
    turnId: 'turn_1',
    threadId: 'thread_1',
    progress: {
      text: 'Hello',
      delta: 'lo',
      outputKind: 'final_answer',
    },
  });

  assert.deepEqual(event, {
    id: event.id,
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    text: 'lo',
    phase: 'final_answer',
    raw: {
      text: 'Hello',
      delta: 'lo',
      outputKind: 'final_answer',
    },
  });
});

test('approval normalization emits approval request summary', () => {
  const event = normalizeApprovalEvent({
    turnId: 'turn_2',
    request: {
      requestId: 'approval_1',
      kind: 'command',
      threadId: 'thread_2',
      turnId: 'turn_2',
      itemId: 'item_1',
      reason: 'needs shell',
      command: 'npm test',
      cwd: '/workspace',
      availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
    },
  });

  assert.equal(event.type, 'approval.requested');
  assert.equal(event.approvalId, 'approval_1');
  assert.equal(event.approvalKind, 'command');
  assert.deepEqual(event.summary, {
    reason: 'needs shell',
    command: 'npm test',
    cwd: '/workspace',
    fileChanges: [],
    grantRoot: null,
    networkPermission: null,
    fileReadPermissions: [],
    fileWritePermissions: [],
    availableDecisionKeys: ['accept', 'acceptForSession', 'decline'],
  });
});

test('turn completion uses provider status and final text', () => {
  const events = normalizeTurnCompletedEvent({
    turnId: 'turn_3',
    threadId: 'thread_3',
    result: {
      outputText: 'Final answer',
      status: 'completed',
      threadId: 'thread_3',
      turnId: 'turn_3',
    },
  });

  assert.equal(events[0].type, 'assistant.final');
  assert.equal(events[0].text, 'Final answer');
  assert.equal(events[1].type, 'turn.completed');
  assert.equal(events[1].status, 'completed');
});

test('turn completion with provider error emits only a failed event', () => {
  const events = normalizeTurnCompletedEvent({
    turnId: 'turn_error',
    threadId: 'thread_error',
    result: {
      outputText: '',
      errorMessage: '429 Too Many Requests: model rate limit reached',
      status: 'failed',
      threadId: 'thread_error',
      turnId: 'turn_error',
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'turn.failed');
  assert.equal(events[0].message, '429 Too Many Requests: model rate limit reached');
  assert.equal(events[0].details, '429 Too Many Requests: model rate limit reached');
});

test('turn failure normalization does not expose local stack traces to frontend events', () => {
  const error = new Error('unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}');
  error.stack = [
    error.message,
    '    at CodexAppClient.waitForTurnResult (/Users/test/project/packages/codex-native-api/src/codex_app_client.ts:1674:17)',
  ].join('\n');

  const event = normalizeTurnFailedEvent({
    turnId: 'turn_forbidden',
    threadId: 'thread_forbidden',
    error,
  });

  assert.equal(event.type, 'turn.failed');
  assert.equal(event.message, 'unexpected status 403 Forbidden: {"code":"FORBIDDEN","message":"Forbidden"}');
  assert.equal(event.details, null);
  assert.doesNotMatch(JSON.stringify(event), /\/Users\/test\/project/u);
  assert.doesNotMatch(JSON.stringify(event), /codex_app_client\.ts/u);
});
