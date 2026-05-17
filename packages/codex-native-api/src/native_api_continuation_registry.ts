import type { CodexNativeSession } from './native_api_types.js';

export interface CodexNativeApiContinuationEntry {
  responseId: string;
  previousResponseId: string | null;
  providerProfileId: string;
  bridgeSession: CodexNativeSession;
  nativeThreadId: string;
  nativeTurnId: string | null;
  activeAccountId: string | null;
  model: string | null;
  routeKind: string;
  startedAt: number;
  lastUsedAt: number;
  expiryAt: number;
}

export interface CodexNativeApiContinuationLookupResult {
  status: 'found' | 'missing' | 'expired';
  entry: CodexNativeApiContinuationEntry | null;
}

export interface CodexNativeApiContinuationRegistryDescriptor {
  kind: string;
  persistence: 'in_process' | 'persistent';
  ttlMs: number | null;
}

export interface CodexNativeApiContinuationRegistry {
  describe(): CodexNativeApiContinuationRegistryDescriptor;
  lookup(responseId: string): CodexNativeApiContinuationLookupResult;
  store(entry: Omit<CodexNativeApiContinuationEntry, 'bridgeSession' | 'startedAt' | 'lastUsedAt' | 'expiryAt'> & {
    bridgeSession: CodexNativeSession;
    startedAt?: number;
    lastUsedAt?: number;
    expiryAt?: number;
  }): CodexNativeApiContinuationEntry;
  touch(responseId: string): CodexNativeApiContinuationLookupResult;
  delete(responseId: string): boolean;
  pruneExpired(): number;
}

const DEFAULT_CONTINUATION_TTL_MS = 30 * 60 * 1000;

export class InMemoryCodexNativeApiContinuationRegistry implements CodexNativeApiContinuationRegistry {
  private readonly entries = new Map<string, CodexNativeApiContinuationEntry>();

  private readonly now: () => number;

  private readonly ttlMs: number;

  constructor({
    now = () => Date.now(),
    ttlMs = DEFAULT_CONTINUATION_TTL_MS,
  }: {
    now?: () => number;
    ttlMs?: number;
  } = {}) {
    this.now = now;
    this.ttlMs = Number.isFinite(ttlMs) && Number(ttlMs) > 0
      ? Number(ttlMs)
      : DEFAULT_CONTINUATION_TTL_MS;
  }

  describe(): CodexNativeApiContinuationRegistryDescriptor {
    return {
      kind: 'in_memory',
      persistence: 'in_process',
      ttlMs: this.ttlMs,
    };
  }

  lookup(responseId: string): CodexNativeApiContinuationLookupResult {
    const key = normalizeKey(responseId);
    if (!key) {
      return { status: 'missing', entry: null };
    }
    const entry = this.entries.get(key) ?? null;
    if (!entry) {
      this.pruneExpired();
      return { status: 'missing', entry: null };
    }
    if (entry.expiryAt <= this.now()) {
      this.entries.delete(key);
      return { status: 'expired', entry: null };
    }
    return {
      status: 'found',
      entry: cloneEntry(entry),
    };
  }

  store(entry: Omit<CodexNativeApiContinuationEntry, 'bridgeSession' | 'startedAt' | 'lastUsedAt' | 'expiryAt'> & {
    bridgeSession: CodexNativeSession;
    startedAt?: number;
    lastUsedAt?: number;
    expiryAt?: number;
  }): CodexNativeApiContinuationEntry {
    this.pruneExpired();
    const responseId = normalizeKey(entry.responseId);
    if (!responseId) {
      throw new Error('Continuation registry entries require a responseId.');
    }
    const now = this.now();
    const stored: CodexNativeApiContinuationEntry = {
      responseId,
      previousResponseId: normalizeNullableString(entry.previousResponseId),
      providerProfileId: normalizeKey(entry.providerProfileId),
      bridgeSession: cloneSession(entry.bridgeSession),
      nativeThreadId: normalizeKey(entry.nativeThreadId),
      nativeTurnId: normalizeNullableString(entry.nativeTurnId),
      activeAccountId: normalizeNullableString(entry.activeAccountId),
      model: normalizeNullableString(entry.model),
      routeKind: normalizeKey(entry.routeKind),
      startedAt: Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : now,
      lastUsedAt: Number.isFinite(entry.lastUsedAt) ? Number(entry.lastUsedAt) : now,
      expiryAt: Number.isFinite(entry.expiryAt) ? Number(entry.expiryAt) : now + this.ttlMs,
    };
    this.entries.set(responseId, stored);
    return cloneEntry(stored);
  }

  touch(responseId: string): CodexNativeApiContinuationLookupResult {
    const key = normalizeKey(responseId);
    if (!key) {
      return { status: 'missing', entry: null };
    }
    const entry = this.entries.get(key) ?? null;
    if (!entry) {
      this.pruneExpired();
      return { status: 'missing', entry: null };
    }
    if (entry.expiryAt <= this.now()) {
      this.entries.delete(key);
      return { status: 'expired', entry: null };
    }
    const now = this.now();
    entry.lastUsedAt = now;
    entry.expiryAt = now + this.ttlMs;
    this.entries.set(key, entry);
    return {
      status: 'found',
      entry: cloneEntry(entry),
    };
  }

  delete(responseId: string): boolean {
    return this.entries.delete(normalizeKey(responseId));
  }

  pruneExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [responseId, entry] of this.entries.entries()) {
      if (entry.expiryAt <= now) {
        this.entries.delete(responseId);
        removed += 1;
      }
    }
    return removed;
  }
}

function cloneEntry(entry: CodexNativeApiContinuationEntry): CodexNativeApiContinuationEntry {
  return {
    ...entry,
    bridgeSession: cloneSession(entry.bridgeSession),
  };
}

function cloneSession(session: CodexNativeSession): CodexNativeSession {
  return {
    ...session,
  };
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeKey(value);
  return normalized || null;
}
