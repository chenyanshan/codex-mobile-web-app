import {
  CodexAppClient,
  formatConfigKeyPath,
  type ProviderApprovalRequest,
  type ProviderModelInfo,
  type ProviderThreadListResult,
  type ProviderThreadStartResult,
  type ProviderThreadSummary,
  type ProviderTurnResult,
  type ProviderTurnSessionSettings,
  type ProviderUsageReport,
} from '@codex-mobile-web-app/codex-native-api';
import { CodexWebEventBus } from './event_bus.js';
import {
  createBatchCompletedEvent,
  normalizeApprovalBatchEvent,
  normalizeApprovalBatchUpdatedEvent,
  normalizeApprovalEvent,
  normalizeApprovalResolvedEvent,
  normalizeProgressEvent,
  normalizeTurnCompletedEvent,
  normalizeTurnFailedEvent,
  normalizeTurnStartedEvent,
  type CodexWebEvent,
} from './event_model.js';

export interface CodexWebSession {
  id: string;
  cwd: string | null;
  title: string | null;
  updatedAt: number | null;
  preview: string | null;
  settings: ProviderTurnSessionSettings;
  thread: ProviderThreadSummary;
}

export interface CodexWebRuntimeClient {
  listModels(): Promise<ProviderModelInfo[]>;
  readUsage(): Promise<ProviderUsageReport | null>;
  listThreads(args?: {
    limit?: number;
    cursor?: string | null;
    searchTerm?: string | null;
    archived?: boolean | null;
  }): Promise<ProviderThreadListResult>;
  startThread(args?: {
    cwd?: string | null;
    title?: string | null;
    model?: string | null;
    serviceTier?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    ephemeral?: boolean | null;
  }): Promise<ProviderThreadStartResult>;
  readThread(threadId: string, includeTurns?: boolean): Promise<ProviderThreadSummary | null>;
  writeConfigValue(args: {
    keyPath: string;
    value: unknown;
    mergeStrategy?: 'replace' | 'upsert';
    filePath?: string | null;
    expectedVersion?: string | null;
  }): Promise<void>;
  startTurn(args: {
    threadId: string;
    inputText: string;
    cwd?: string | null;
    model?: string | null;
    effort?: string | null;
    serviceTier?: string | null;
    personality?: string | null;
    sandboxMode?: string;
    approvalPolicy?: string;
    collaborationMode?: string;
    developerInstructions?: string;
    onProgress?: ((progress: any) => Promise<void> | void) | null;
    onTurnStarted?: ((meta: Record<string, unknown>) => Promise<void> | void) | null;
    onApprovalRequest?: ((request: ProviderApprovalRequest) => Promise<void> | void) | null;
    timeoutMs?: number;
  }): Promise<ProviderTurnResult>;
  interruptTurn(args: { threadId: string; turnId: string }): Promise<void>;
  respondToApproval(args: { requestId: string; option: 1 | 2 | 3 }): Promise<void>;
}

export interface CodexWebRuntimeOptions {
  codexBin: string;
  defaultCwd: string;
  client?: CodexWebRuntimeClient;
  eventBus?: CodexWebEventBus;
}

export interface CreateSessionInput {
  cwd?: string | null;
  title?: string | null;
  settings?: Partial<ProviderTurnSessionSettings>;
}

export interface UpdateSessionSettingsInput {
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  collaborationMode?: 'plan' | 'default' | null;
  personality?: 'friendly' | 'pragmatic' | 'none' | null;
  accessPreset?: 'read-only' | 'default' | 'full-access' | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
  locale?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StartTurnInput {
  text: string;
  settings?: Partial<ProviderTurnSessionSettings>;
}

export class CodexWebRuntime {
  readonly client: CodexWebRuntimeClient;

  readonly eventBus: CodexWebEventBus;

  private readonly defaultCwd: string;

  private readonly sessionSettings = new Map<string, ProviderTurnSessionSettings>();

  private readonly turnToThread = new Map<string, string>();

  private readonly approvalToTurn = new Map<string, string>();

  private readonly approvalToBatch = new Map<string, string>();

  private readonly activeTurns = new Map<string, Promise<ProviderTurnResult>>();

  constructor({
    codexBin,
    defaultCwd,
    client = new CodexAppClient({ codexCliBin: codexBin }),
    eventBus = new CodexWebEventBus(),
  }: CodexWebRuntimeOptions) {
    this.client = client;
    this.eventBus = eventBus;
    this.defaultCwd = defaultCwd;
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    return this.client.listModels();
  }

  async readUsage(): Promise<ProviderUsageReport | null> {
    if (typeof this.client.readUsage !== 'function') {
      return null;
    }
    return this.client.readUsage();
  }

  async listSessions(): Promise<CodexWebSession[]> {
    const result = await this.client.listThreads({ limit: 100, archived: false });
    const sessions: CodexWebSession[] = [];
    for (const thread of result.items) {
      const verified = await this.readThreadSummary(thread.threadId);
      if (verified) {
        sessions.push(this.toSession(verified));
      }
    }
    return sessions;
  }

  async createSession(input: CreateSessionInput = {}): Promise<CodexWebSession> {
    const initialSettings = this.mergeSettings(null, input.settings);
    const started = await this.client.startThread({
      cwd: input.cwd ?? this.defaultCwd,
      title: input.title ?? null,
      model: initialSettings.model,
      serviceTier: initialSettings.serviceTier,
      sandboxMode: initialSettings.sandboxMode ?? 'workspace-write',
      approvalPolicy: initialSettings.approvalPolicy ?? 'on-request',
      ephemeral: false,
    });
    const thread = await this.requireThread(started.threadId);
    this.sessionSettings.set(started.threadId, {
      ...initialSettings,
      bridgeSessionId: started.threadId,
      updatedAt: Date.now(),
    });
    return this.toSession(thread);
  }

  async readSession(sessionId: string): Promise<CodexWebSession | null> {
    const thread = await this.readThreadSummary(sessionId);
    if (!thread) {
      return null;
    }
    return this.toSession(thread);
  }

  async updateSessionSettings(
    sessionId: string,
    patch: UpdateSessionSettingsInput,
  ): Promise<CodexWebSession | null> {
    const thread = await this.readThreadSummary(sessionId);
    if (!thread) {
      return null;
    }
    const nextSettings = this.mergeSettings(sessionId, patch);
    this.sessionSettings.set(sessionId, nextSettings);
    const metadata = nextSettings.metadata ?? {};
    await this.client.writeConfigValue({
      keyPath: formatConfigKeyPath(['profiles', sessionId]),
      value: {
        model: nextSettings.model,
        reasoningEffort: nextSettings.reasoningEffort,
        serviceTier: nextSettings.serviceTier,
        collaborationMode: nextSettings.collaborationMode,
        personality: nextSettings.personality,
        accessPreset: nextSettings.accessPreset,
        approvalPolicy: nextSettings.approvalPolicy,
        sandboxMode: nextSettings.sandboxMode,
        locale: nextSettings.locale,
        metadata,
      },
    });
    return this.toSession(thread);
  }

  async startTurn(sessionId: string, input: StartTurnInput): Promise<{ turnId: string }> {
    const session = await this.readSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const settings = this.mergeSettings(sessionId, input.settings);
    let startedTurnId = '';
    let resolveStarted: ((value: { turnId: string }) => void) | null = null;
    let rejectStarted: ((reason?: unknown) => void) | null = null;
    const startedPromise = new Promise<{ turnId: string }>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    const runPromise = this.client.startTurn({
      threadId: sessionId,
      inputText: input.text,
      cwd: session.cwd ?? this.defaultCwd,
      model: settings.model,
      effort: settings.reasoningEffort,
      serviceTier: settings.serviceTier,
      personality: settings.personality ?? null,
      sandboxMode: settings.sandboxMode ?? 'workspace-write',
      approvalPolicy: settings.approvalPolicy ?? 'on-request',
      collaborationMode: settings.collaborationMode ?? 'default',
      onTurnStarted: async (meta) => {
        const turnId = String(meta.turnId ?? '');
        if (!turnId) {
          return;
        }
        startedTurnId = turnId;
        this.turnToThread.set(turnId, sessionId);
        this.append(turnId, normalizeTurnStartedEvent({
          turnId,
          threadId: sessionId,
          raw: meta,
        }));
        resolveStarted?.({ turnId });
      },
      onProgress: async (progress) => {
        if (!startedTurnId) {
          return;
        }
        this.append(startedTurnId, normalizeProgressEvent({
          turnId: startedTurnId,
          threadId: sessionId,
          progress,
        }));
      },
      onApprovalRequest: async (request) => {
        const turnId = request.turnId ?? startedTurnId;
        if (!turnId) {
          return;
        }
        this.turnToThread.set(turnId, sessionId);
        this.approvalToTurn.set(request.requestId, turnId);
        this.approvalToBatch.set(request.requestId, request.itemId || request.requestId);
        const batchStart = normalizeApprovalBatchEvent({ turnId, request });
        this.append(turnId, batchStart);
        this.append(turnId, normalizeApprovalBatchUpdatedEvent({ turnId, request }));
        this.append(turnId, normalizeApprovalEvent({ turnId, request }));
      },
    }).then((result) => {
      if (!startedTurnId) {
        throw new Error('Turn started without turn id');
      }
      for (const event of normalizeTurnCompletedEvent({
        turnId: startedTurnId,
        threadId: sessionId,
        result,
      })) {
        this.append(startedTurnId, event);
      }
      this.activeTurns.delete(startedTurnId);
      return result;
    }).catch((error: unknown) => {
      if (!startedTurnId) {
        rejectStarted?.(error);
      }
      const turnId = startedTurnId || `turn_failed_${sessionId}`;
      this.append(turnId, normalizeTurnFailedEvent({
        turnId,
        threadId: sessionId,
        error,
      }));
      this.activeTurns.delete(turnId);
      throw error;
    });
    runPromise.catch(() => {});
    if (startedTurnId) {
      this.activeTurns.set(startedTurnId, runPromise);
    } else {
      startedPromise.then(({ turnId }) => {
        this.activeTurns.set(turnId, runPromise);
      }).catch(() => {});
    }
    return startedPromise;
  }

  async interruptTurn(turnId: string): Promise<void> {
    const sessionId = this.turnToThread.get(turnId);
    if (!sessionId) {
      throw new Error(`Unknown turn: ${turnId}`);
    }
    await this.client.interruptTurn({ threadId: sessionId, turnId });
  }

  async resolveApproval(
    approvalId: string,
    decision: 'accept' | 'accept_for_session' | 'deny',
  ): Promise<void> {
    const turnId = this.approvalToTurn.get(approvalId);
    if (!turnId) {
      throw new Error(`Unknown approval: ${approvalId}`);
    }
    const option = mapApprovalDecision(decision);
    await this.client.respondToApproval({ requestId: approvalId, option });
    this.append(turnId, normalizeApprovalResolvedEvent({
      turnId,
      approvalId,
      decision: mapResolvedDecision(decision),
    }));
    this.append(turnId, createBatchCompletedEvent({
      turnId,
      batchId: this.approvalToBatch.get(approvalId) ?? approvalId,
      status: mapResolvedDecision(decision),
    }));
    this.approvalToTurn.delete(approvalId);
    this.approvalToBatch.delete(approvalId);
  }

  getTurnEvents(turnId: string, afterId?: string | number | null) {
    return this.eventBus.list(turnId, afterId);
  }

  subscribeToTurn(turnId: string, listener: (entry: { event: CodexWebEvent; sequence: number }) => void) {
    return this.eventBus.subscribe(turnId, listener);
  }

  private append(turnId: string, event: CodexWebEvent): void {
    this.eventBus.append(turnId, event);
  }

  private async requireThread(threadId: string): Promise<ProviderThreadSummary> {
    const thread = await this.readThreadSummary(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    return thread;
  }

  private async readThreadSummary(threadId: string): Promise<ProviderThreadSummary | null> {
    try {
      return await this.client.readThread(threadId, true);
    } catch (error) {
      if (isMissingThreadError(error)) {
        return null;
      }
      if (!isIncludeTurnsRetryableError(error)) {
        throw error;
      }
      return this.client.readThread(threadId, false);
    }
  }

  private toSession(thread: ProviderThreadSummary): CodexWebSession {
    const current = this.sessionSettings.get(thread.threadId) ?? createDefaultSettings(thread.threadId);
    this.sessionSettings.set(thread.threadId, current);
    return {
      id: thread.threadId,
      cwd: thread.cwd,
      title: thread.title,
      updatedAt: thread.updatedAt ?? null,
      preview: thread.preview ?? null,
      settings: current,
      thread,
    };
  }

  private mergeSettings(
    sessionId: string | null,
    patch: Partial<ProviderTurnSessionSettings> | UpdateSessionSettingsInput | undefined,
  ): ProviderTurnSessionSettings {
    const current = sessionId
      ? this.sessionSettings.get(sessionId) ?? createDefaultSettings(sessionId)
      : createDefaultSettings('pending');
    const metadata = patch?.metadata && typeof patch.metadata === 'object'
      ? patch.metadata
      : current.metadata;
    return {
      ...current,
      ...patch,
      bridgeSessionId: sessionId ?? current.bridgeSessionId,
      metadata,
      updatedAt: Date.now(),
    };
  }

  private findOpenApprovals(turnId: string): string[] {
    const approvalIds: string[] = [];
    for (const [approvalId, mappedTurnId] of this.approvalToTurn.entries()) {
      if (mappedTurnId === turnId) {
        approvalIds.push(approvalId);
      }
    }
    return approvalIds;
  }
}

function createDefaultSettings(sessionId: string): ProviderTurnSessionSettings {
  return {
    bridgeSessionId: sessionId,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    locale: null,
    metadata: {},
    updatedAt: Date.now(),
  };
}

function mapApprovalDecision(decision: 'accept' | 'accept_for_session' | 'deny'): 1 | 2 | 3 {
  switch (decision) {
    case 'accept':
      return 1;
    case 'accept_for_session':
      return 2;
    case 'deny':
      return 3;
  }
}

function mapResolvedDecision(
  decision: 'accept' | 'accept_for_session' | 'deny',
): 'accepted' | 'accepted_for_session' | 'denied' {
  switch (decision) {
    case 'accept':
      return 'accepted';
    case 'accept_for_session':
      return 'accepted_for_session';
    case 'deny':
      return 'denied';
  }
}

function isIncludeTurnsRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /includeTurns is unavailable before first user message/i.test(message)
    || /ephemeral threads do not support includeTurns/i.test(message)
    || /not materialized yet/i.test(message)
    || /empty session file/i.test(message);
}

export function isMissingThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /thread not found/i.test(message)
    || /session not found/i.test(message)
    || /unknown thread/i.test(message);
}
