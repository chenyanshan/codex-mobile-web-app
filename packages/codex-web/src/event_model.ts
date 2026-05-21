import crypto from 'node:crypto';
import type {
  ProviderApprovalRequest,
  ProviderTurnProgress,
  ProviderTurnResult,
  ProviderTurnWorkEvent,
} from '@codex-mobile-web-app/codex-native-api';

export type CodexWebEvent =
  | { id: string; type: 'turn.started'; turnId: string; threadId: string; raw?: unknown }
  | { id: string; type: 'assistant.delta'; turnId: string; threadId: string; text: string; phase: string | null; raw?: unknown }
  | { id: string; type: 'assistant.final'; turnId: string; threadId: string; text: string; raw?: unknown }
  | { id: string; type: 'batch.started'; turnId: string; batchId: string; kind: 'command' | 'file_change' | 'permission' | 'unknown'; title: string; raw?: unknown }
  | { id: string; type: 'batch.updated'; turnId: string; batchId: string; summary: Record<string, unknown>; raw?: unknown }
  | { id: string; type: 'batch.completed'; turnId: string; batchId: string; status: string; raw?: unknown }
  | { id: string; type: 'approval.requested'; turnId: string; approvalId: string; approvalKind: string; summary: Record<string, unknown>; raw?: unknown }
  | { id: string; type: 'approval.resolved'; turnId: string; approvalId: string; decision: 'accepted' | 'accepted_for_session' | 'denied'; raw?: unknown }
  | { id: string; type: 'turn.completed'; turnId: string; threadId: string; status: string; raw?: unknown }
  | { id: string; type: 'turn.failed'; turnId: string; threadId: string | null; message: string; details?: string | null; raw?: unknown };

export function normalizeTurnStartedEvent({
  turnId,
  threadId,
  raw = null,
}: {
  turnId: string;
  threadId: string;
  raw?: unknown;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'turn.started',
    turnId,
    threadId,
    raw,
  };
}

export function normalizeProgressEvent({
  turnId,
  threadId,
  progress,
}: {
  turnId: string;
  threadId: string;
  progress: ProviderTurnProgress;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'assistant.delta',
    turnId,
    threadId,
    text: progress.delta || progress.text || '',
    phase: progress.outputKind || null,
    raw: progress,
  };
}

export function normalizeWorkBatchEvents({
  turnId,
  event,
}: {
  turnId: string;
  event: ProviderTurnWorkEvent;
}): CodexWebEvent[] {
  const events: CodexWebEvent[] = [];
  const summary = sanitizeWorkSummary(event.summary ?? {});
  if (event.type === 'started') {
    events.push({
      id: createEventId(),
      type: 'batch.started',
      turnId,
      batchId: event.itemId,
      kind: event.kind,
      title: event.title || workTitleFromEvent(event, summary),
      raw: event.raw ?? event,
    });
    if (Object.keys(summary).length > 0) {
      events.push(createBatchUpdatedEvent({
        turnId,
        batchId: event.itemId,
        summary,
        raw: event.raw ?? event,
      }));
    }
    return events;
  }
  if (Object.keys(summary).length > 0) {
    events.push(createBatchUpdatedEvent({
      turnId,
      batchId: event.itemId,
      summary,
      raw: event.raw ?? event,
    }));
  }
  if (event.type === 'completed') {
    events.push(createBatchCompletedEvent({
      turnId,
      batchId: event.itemId,
      status: event.status || 'completed',
      raw: event.raw ?? event,
    }));
  }
  return events;
}

export function normalizeApprovalEvent({
  turnId,
  request,
}: {
  turnId: string;
  request: ProviderApprovalRequest;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'approval.requested',
    turnId,
    approvalId: request.requestId,
    approvalKind: request.kind,
    summary: approvalSummary(request),
    raw: request,
  };
}

function sanitizeWorkSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(summary);
  if (entries.every(([, value]) => hasWorkSummaryValue(value))) {
    return summary;
  }
  return Object.fromEntries(entries.filter(([, value]) => hasWorkSummaryValue(value)));
}

function hasWorkSummaryValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function workTitleFromEvent(
  event: ProviderTurnWorkEvent,
  summary: Record<string, unknown>,
): string {
  if (event.kind === 'command' && typeof summary.command === 'string') {
    return summary.command;
  }
  if (event.kind === 'file_change') {
    const changes = Array.isArray(summary.fileChanges) ? summary.fileChanges : [];
    if (changes.length === 1 && typeof (changes[0] as any)?.path === 'string') {
      return `Edited ${(changes[0] as any).path}`;
    }
    if (changes.length > 1) {
      return `Edited ${changes.length} files`;
    }
  }
  return 'Tool activity';
}

export function normalizeApprovalBatchEvent({
  turnId,
  request,
}: {
  turnId: string;
  request: ProviderApprovalRequest;
}): CodexWebEvent {
  const kind = request.kind === 'permissions' ? 'permission' : request.kind;
  const title = request.command
    || (request.kind === 'file_change' ? `${request.fileChanges?.length ?? 0} file changes` : request.reason)
    || request.kind;
  return {
    id: createEventId(),
    type: 'batch.started',
    turnId,
    batchId: request.itemId || request.requestId,
    kind,
    title,
    raw: request,
  };
}

export function normalizeApprovalBatchUpdatedEvent({
  turnId,
  request,
}: {
  turnId: string;
  request: ProviderApprovalRequest;
}): CodexWebEvent {
  return createBatchUpdatedEvent({
    turnId,
    batchId: request.itemId || request.requestId,
    summary: approvalSummary(request),
    raw: request,
  });
}

export function createBatchUpdatedEvent({
  turnId,
  batchId,
  summary,
  raw = null,
}: {
  turnId: string;
  batchId: string;
  summary: Record<string, unknown>;
  raw?: unknown;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'batch.updated',
    turnId,
    batchId,
    summary,
    raw,
  };
}

export function createBatchCompletedEvent({
  turnId,
  batchId,
  status,
  raw = null,
}: {
  turnId: string;
  batchId: string;
  status: string;
  raw?: unknown;
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'batch.completed',
    turnId,
    batchId,
    status,
    raw,
  };
}

export function normalizeApprovalResolvedEvent({
  turnId,
  approvalId,
  decision,
}: {
  turnId: string;
  approvalId: string;
  decision: 'accepted' | 'accepted_for_session' | 'denied';
}): CodexWebEvent {
  return {
    id: createEventId(),
    type: 'approval.resolved',
    turnId,
    approvalId,
    decision,
  };
}

export function normalizeTurnCompletedEvent({
  turnId,
  threadId,
  result,
}: {
  turnId: string;
  threadId: string;
  result: Partial<ProviderTurnResult>;
}): CodexWebEvent[] {
  const events: CodexWebEvent[] = [];
  const errorDetails = extractErrorDetails(result);
  if (errorDetails) {
    events.push({
      id: createEventId(),
      type: 'turn.failed',
      turnId,
      threadId,
      message: errorDetails,
      details: errorDetails,
    });
    return events;
  }
  const text = String(result.outputText || result.previewText || '').trim();
  if (text) {
    events.push({
      id: createEventId(),
      type: 'assistant.final',
      turnId,
      threadId,
      text,
      raw: result,
    });
  }
  events.push({
    id: createEventId(),
    type: 'turn.completed',
    turnId,
    threadId,
    status: String(result.status || 'completed'),
    raw: result,
  });
  return events;
}

export function normalizeTurnFailedEvent({
  turnId,
  threadId = null,
  error,
}: {
  turnId: string;
  threadId?: string | null;
  error: unknown;
}): CodexWebEvent {
  const message = error instanceof Error ? error.message : String(error);
  const details = extractErrorDetails(error);
  return {
    id: createEventId(),
    type: 'turn.failed',
    turnId,
    threadId,
    message,
    details: details && details !== message ? details : null,
  };
}

export function createEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

function approvalSummary(request: ProviderApprovalRequest): Record<string, unknown> {
  return {
    reason: request.reason ?? null,
    command: request.command ?? null,
    cwd: request.cwd ?? null,
    fileChanges: request.fileChanges ?? [],
    grantRoot: request.grantRoot ?? null,
    networkPermission: request.networkPermission ?? null,
    fileReadPermissions: request.fileReadPermissions ?? [],
    fileWritePermissions: request.fileWritePermissions ?? [],
    availableDecisionKeys: request.availableDecisionKeys ?? [],
  };
}

function extractErrorDetails(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  return normalizeDetailText(record.details)
    ?? normalizeDetailText(record.rawMessage)
    ?? normalizeDetailText(record.errorMessage)
    ?? normalizeDetailText(record.stderr)
    ?? null;
}

function normalizeDetailText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
