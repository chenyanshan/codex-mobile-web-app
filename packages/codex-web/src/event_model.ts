import crypto from 'node:crypto';
import type {
  ProviderApprovalRequest,
  ProviderTurnProgress,
  ProviderTurnResult,
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
  | { id: string; type: 'turn.failed'; turnId: string; threadId: string | null; message: string; raw?: unknown };

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
  return {
    id: createEventId(),
    type: 'turn.failed',
    turnId,
    threadId,
    message: error instanceof Error ? error.message : String(error),
    raw: error,
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
