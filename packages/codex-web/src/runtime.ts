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
  settings: CodexWebStoredSessionSettings;
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
  resumeThread?(args: { threadId: string }): Promise<unknown>;
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

export interface ListSessionsOptions {
  favorite?: boolean;
}

export class CodexWebRuntime {
  readonly client: CodexWebRuntimeClient;

  readonly eventBus: CodexWebEventBus;

  private readonly defaultCwd: string;

  private readonly settingsStore: CodexWebSessionSettingsStore | null;

  private readonly sessionSettings = new Map<string, CodexWebStoredSessionSettings>();

  private readonly turnToThread = new Map<string, string>();

  private readonly approvalToTurn = new Map<string, string>();

  private readonly approvalToBatch = new Map<string, string>();

  private readonly activeTurns = new Map<string, Promise<ProviderTurnResult>>();

  private readonly workSummaries = new Map<string, Record<string, unknown>>();

  constructor({
    codexBin,
    defaultCwd,
    client = new CodexAppClient({ codexCliBin: codexBin }),
    eventBus = new CodexWebEventBus(),
    settingsStore,
  }: CodexWebRuntimeOptions) {
    this.client = client;
    this.eventBus = eventBus;
    this.defaultCwd = defaultCwd;
    this.settingsStore = settingsStore ?? null;
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
    return true;
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

  async startTurn(sessionId: string, input: StartTurnInput): Promise<{ turnId: string }> {
    const session = await this.readSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const settings = this.mergeSettings(sessionId, input.settings);
    this.persistSessionSettings(sessionId, settings);
    await this.ensureThreadReadyForTurn(sessionId);
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
      sandboxMode: settings.sandboxMode ?? 'danger-full-access',
      approvalPolicy: settings.approvalPolicy ?? 'never',
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
      settings: current,
      thread,
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
      settings,
      thread,
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
