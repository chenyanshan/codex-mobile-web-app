import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeApprovalEvent, normalizeProgressEvent, normalizeTurnCompletedEvent } from '../src/event_model.js';

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
