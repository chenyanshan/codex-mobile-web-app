import crypto from 'node:crypto';
import {
  CodexAppClient,
  createStderrLogger,
  formatConfigKeyPath,
  type ProviderApprovalRequest,
  type ProviderModelInfo,
  type ProviderThreadGoal,
  type ProviderThreadListResult,
  type ProviderThreadStartResult,
  type ProviderThreadSummary,
  type ProviderThreadTurn,
  type ProviderThreadTurnItem,
  type ProviderTurnResult,
  type ProviderTurnSessionSettings,
  type ProviderTurnWorkEvent,
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
  normalizeWorkBatchEvents,
  type CodexWebEvent,
} from './event_model.js';
import type {
  CodexWebSessionSettingsStore,
  CodexWebStoredSessionSettings,
} from './session_settings_store.js';
import type {
  CodexWebSessionTimelineStore,
  CodexWebTimelineMessage,
} from './session_timeline_store.js';

interface CodexWebRuntimeLogger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface CodexWebSession {
  id: string;
  cwd: string | null;
  projectName: string | null;
  title: string | null;
  updatedAt: number | null;
  preview: string | null;
  firstUserInput: string | null;
  lastUserInput: string | null;
  lastInputAt: number | null;
  favorite: boolean;
  favoriteOrder: number | null;
  goal: ProviderThreadGoal | null;
  activeTurnId: string | null;
  settings: CodexWebStoredSessionSettings;
  thread: ProviderThreadSummary;
  timeline: CodexWebTimelineMessage[];
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
  resumeThread?(args: { threadId: string }): Promise<unknown>;
  getThreadGoal?(threadId: string): Promise<ProviderThreadGoal | null>;
  setThreadGoal?(args: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }): Promise<ProviderThreadGoal | null>;
  clearThreadGoal?(threadId: string): Promise<boolean>;
  archiveThread?(threadId: string): Promise<void>;
  writeConfigValue(args: {
    keyPath: string;
    value: unknown;
    mergeStrategy?: 'replace' | 'upsert';
    filePath?: string | null;
    expectedVersion?: string | null;
  }): Promise<void>;
  reloadMcpServers?(): Promise<void>;
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
    onWorkEvent?: ((event: ProviderTurnWorkEvent) => Promise<void> | void) | null;
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
  settingsStore?: CodexWebSessionSettingsStore;
  timelineStore?: CodexWebSessionTimelineStore;
  helpReportPath?: string | null;
  logger?: CodexWebRuntimeLogger;
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

export interface AppendSessionTimelineEntryInput {
  id?: string | null;
  role: 'user' | 'assistant' | 'system';
  label?: string | null;
  meta?: string | null;
  text: string;
  severity?: 'error' | null;
  afterHistoryIndex?: number | null;
}

export interface CodexWebCommandResult {
  type: 'command';
  command: {
    name: 'goal' | 'help';
    action: 'show' | 'set' | 'pause' | 'resume' | 'clear';
    message: string;
    goal: ProviderThreadGoal | null;
  };
  session?: CodexWebSession | null;
}

export type CodexWebStartTurnResult = { turnId: string } | CodexWebCommandResult;

interface CodexWebTurnConflictError extends Error {
  code: 'turn_conflict';
  activeTurnId: string;
}

export interface ListSessionsOptions {
  favorite?: boolean;
}

export class CodexWebRuntime {
  readonly client: CodexWebRuntimeClient;

  readonly eventBus: CodexWebEventBus;

  private readonly defaultCwd: string;

  private readonly settingsStore: CodexWebSessionSettingsStore | null;

  private readonly timelineStore: CodexWebSessionTimelineStore | null;

  private readonly sessionSettings = new Map<string, CodexWebStoredSessionSettings>();

  private readonly turnToThread = new Map<string, string>();

  private readonly approvalToTurn = new Map<string, string>();

  private readonly approvalToBatch = new Map<string, string>();

  private readonly activeTurns = new Map<string, Promise<ProviderTurnResult>>();

  private readonly workSummaries = new Map<string, Record<string, unknown>>();

  private readonly helpReportPath: string | null;

  private readonly logger: CodexWebRuntimeLogger;

  constructor({
    codexBin,
    defaultCwd,
    logger = createStderrLogger({ envVar: 'CODEX_WEB_DEBUG' }),
    client = new CodexAppClient({ codexCliBin: codexBin, logger }),
    eventBus = new CodexWebEventBus(),
    settingsStore,
    timelineStore,
    helpReportPath = null,
  }: CodexWebRuntimeOptions) {
    this.client = client;
    this.eventBus = eventBus;
    this.defaultCwd = defaultCwd;
    this.settingsStore = settingsStore ?? null;
    this.timelineStore = timelineStore ?? null;
    this.helpReportPath = helpReportPath;
    this.logger = logger;
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

  async listSessions(options: ListSessionsOptions = {}): Promise<CodexWebSession[]> {
    if (options.favorite === true) {
      return this.listFavoriteSessions();
    }
    const result = await this.client.listThreads({ limit: 100, archived: false });
    return result.items
      .filter((thread) => typeof thread.threadId === 'string' && thread.threadId)
      .map((thread) => this.toSession(thread));
  }

  private async listFavoriteSessions(): Promise<CodexWebSession[]> {
    const favoriteIds = this.favoriteSessionIds();
    if (!favoriteIds.length) {
      return [];
    }
    const threads = await Promise.all(favoriteIds.map((threadId) => this.readFavoriteThreadSummary(threadId)));
    const sessions = threads
      .filter((thread): thread is ProviderThreadSummary => Boolean(thread?.threadId))
      .map((thread) => this.toSession(thread));
    return sessions.sort((left, right) => (left.favoriteOrder ?? Number.MAX_SAFE_INTEGER) - (right.favoriteOrder ?? Number.MAX_SAFE_INTEGER)
      || (right.lastInputAt ?? 0) - (left.lastInputAt ?? 0));
  }

  private async readFavoriteThreadSummary(threadId: string): Promise<ProviderThreadSummary | null> {
    try {
      const thread = await this.client.readThread(threadId, false);
      if (thread) {
        return thread;
      }
    } catch (error) {
      if (!isUnavailableThreadError(error)) {
        throw error;
      }
    }
    if (typeof this.client.resumeThread !== 'function') {
      return null;
    }
    try {
      await this.client.resumeThread({ threadId });
    } catch (error) {
      if (isUnavailableThreadError(error)) {
        return null;
      }
      throw error;
    }
    try {
      return await this.client.readThread(threadId, false);
    } catch (error) {
      if (isUnavailableThreadError(error)) {
        return null;
      }
      throw error;
    }
  }

  async createSession(input: CreateSessionInput = {}): Promise<CodexWebSession> {
    const initialSettings = this.mergeSettings(null, input.settings);
    const started = await this.client.startThread({
      cwd: input.cwd ?? this.defaultCwd,
      title: input.title ?? null,
      model: initialSettings.model,
      serviceTier: initialSettings.serviceTier,
      sandboxMode: initialSettings.sandboxMode ?? 'danger-full-access',
      approvalPolicy: initialSettings.approvalPolicy ?? 'never',
      ephemeral: false,
    });
    const thread = await this.requireThread(started.threadId);
    this.persistSessionSettings(started.threadId, {
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
    return this.withThreadGoal(this.toSession(thread));
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
    this.persistSessionSettings(sessionId, nextSettings);
    await this.client.writeConfigValue({
      keyPath: formatConfigKeyPath(['profiles', sessionId]),
      value: omitNullTomlValues({
        model: nextSettings.model,
        reasoningEffort: nextSettings.reasoningEffort,
        serviceTier: nextSettings.serviceTier,
        collaborationMode: nextSettings.collaborationMode,
        personality: nextSettings.personality,
        accessPreset: nextSettings.accessPreset,
        approvalPolicy: nextSettings.approvalPolicy,
        sandboxMode: nextSettings.sandboxMode,
        locale: nextSettings.locale,
        metadata: nextSettings.metadata ?? {},
      }),
    });
    return this.toSession(thread);
  }

  async archiveSession(sessionId: string): Promise<boolean> {
    if (typeof this.client.archiveThread !== 'function') {
      throw new Error('Thread archive is not supported by this Codex runtime');
    }
    const current = this.getStoredSessionSettings(sessionId);
    let thread: ProviderThreadSummary | null = null;
    try {
      thread = await this.readThreadSummary(sessionId);
    } catch (error) {
      if (!isUnavailableThreadError(error)) {
        throw error;
      }
    }
    if (thread) {
      await this.client.archiveThread(sessionId);
    } else if (!current?.favorite) {
      return false;
    }
    this.sessionSettings.delete(sessionId);
    this.settingsStore?.delete(sessionId);
    this.timelineStore?.delete(sessionId);
    return true;
  }

  appendSessionTimelineEntry(
    sessionId: string,
    input: AppendSessionTimelineEntryInput,
  ): CodexWebTimelineMessage | null {
    const entry = normalizeSessionTimelineEntry(sessionId, input);
    if (!entry) {
      return null;
    }
    if (!this.timelineStore) {
      return publicSessionTimelineEntry(entry);
    }
    const existing = this.timelineStore.list(sessionId);
    const next = upsertSessionTimelineEntry(existing, entry);
    this.timelineStore.replace(sessionId, next);
    return publicSessionTimelineEntry(entry);
  }

  async updateSessionFavorite(
    sessionId: string,
    favorite: boolean,
    favoriteOrder?: number | null,
  ): Promise<CodexWebSession | null> {
    const current = this.getStoredSessionSettings(sessionId);
    if (favorite && current?.favorite === true && favoriteOrder !== undefined) {
      const settings = {
        ...current,
        favorite: true,
        favoriteOrder: favoriteOrder ?? current.favoriteOrder ?? this.nextFavoriteOrder(),
        updatedAt: Date.now(),
      };
      this.persistSessionSettings(sessionId, settings);
      return this.toStoredFavoriteSession(sessionId, settings);
    }
    if (!favorite && current?.favorite === true) {
      const settings = {
        ...current,
        favorite: false,
        favoriteOrder: null,
        updatedAt: Date.now(),
      };
      this.persistSessionSettings(sessionId, settings);
      let thread: ProviderThreadSummary | null = null;
      try {
        thread = await this.readThreadSummary(sessionId);
      } catch (error) {
        if (!isUnavailableThreadError(error)) {
          throw error;
        }
      }
      return thread ? this.toSession(thread) : null;
    }
    const thread = await this.readThreadSummary(sessionId);
    if (!thread) {
      return null;
    }
    const existing = this.getSessionSettings(sessionId);
    const settings = {
      ...existing,
      favorite,
      favoriteOrder: favorite ? favoriteOrder ?? existing.favoriteOrder ?? this.nextFavoriteOrder() : null,
      updatedAt: Date.now(),
    };
    this.persistSessionSettings(sessionId, settings);
    return this.toSession(thread);
  }

  async reloadRuntime(): Promise<{ mcpServersReloaded: boolean }> {
    if (typeof this.client.reloadMcpServers !== 'function') {
      return { mcpServersReloaded: false };
    }
    await this.client.reloadMcpServers();
    return { mcpServersReloaded: true };
  }

  async startTurn(sessionId: string, input: StartTurnInput): Promise<CodexWebStartTurnResult> {
    const session = await this.readSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const helpCommand = parseHelpSlashCommand(input.text);
    if (helpCommand) {
      await this.ensureThreadReadyForTurn(sessionId);
      const result = createHelpCommandResult(this.helpReportPath);
      this.appendCommandTimeline(sessionId, input.text, result.command, timelineMessagesFromThread(session.thread).length);
      return {
        ...result,
        session: await this.readSession(sessionId),
      };
    }
    const goalCommand = parseGoalSlashCommand(input.text);
    if (goalCommand) {
      await this.ensureThreadReadyForTurn(sessionId);
      const result = await this.handleGoalCommand(sessionId, goalCommand);
      this.appendCommandTimeline(sessionId, input.text, result.command, timelineMessagesFromThread(session.thread).length);
      return {
        ...result,
        session: await this.readSession(sessionId),
      };
    }
    const conflictingTurnId = this.conflictingActiveTurnId(session);
    if (conflictingTurnId) {
      throw createTurnConflictError(sessionId, conflictingTurnId);
    }
    const settings = this.mergeSettings(sessionId, input.settings);
    this.persistSessionSettings(sessionId, settings);
    await this.ensureThreadReadyForTurn(sessionId);
    this.logDebug('turn_start_requested', {
      sessionId,
      textLength: input.text.length,
      cwd: session.cwd ?? this.defaultCwd,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      serviceTier: settings.serviceTier,
      sandboxMode: settings.sandboxMode ?? 'danger-full-access',
      approvalPolicy: settings.approvalPolicy ?? 'never',
      collaborationMode: settings.collaborationMode ?? 'default',
    });
    let startedTurnId = '';
    let resolveStarted: ((value: { turnId: string }) => void) | null = null;
    let rejectStarted: ((reason?: unknown) => void) | null = null;
    const startedPromise = new Promise<{ turnId: string }>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    const markTurnStarted = (turnId: string, raw: unknown): boolean => {
      if (!turnId || startedTurnId) {
        return false;
      }
      startedTurnId = turnId;
      this.turnToThread.set(turnId, sessionId);
      this.append(turnId, normalizeTurnStartedEvent({
        turnId,
        threadId: sessionId,
        raw,
      }));
      this.logDebug('turn_started', {
        sessionId,
        turnId,
        raw: summarizeRuntimeValue(raw),
      });
      resolveStarted?.({ turnId });
      return true;
    };
    const runPromise = this.client.startTurn({
      threadId: sessionId,
      inputText: input.text,
      cwd: session.cwd ?? this.defaultCwd,
      model: settings.model,
      effort: settings.reasoningEffort,
      serviceTier: settings.serviceTier,
      personality: settings.personality ?? null,
      sandboxMode: settings.sandboxMode ?? 'danger-full-access',
      approvalPolicy: settings.approvalPolicy ?? 'never',
      collaborationMode: settings.collaborationMode ?? 'default',
      onTurnStarted: async (meta) => {
        const turnId = String(meta.turnId ?? '');
        markTurnStarted(turnId, meta);
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
      onWorkEvent: async (event) => {
        if (!startedTurnId) {
          return;
        }
        const existing = this.workSummaries.get(event.itemId) ?? {};
        Object.assign(existing, event.summary ?? {});
        this.workSummaries.set(event.itemId, existing);
        for (const normalized of normalizeWorkBatchEvents({
          turnId: startedTurnId,
          event: {
            ...event,
            summary: { ...existing },
          },
        })) {
          this.append(startedTurnId, normalized);
        }
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
      const resultTurnId = String(result.turnId ?? '');
      markTurnStarted(resultTurnId, result);
      if (!startedTurnId) {
        throw new Error('Turn started without turn id');
      }
      this.logDebug('turn_result', {
        sessionId,
        turnId: startedTurnId,
        result: summarizeRuntimeTurnResult(result),
      });
      const normalizedEvents = normalizeTurnCompletedEvent({
        turnId: startedTurnId,
        threadId: sessionId,
        result,
      });
      this.logDebug('turn_normalized_events', {
        sessionId,
        turnId: startedTurnId,
        events: normalizedEvents.map((event) => summarizeRuntimeEvent(event)),
      });
      for (const event of normalizedEvents) {
        this.append(startedTurnId, event);
      }
      return result;
    }).catch((error: unknown) => {
      if (!startedTurnId) {
        rejectStarted?.(error);
      }
      const turnId = startedTurnId || `turn_failed_${sessionId}`;
      this.logDebug('turn_error', {
        sessionId,
        turnId,
        error: summarizeRuntimeError(error),
      });
      const event = normalizeTurnFailedEvent({
        turnId,
        threadId: sessionId,
        error,
      });
      this.logDebug('turn_normalized_events', {
        sessionId,
        turnId,
        events: [summarizeRuntimeEvent(event)],
      });
      this.append(turnId, event);
      this.appendFailedTurnTimeline(sessionId, turnId, runtimeTurnErrorMessage({
        error: (error as Error | undefined)?.message ?? null,
        details: (error as Error & { details?: unknown } | undefined)?.details ?? null,
        items: [],
        message: error instanceof Error ? error.message : String(error || ''),
      }), timelineMessagesFromThread(session.thread).length);
      throw error;
    });
    runPromise.catch(() => {});
    startedPromise.then(({ turnId }) => {
      this.activeTurns.set(turnId, runPromise);
      runPromise.finally(() => {
        this.activeTurns.delete(turnId);
      }).catch(() => {});
    }).catch(() => {});
    return startedPromise;
  }

  private async handleGoalCommand(
    sessionId: string,
    command: ParsedGoalSlashCommand,
  ): Promise<CodexWebCommandResult> {
    if (command.action === 'show') {
      const goal = await this.requireGoalReader()(sessionId);
      return createGoalCommandResult({
        action: 'show',
        goal,
        message: formatGoalMessage(goal),
      });
    }
    if (command.action === 'clear') {
      await this.requireGoalClearer()(sessionId);
      return createGoalCommandResult({
        action: 'clear',
        goal: null,
        message: 'Goal cleared.',
      });
    }
    if (command.action === 'pause') {
      const goal = await this.requireGoalSetter()({
        threadId: sessionId,
        objective: null,
        status: 'paused',
        suppressAutoTurn: true,
      });
      return createGoalCommandResult({
        action: 'pause',
        goal,
        message: goal ? `Goal paused: ${goal.objective}` : 'Goal paused.',
      });
    }
    if (command.action === 'resume') {
      const goal = await this.requireGoalSetter()({
        threadId: sessionId,
        objective: null,
        status: 'active',
        suppressAutoTurn: true,
      });
      return createGoalCommandResult({
        action: 'resume',
        goal,
        message: goal ? `Goal resumed: ${goal.objective}` : 'Goal resumed.',
      });
    }
    const goal = await this.requireGoalSetter()({
      threadId: sessionId,
      objective: command.objective,
      status: null,
      suppressAutoTurn: true,
    });
    return createGoalCommandResult({
      action: 'set',
      goal,
      message: goal ? `Goal set: ${goal.objective}` : 'Goal set.',
    });
  }

  private requireGoalReader(): (threadId: string) => Promise<ProviderThreadGoal | null> {
    if (typeof this.client.getThreadGoal !== 'function') {
      throw new Error('Goal commands are not supported by this Codex runtime');
    }
    return this.client.getThreadGoal.bind(this.client);
  }

  private requireGoalSetter(): (args: {
    threadId: string;
    objective?: string | null;
    status?: string | null;
    suppressAutoTurn?: boolean;
  }) => Promise<ProviderThreadGoal | null> {
    if (typeof this.client.setThreadGoal !== 'function') {
      throw new Error('Goal commands are not supported by this Codex runtime');
    }
    return this.client.setThreadGoal.bind(this.client);
  }

  private requireGoalClearer(): (threadId: string) => Promise<boolean> {
    if (typeof this.client.clearThreadGoal !== 'function') {
      throw new Error('Goal commands are not supported by this Codex runtime');
    }
    return this.client.clearThreadGoal.bind(this.client);
  }

  async interruptTurn(turnId: string): Promise<void> {
    const sessionId = this.turnToThread.get(turnId);
    if (!sessionId) {
      throw new Error(`Unknown turn: ${turnId}`);
    }
    await this.client.interruptTurn({ threadId: sessionId, turnId });
  }

  threadIdForTurn(turnId: string): string | null {
    return this.turnToThread.get(turnId) ?? null;
  }

  threadIdForApproval(approvalId: string): string | null {
    const turnId = this.approvalToTurn.get(approvalId);
    return turnId ? this.threadIdForTurn(turnId) : null;
  }

  async interruptTurnForThread(threadId: string, turnId: string): Promise<void> {
    const ownerThreadId = this.threadIdForTurn(turnId);
    if (ownerThreadId !== threadId) {
      throw new Error(`Turn ${turnId} does not belong to thread ${threadId}.`);
    }
    await this.client.interruptTurn({ threadId, turnId });
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

  async resolveApprovalForThread(
    threadId: string,
    approvalId: string,
    decision: 'accept' | 'accept_for_session' | 'deny',
  ): Promise<void> {
    const ownerThreadId = this.threadIdForApproval(approvalId);
    if (ownerThreadId !== threadId) {
      throw new Error(`Approval ${approvalId} does not belong to thread ${threadId}.`);
    }
    await this.resolveApproval(approvalId, decision);
  }

  getTurnEvents(turnId: string, afterId?: string | number | null) {
    return this.eventBus.list(turnId, afterId);
  }

  hasActiveTurn(turnId: string): boolean {
    return this.activeTurns.has(turnId);
  }

  subscribeToTurn(turnId: string, listener: (entry: { event: CodexWebEvent; sequence: number }) => void) {
    return this.eventBus.subscribe(turnId, listener);
  }

  private append(turnId: string, event: CodexWebEvent): void {
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      this.logDebug('event_append', {
        turnId,
        event: summarizeRuntimeEvent(event),
      });
    }
    this.eventBus.append(turnId, event);
  }

  private logDebug(event: string, payload: unknown = null): void {
    try {
      this.logger.debug?.(`[codex-web-runtime] ${event} ${JSON.stringify(payload)}`);
    } catch {
      this.logger.debug?.(`[codex-web-runtime] ${event}`);
    }
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
      const thread = await this.client.readThread(threadId, true);
      if (thread) {
        return thread;
      }
      return this.resumeAndReadThread(threadId);
    } catch (error) {
      if (isMissingThreadError(error)) {
        return this.resumeAndReadThread(threadId);
      }
      if (!isIncludeTurnsRetryableError(error)) {
        throw error;
      }
      const thread = await this.client.readThread(threadId, false);
      if (thread) {
        return thread;
      }
      return this.resumeAndReadThread(threadId);
    }
  }

  private async resumeAndReadThread(threadId: string): Promise<ProviderThreadSummary | null> {
    if (typeof this.client.resumeThread !== 'function') {
      return null;
    }
    try {
      await this.client.resumeThread({ threadId });
    } catch (error) {
      if (isMissingThreadError(error)) {
        return null;
      }
      throw error;
    }
    try {
      const thread = await this.client.readThread(threadId, true);
      if (thread) {
        return thread;
      }
    } catch (error) {
      if (isMissingThreadError(error)) {
        return null;
      }
      if (!isIncludeTurnsRetryableError(error)) {
        throw error;
      }
    }
    return this.client.readThread(threadId, false);
  }

  private async ensureThreadReadyForTurn(threadId: string): Promise<void> {
    if (typeof this.client.resumeThread !== 'function') {
      return;
    }
    try {
      await this.client.resumeThread({ threadId });
    } catch (error) {
      if (isMissingRolloutError(error)) {
        return;
      }
      throw error;
    }
  }

  private toSession(thread: ProviderThreadSummary): CodexWebSession {
    const current = this.getSessionSettings(thread.threadId);
    const updatedAt = thread.updatedAt ?? null;
    const inputSummary = summarizeSessionInputs(thread);
    return {
      id: thread.threadId,
      cwd: thread.cwd,
      projectName: summarizeProjectName(thread.cwd),
      title: thread.title,
      updatedAt,
      preview: thread.preview ?? null,
      firstUserInput: inputSummary.firstUserInput,
      lastUserInput: inputSummary.lastUserInput,
      lastInputAt: updatedAt,
      favorite: current.favorite === true,
      favoriteOrder: current.favoriteOrder ?? null,
      goal: null,
      activeTurnId: this.activeTurnIdForThread(thread.threadId),
      settings: current,
      thread,
      timeline: composeSessionTimeline(thread, this.timelineStore?.list(thread.threadId) ?? []),
    };
  }

  private toStoredFavoriteSession(
    sessionId: string,
    settings: CodexWebStoredSessionSettings,
  ): CodexWebSession {
    const updatedAt = settings.updatedAt ?? null;
    const thread: ProviderThreadSummary = {
      threadId: sessionId,
      cwd: null,
      title: null,
      updatedAt,
      preview: '',
      turns: [],
    };
    return {
      id: sessionId,
      cwd: null,
      projectName: null,
      title: null,
      updatedAt,
      preview: null,
      firstUserInput: null,
      lastUserInput: null,
      lastInputAt: updatedAt,
      favorite: settings.favorite === true,
      favoriteOrder: settings.favoriteOrder ?? null,
      goal: null,
      activeTurnId: null,
      settings,
      thread,
      timeline: this.timelineStore?.list(sessionId) ?? [],
    };
  }

  private activeTurnIdForThread(threadId: string): string | null {
    for (const [turnId] of this.activeTurns) {
      if (this.turnToThread.get(turnId) === threadId) {
        return turnId;
      }
    }
    return null;
  }

  private conflictingActiveTurnId(session: CodexWebSession): string | null {
    return this.activeTurnIdForThread(session.id);
  }

  private async withThreadGoal(session: CodexWebSession): Promise<CodexWebSession> {
    if (typeof this.client.getThreadGoal !== 'function') {
      return session;
    }
    return {
      ...session,
      goal: await this.client.getThreadGoal(session.id),
    };
  }

  private mergeSettings(
    sessionId: string | null,
    patch: Partial<ProviderTurnSessionSettings> | UpdateSessionSettingsInput | undefined,
  ): CodexWebStoredSessionSettings {
    const current = sessionId
      ? this.getSessionSettings(sessionId)
      : createDefaultSettings('pending');
    const metadataSource = patch?.metadata && typeof patch.metadata === 'object'
      ? patch.metadata
      : current.metadata;
    const metadata = { ...metadataSource };
    if (patch) {
      delete metadata.codexWebDefaultsOnly;
    }
    return {
      ...current,
      ...patch,
      bridgeSessionId: sessionId ?? current.bridgeSessionId,
      metadata,
      updatedAt: Date.now(),
    };
  }

  private getSessionSettings(sessionId: string): CodexWebStoredSessionSettings {
    const cached = this.sessionSettings.get(sessionId);
    if (cached) {
      return cached;
    }
    const stored = this.settingsStore?.get(sessionId);
    const settings = stored
      ? {
        ...createDefaultSettings(sessionId),
        ...stored,
        bridgeSessionId: sessionId,
        metadata: stored.metadata ?? {},
      }
      : {
        ...createDefaultSettings(sessionId),
        metadata: { codexWebDefaultsOnly: true },
      };
    this.sessionSettings.set(sessionId, settings);
    return settings;
  }

  private getStoredSessionSettings(sessionId: string): CodexWebStoredSessionSettings | null {
    return this.sessionSettings.get(sessionId) ?? this.settingsStore?.get(sessionId) ?? null;
  }

  private persistSessionSettings(sessionId: string, settings: CodexWebStoredSessionSettings): void {
    const normalized = {
      ...settings,
      bridgeSessionId: sessionId,
      metadata: settings.metadata ?? {},
    };
    this.sessionSettings.set(sessionId, normalized);
    this.settingsStore?.set(sessionId, normalized);
  }

  private favoriteSessionIds(): string[] {
    const settingsById = new Map<string, CodexWebStoredSessionSettings>();
    for (const [sessionId, settings] of this.settingsStore?.list?.() ?? []) {
      settingsById.set(sessionId, settings);
    }
    for (const [sessionId, settings] of this.sessionSettings.entries()) {
      settingsById.set(sessionId, settings);
    }
    return [...settingsById.entries()]
      .filter(([, settings]) => settings.favorite === true)
      .sort(([, left], [, right]) => (left.favoriteOrder ?? Number.MAX_SAFE_INTEGER) - (right.favoriteOrder ?? Number.MAX_SAFE_INTEGER)
        || (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .map(([sessionId]) => sessionId);
  }

  private nextFavoriteOrder(): number {
    let maxOrder = 0;
    for (const settings of this.sessionSettings.values()) {
      if (settings.favorite === true && Number.isFinite(settings.favoriteOrder)) {
        maxOrder = Math.max(maxOrder, Number(settings.favoriteOrder));
      }
    }
    return maxOrder + 1;
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

  private appendCommandTimeline(
    sessionId: string,
    inputText: string,
    command: CodexWebCommandResult['command'],
    afterHistoryIndex: number,
  ): void {
    const baseId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.appendSessionTimelineEntry(sessionId, {
      id: `local_user_${baseId}`,
      role: 'user',
      label: 'You',
      meta: 'command',
      text: inputText.trim(),
      afterHistoryIndex,
    });
    this.appendSessionTimelineEntry(sessionId, {
      id: `command_${command.name}_${baseId}`,
      role: 'system',
      label: `/${command.name}`,
      meta: command.action || 'completed',
      text: String(command.message || 'Command completed.'),
      afterHistoryIndex,
    });
  }

  private appendFailedTurnTimeline(sessionId: string, turnId: string, message: string, afterHistoryIndex: number): void {
    if (!message.trim()) {
      return;
    }
    this.appendSessionTimelineEntry(sessionId, {
      id: `error_${turnId}`,
      role: 'system',
      label: 'Error',
      meta: 'failed',
      text: message,
      severity: 'error',
      afterHistoryIndex,
    });
  }
}

const SESSION_INPUT_PREVIEW_MAX_LENGTH = 240;

function summarizeProjectName(cwd: string | null | undefined): string | null {
  const segments = cwd?.split(/[\\/]+/u).filter(Boolean) ?? [];
  if (!segments.length) {
    return null;
  }
  return segments.slice(-2).join('/');
}

function summarizeSessionInputs(thread: ProviderThreadSummary): {
  firstUserInput: string | null;
  lastUserInput: string | null;
} {
  const userInputs: string[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (item.role?.toLowerCase() !== 'user') {
        continue;
      }
      const text = summarizeSessionInputText(item.text);
      if (text) {
        userInputs.push(text);
      }
    }
  }
  if (userInputs.length) {
    return {
      firstUserInput: userInputs[0] ?? null,
      lastUserInput: userInputs[userInputs.length - 1] ?? null,
    };
  }
  const fallback = summarizeSessionInputText(thread.preview);
  return {
    firstUserInput: fallback,
    lastUserInput: fallback,
  };
}

function summarizeSessionInputText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= SESSION_INPUT_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, SESSION_INPUT_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
}

interface ParsedGoalSlashCommand {
  action: 'show' | 'set' | 'pause' | 'resume' | 'clear';
  objective?: string;
}

function parseHelpSlashCommand(text: string): { action: 'show' } | null {
  const normalized = String(text ?? '').trim();
  if (normalized === '/help') {
    return { action: 'show' };
  }
  return null;
}

function parseGoalSlashCommand(text: string): ParsedGoalSlashCommand | null {
  const normalized = String(text ?? '').trim();
  if (!normalized.startsWith('/goal')) {
    return null;
  }
  const afterCommand = normalized.slice('/goal'.length);
  if (afterCommand && !/^\s/u.test(afterCommand)) {
    return null;
  }
  const rest = afterCommand.trim();
  if (!rest) {
    return { action: 'show' };
  }
  const [firstToken = '', ...remaining] = rest.split(/\s+/u);
  const keyword = firstToken.toLowerCase();
  if (keyword === 'clear') {
    return { action: 'clear' };
  }
  if (keyword === 'pause') {
    return { action: 'pause' };
  }
  if (keyword === 'resume') {
    return { action: 'resume' };
  }
  if (keyword === 'edit' || keyword === 'set') {
    const objective = remaining.join(' ').trim();
    return objective ? { action: 'set', objective } : { action: 'show' };
  }
  return { action: 'set', objective: rest };
}

function createGoalCommandResult({
  action,
  goal,
  message,
}: {
  action: CodexWebCommandResult['command']['action'];
  goal: ProviderThreadGoal | null;
  message: string;
}): CodexWebCommandResult {
  return {
    type: 'command',
    command: {
      name: 'goal',
      action,
      message,
      goal,
    },
  };
}

function composeSessionTimeline(
  thread: ProviderThreadSummary,
  extraEntries: CodexWebTimelineMessage[],
): CodexWebTimelineMessage[] {
  const history = timelineMessagesFromThread(thread);
  if (!extraEntries.length) {
    return history;
  }
  const seen = new Set(history.map((entry) => timelineDedupKey(entry)));
  const extras = extraEntries
    .map((entry) => ({ ...entry }))
    .filter((entry) => {
      const key = timelineDedupKey(entry);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  if (!extras.length) {
    return history;
  }
  const extrasByAfterHistoryIndex = new Map<number, CodexWebTimelineMessage[]>();
  for (const entry of extras) {
    const afterHistoryIndex = Number.isFinite(entry.afterHistoryIndex)
      ? Math.max(0, Math.min(history.length, Math.floor(Number(entry.afterHistoryIndex))))
      : history.length;
    const entries = extrasByAfterHistoryIndex.get(afterHistoryIndex) ?? [];
    entries.push(entry);
    extrasByAfterHistoryIndex.set(afterHistoryIndex, entries);
  }
  const merged: CodexWebTimelineMessage[] = [];
  const leadingExtras = extrasByAfterHistoryIndex.get(0) ?? [];
  merged.push(...leadingExtras);
  for (let index = 0; index < history.length; index += 1) {
    merged.push(history[index]!);
    const anchoredExtras = extrasByAfterHistoryIndex.get(index + 1) ?? [];
    merged.push(...anchoredExtras);
  }
  return merged;
}

function normalizeSessionTimelineEntry(
  sessionId: string,
  input: AppendSessionTimelineEntryInput,
): CodexWebTimelineMessage | null {
  if (!sessionId || !input || !['user', 'assistant', 'system'].includes(input.role)) {
    return null;
  }
  const text = String(input.text || '').trim();
  if (!text) {
    return null;
  }
  const role = input.role;
  const meta = typeof input.meta === 'string' ? input.meta.trim() : '';
  const label = typeof input.label === 'string' && input.label.trim()
    ? input.label.trim()
    : role === 'system' && input.severity === 'error'
      ? 'Error'
      : role === 'system'
        ? 'System'
        : role === 'assistant'
          ? 'Assistant'
          : 'You';
  return {
    id: typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : createSessionTimelineEntryId(sessionId, role, meta, text),
    kind: 'message',
    role,
    label,
    meta,
    text,
    severity: input.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(input.afterHistoryIndex) ? Math.max(0, Math.floor(Number(input.afterHistoryIndex))) : undefined,
  };
}

function publicSessionTimelineEntry(entry: CodexWebTimelineMessage): CodexWebTimelineMessage {
  const { afterHistoryIndex: _afterHistoryIndex, ...publicEntry } = entry as CodexWebTimelineMessage & { afterHistoryIndex?: number };
  return publicEntry;
}

function upsertSessionTimelineEntry(
  existing: CodexWebTimelineMessage[],
  entry: CodexWebTimelineMessage,
): CodexWebTimelineMessage[] {
  const next = existing.map((item) => ({ ...item }));
  const index = next.findIndex((current) => current.id === entry.id);
  if (index >= 0) {
    next[index] = { ...entry };
    return next;
  }
  next.push({ ...entry });
  return next;
}

function createSessionTimelineEntryId(
  sessionId: string,
  role: AppendSessionTimelineEntryInput['role'],
  meta: string,
  text: string,
): string {
  const digest = crypto.createHash('sha1')
    .update(`${sessionId}:${role}:${meta}:${text}`)
    .digest('hex')
    .slice(0, 12);
  return `timeline_${role}_${digest}`;
}

function timelineMessagesFromThread(thread: ProviderThreadSummary): CodexWebTimelineMessage[] {
  const items: CodexWebTimelineMessage[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      const role = normalizeTimelineMessageRole(item.role, item.type);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      items.push({
        id: `history_${turn.id}_${items.length}`,
        kind: 'message',
        role,
        label: role === 'user' ? 'You' : 'Assistant',
        meta: 'history',
        text,
      });
    }
    if (isFailureTurnStatus(turn.status)) {
      items.push({
        id: `error_${turn.id || `history_failed_${items.length}`}`,
        kind: 'message',
        role: 'system',
        label: 'Error',
        meta: 'failed',
        text: runtimeTurnErrorMessage(turn) || 'Turn failed',
        severity: 'error',
      });
    }
  }
  if (!items.length) {
    const preview = summarizeSessionInputText(thread.preview);
    if (preview) {
      items.push({
        id: `history_preview_${thread.threadId}`,
        kind: 'message',
        role: 'user',
        label: 'You',
        meta: 'preview',
        text: preview,
      });
    }
  }
  return items;
}

function normalizeTimelineMessageRole(role: string | null | undefined, type: string | null | undefined): 'user' | 'assistant' | null {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalizedRole === 'user' || normalizedRole === 'assistant') {
    return normalizedRole;
  }
  const normalizedType = typeof type === 'string' ? type.replace(/[^a-z]/giu, '').toLowerCase() : '';
  if (normalizedType.includes('assistant') || normalizedType.includes('agent')) {
    return 'assistant';
  }
  if (normalizedType.includes('user')) {
    return 'user';
  }
  return null;
}

function timelineDedupKey(entry: CodexWebTimelineMessage): string {
  return `${entry.id}\u0001${entry.role}\u0001${entry.meta}\u0001${entry.text}`;
}

function runtimeTurnErrorMessage(turn: Pick<ProviderThreadTurn, 'error' | 'items'> & {
  details?: unknown;
  message?: unknown;
}): string {
  return normalizeRuntimeErrorText(turn?.details)
    || normalizeRuntimeErrorText(turn?.error)
    || normalizeRuntimeErrorText(turn?.message)
    || runtimeTurnItemErrorMessage(turn)
    || 'Turn failed';
}

function runtimeTurnItemErrorMessage(turn: {
  items?: ProviderThreadTurnItem[];
}): string | null {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const raw: Record<string, unknown> = isRecord(item.raw) ? item.raw : {};
    const marker = [
      item.type,
      item.phase,
      raw.status,
      raw.severity,
      raw.type,
      raw.status,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    const hasErrorMarker = /error|fail|denied|unauthorized|forbidden|rate[_\s-]*limit/u.test(marker);
    const candidate = normalizeRuntimeErrorText(raw.details)
      || normalizeRuntimeErrorText(raw.error)
      || normalizeRuntimeErrorText(raw.message)
      || normalizeRuntimeErrorText(item.result)
      || normalizeRuntimeErrorText(raw.details)
      || normalizeRuntimeErrorText(raw.message)
      || normalizeRuntimeErrorText(raw.error);
    if (candidate && (hasErrorMarker || /unexpected status|unauthorized|forbidden|too many requests|rate limit|error|failed|failure|401|403|429/u.test(candidate.toLowerCase()))) {
      return candidate;
    }
    const text = normalizeRuntimeErrorText(item.text);
    if (text && hasErrorMarker) {
      return text;
    }
  }
  return null;
}

function normalizeRuntimeErrorText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!isRecord(value)) {
    return null;
  }
  return normalizeRuntimeErrorText(value.details)
    || normalizeRuntimeErrorText(value.rawMessage)
    || normalizeRuntimeErrorText(value.errorMessage)
    || normalizeRuntimeErrorText(value.message)
    || normalizeRuntimeErrorText(value.error)
    || normalizeRuntimeErrorText(value.stderr)
    || normalizeRuntimeErrorText(value.stack)
    || null;
}

function isFailureTurnStatus(status: string | null | undefined): boolean {
  return ['failed', 'error', 'timedout', 'timeout'].includes(normalizeTurnStatus(status));
}

function isSuccessTurnStatus(status: string | null | undefined): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(normalizeTurnStatus(status));
}

function isInterruptedTurnStatus(status: string | null | undefined): boolean {
  return ['interrupted', 'cancelled', 'canceled', 'aborted'].includes(normalizeTurnStatus(status));
}

function normalizeTurnStatus(status: string | null | undefined): string {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function isActiveTurnStatus(status: string | null | undefined): boolean {
  const normalized = normalizeTurnStatus(status);
  return Boolean(normalized)
    && !isSuccessTurnStatus(normalized)
    && !isFailureTurnStatus(normalized)
    && !isInterruptedTurnStatus(normalized);
}

function createTurnConflictError(sessionId: string, activeTurnId: string): CodexWebTurnConflictError {
  const error = new Error(`Session ${sessionId} already has an active turn (${activeTurnId}).`) as CodexWebTurnConflictError;
  error.code = 'turn_conflict';
  error.activeTurnId = activeTurnId;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createHelpCommandResult(helpReportPath: string | null): CodexWebCommandResult {
  const guideLine = helpReportPath
    ? `完整说明：[Codex Web 帮助文档](${helpReportPath})`
    : '完整说明：请在 Reports 页面打开 Codex Web 帮助文档。';
  return {
    type: 'command',
    command: {
      name: 'help',
      action: 'show',
      message: [
        '支持的命令：',
        '- `/help` - 显示这份命令列表。',
        '- `/goal` - 显示当前会话的目标。',
        '- `/goal <objective>` - 设置当前会话目标。',
        '- `/goal set <objective>` 或 `/goal edit <objective>` - 替换当前会话目标。',
        '- `/goal pause` - 暂停当前目标。',
        '- `/goal resume` - 恢复当前目标。',
        '- `/goal clear` - 清除当前会话目标。',
        '',
        guideLine,
      ].join('\n'),
      goal: null,
    },
  };
}

function formatGoalMessage(goal: ProviderThreadGoal | null): string {
  if (!goal) {
    return 'No goal is set.';
  }
  const status = goal.status ? ` (${goal.status})` : '';
  return `Goal${status}: ${goal.objective}`;
}

function summarizeRuntimeTurnResult(result: ProviderTurnResult): Record<string, unknown> {
  const withDetails = result as ProviderTurnResult & { details?: unknown };
  return {
    turnId: result.turnId ?? null,
    threadId: result.threadId ?? null,
    status: result.status ?? null,
    outputState: result.outputState ?? null,
    finalSource: result.finalSource ?? null,
    outputTextLength: String(result.outputText ?? '').length,
    previewTextLength: String(result.previewText ?? '').length,
    errorMessage: result.errorMessage ?? null,
    details: withDetails.details ?? null,
  };
}

function summarizeRuntimeEvent(event: CodexWebEvent): Record<string, unknown> {
  if (event.type === 'turn.completed') {
    return {
      type: event.type,
      turnId: event.turnId,
      threadId: event.threadId,
      status: event.status,
      raw: summarizeRuntimeValue(event.raw),
    };
  }
  if (event.type === 'turn.failed') {
    return {
      type: event.type,
      turnId: event.turnId,
      threadId: event.threadId,
      message: event.message,
      details: event.details ?? null,
      raw: summarizeRuntimeValue(event.raw),
    };
  }
  return {
    type: event.type,
    turnId: 'turnId' in event ? event.turnId : null,
  };
}

function summarizeRuntimeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      details: (error as Error & { details?: unknown }).details ?? null,
      stack: error.stack?.split('\n').slice(0, 4).join('\n') ?? null,
    };
  }
  return {
    value: summarizeRuntimeValue(error),
  };
}

function summarizeRuntimeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Error) {
    return summarizeRuntimeError(value);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function createDefaultSettings(sessionId: string): CodexWebStoredSessionSettings {
  return {
    bridgeSessionId: sessionId,
    model: 'gpt-5.4',
    reasoningEffort: 'xhigh',
    serviceTier: null,
    collaborationMode: 'default',
    personality: 'pragmatic',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    locale: null,
    metadata: {},
    updatedAt: Date.now(),
    favorite: false,
    favoriteOrder: null,
  };
}

function omitNullTomlValues(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => omitNullTomlValues(entry))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, omitNullTomlValues(entry)] as const)
        .filter(([, entry]) => entry !== undefined),
    );
  }
  return value;
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
    || /empty session file/i.test(message)
    || /rollout .* is empty/i.test(message);
}

export function isMissingThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /thread not found/i.test(message)
    || /thread not loaded/i.test(message)
    || /session not found/i.test(message)
    || /unknown thread/i.test(message);
}

function isUnavailableThreadError(error: unknown): boolean {
  return isMissingThreadError(error) || isMissingRolloutError(error);
}

function isMissingRolloutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no rollout found for thread id/i.test(message)
    || /rollout .* is empty/i.test(message);
}
