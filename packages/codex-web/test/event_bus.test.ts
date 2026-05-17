import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexWebEventBus } from '../src/event_bus.js';

test('event bus appends, replays after sequence, and notifies subscribers', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 10 });
  const seen: number[] = [];
  const unsubscribe = bus.subscribe('turn_1', (entry) => {
    seen.push(entry.sequence);
  });

  const first = bus.append('turn_1', {
    id: 'evt_1',
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'thread_1',
  });
  const second = bus.append('turn_1', {
    id: 'evt_2',
    type: 'assistant.delta',
    turnId: 'turn_1',
    threadId: 'thread_1',
    text: 'hi',
    phase: null,
  });

  assert.deepEqual(seen, [first.sequence, second.sequence]);
  assert.equal(bus.list('turn_1').length, 2);
  assert.deepEqual(bus.list('turn_1', first.sequence).map((entry) => entry.event.id), ['evt_2']);

  unsubscribe();
  bus.append('turn_1', {
    id: 'evt_3',
    type: 'assistant.final',
    turnId: 'turn_1',
    threadId: 'thread_1',
    text: 'done',
  });
  assert.deepEqual(seen, [first.sequence, second.sequence]);
});

test('event bus keeps bounded history per turn', () => {
  const bus = new CodexWebEventBus({ maxEventsPerTurn: 2 });
  bus.append('turn_1', { id: 'evt_1', type: 'turn.started', turnId: 'turn_1', threadId: 'thread_1' });
  bus.append('turn_1', { id: 'evt_2', type: 'assistant.delta', turnId: 'turn_1', threadId: 'thread_1', text: 'a', phase: null });
  bus.append('turn_1', { id: 'evt_3', type: 'assistant.final', turnId: 'turn_1', threadId: 'thread_1', text: 'b' });

  assert.deepEqual(bus.list('turn_1').map((entry) => entry.event.id), ['evt_2', 'evt_3']);
});
