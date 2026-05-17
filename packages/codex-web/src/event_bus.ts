import type { CodexWebEvent } from './event_model.js';

export interface CodexWebStoredEvent {
  event: CodexWebEvent;
  sequence: number;
}

export type CodexWebEventListener = (storedEvent: CodexWebStoredEvent) => void;

export class CodexWebEventBus {
  private readonly maxEventsPerTurn: number;

  private readonly turns = new Map<string, CodexWebStoredEvent[]>();

  private readonly listeners = new Map<string, Set<CodexWebEventListener>>();

  private nextSequence = 1;

  constructor({ maxEventsPerTurn = 500 }: { maxEventsPerTurn?: number } = {}) {
    this.maxEventsPerTurn = maxEventsPerTurn;
  }

  append(turnId: string, event: CodexWebEvent): CodexWebStoredEvent {
    const storedEvent: CodexWebStoredEvent = {
      event,
      sequence: this.nextSequence++,
    };
    const history = this.turns.get(turnId) ?? [];
    history.push(storedEvent);
    if (history.length > this.maxEventsPerTurn) {
      history.splice(0, history.length - this.maxEventsPerTurn);
    }
    this.turns.set(turnId, history);
    const turnListeners = this.listeners.get(turnId);
    if (turnListeners) {
      for (const listener of turnListeners) {
        listener(storedEvent);
      }
    }
    return storedEvent;
  }

  list(turnId: string, afterId?: string | number | null): CodexWebStoredEvent[] {
    const history = this.turns.get(turnId) ?? [];
    if (afterId === undefined || afterId === null || afterId === '') {
      return [...history];
    }
    const normalizedAfter = typeof afterId === 'number' ? afterId : Number(afterId);
    if (!Number.isFinite(normalizedAfter)) {
      return [...history];
    }
    return history.filter((entry) => entry.sequence > normalizedAfter);
  }

  subscribe(turnId: string, listener: CodexWebEventListener): () => void {
    const turnListeners = this.listeners.get(turnId) ?? new Set<CodexWebEventListener>();
    turnListeners.add(listener);
    this.listeners.set(turnId, turnListeners);
    return () => {
      const listeners = this.listeners.get(turnId);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(turnId);
      }
    };
  }
}
