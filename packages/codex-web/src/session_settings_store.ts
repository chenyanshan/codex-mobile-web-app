import fs from 'node:fs';
import path from 'node:path';
import type { ProviderTurnSessionSettings } from '@codex-mobile-web-app/codex-native-api';

export type CodexWebStoredSessionSettings = ProviderTurnSessionSettings & {
  favorite?: boolean;
  favoriteOrder?: number | null;
};

export interface CodexWebSessionSettingsStore {
  get(sessionId: string): CodexWebStoredSessionSettings | null;
  list?(): Array<[string, CodexWebStoredSessionSettings]>;
  set(sessionId: string, settings: CodexWebStoredSessionSettings): void;
  delete(sessionId: string): void;
}

interface SessionSettingsFile {
  version: 1;
  sessions: Record<string, CodexWebStoredSessionSettings>;
}

export class FileSessionSettingsStore implements CodexWebSessionSettingsStore {
  private readonly settingsPath: string;

  private cache: SessionSettingsFile | null = null;

  constructor({ settingsPath }: { settingsPath: string }) {
    this.settingsPath = settingsPath;
  }

  get(sessionId: string): CodexWebStoredSessionSettings | null {
    return normalizeSettings(sessionId, this.read().sessions[sessionId]);
  }

  list(): Array<[string, CodexWebStoredSessionSettings]> {
    return Object.entries(this.read().sessions)
      .map(([sessionId, settings]) => [sessionId, normalizeSettings(sessionId, settings)] as const)
      .filter((entry): entry is [string, CodexWebStoredSessionSettings] => Boolean(entry[1]));
  }

  set(sessionId: string, settings: CodexWebStoredSessionSettings): void {
    const file = this.read();
    file.sessions[sessionId] = normalizeSettings(sessionId, settings) ?? settings;
    this.write(file);
  }

  delete(sessionId: string): void {
    const file = this.read();
    if (!(sessionId in file.sessions)) {
      return;
    }
    delete file.sessions[sessionId];
    this.write(file);
  }

  private read(): SessionSettingsFile {
    if (this.cache) {
      return this.cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<SessionSettingsFile>;
      this.cache = {
        version: 1,
        sessions: isRecord(parsed.sessions) ? parsed.sessions as Record<string, CodexWebStoredSessionSettings> : {},
      };
    } catch {
      this.cache = { version: 1, sessions: {} };
    }
    return this.cache;
  }

  private write(file: SessionSettingsFile): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, this.settingsPath);
    this.cache = file;
  }
}

function normalizeSettings(
  sessionId: string,
  value: CodexWebStoredSessionSettings | undefined,
): CodexWebStoredSessionSettings | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    bridgeSessionId: typeof value.bridgeSessionId === 'string' ? value.bridgeSessionId : sessionId,
    model: nullableString(value.model),
    reasoningEffort: nullableString(value.reasoningEffort),
    serviceTier: nullableString(value.serviceTier),
    collaborationMode: value.collaborationMode === 'plan' ? 'plan' : 'default',
    personality: value.personality === 'friendly' || value.personality === 'none' ? value.personality : 'pragmatic',
    accessPreset: value.accessPreset === 'read-only' || value.accessPreset === 'full-access'
      ? value.accessPreset
      : 'default',
    approvalPolicy: nullableString(value.approvalPolicy),
    sandboxMode: nullableString(value.sandboxMode),
    locale: nullableString(value.locale),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    favorite: value.favorite === true,
    favoriteOrder: Number.isFinite(value.favoriteOrder) ? Number(value.favoriteOrder) : null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
