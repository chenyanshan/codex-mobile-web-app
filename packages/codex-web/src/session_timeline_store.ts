import fs from 'node:fs';
import path from 'node:path';

export interface CodexWebTimelineMessage {
  id: string;
  kind: 'message';
  role: 'user' | 'assistant' | 'system';
  label: string;
  meta: string;
  text: string;
  severity?: 'error';
  afterHistoryIndex?: number;
}

export interface CodexWebSessionTimelineStore {
  list(sessionId: string): CodexWebTimelineMessage[];
  append(sessionId: string, entry: CodexWebTimelineMessage): void;
  replace(sessionId: string, entries: CodexWebTimelineMessage[]): void;
  delete(sessionId: string): void;
}

interface TimelineFile {
  version: 1;
  sessions: Record<string, CodexWebTimelineMessage[]>;
}

export class FileSessionTimelineStore implements CodexWebSessionTimelineStore {
  private readonly timelinePath: string;

  private cache: TimelineFile | null = null;

  constructor({ timelinePath }: { timelinePath: string }) {
    this.timelinePath = timelinePath;
  }

  list(sessionId: string): CodexWebTimelineMessage[] {
    return normalizeEntries(this.read().sessions[sessionId]);
  }

  append(sessionId: string, entry: CodexWebTimelineMessage): void {
    const file = this.read();
    const current = normalizeEntries(file.sessions[sessionId]);
    current.push(normalizeEntry(entry));
    file.sessions[sessionId] = current;
    this.write(file);
  }

  replace(sessionId: string, entries: CodexWebTimelineMessage[]): void {
    const file = this.read();
    file.sessions[sessionId] = normalizeEntries(entries);
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

  private read(): TimelineFile {
    if (this.cache) {
      return this.cache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.timelinePath, 'utf8')) as Partial<TimelineFile>;
      this.cache = {
        version: 1,
        sessions: isRecord(parsed.sessions)
          ? Object.fromEntries(
            Object.entries(parsed.sessions).map(([sessionId, entries]) => [sessionId, normalizeEntries(entries)]),
          )
          : {},
      };
    } catch {
      this.cache = { version: 1, sessions: {} };
    }
    return this.cache;
  }

  private write(file: TimelineFile): void {
    fs.mkdirSync(path.dirname(this.timelinePath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.timelinePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, this.timelinePath);
    this.cache = file;
  }
}

function normalizeEntries(value: unknown): CodexWebTimelineMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeEntryOrNull)
    .filter((entry): entry is CodexWebTimelineMessage => Boolean(entry));
}

function normalizeEntryOrNull(value: unknown): CodexWebTimelineMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = value.kind === 'message' ? 'message' : null;
  const role = value.role === 'user' || value.role === 'assistant' || value.role === 'system'
    ? value.role
    : null;
  const id = typeof value.id === 'string' && value.id ? value.id : null;
  const label = typeof value.label === 'string' ? value.label : null;
  const meta = typeof value.meta === 'string' ? value.meta : null;
  const text = typeof value.text === 'string' ? value.text : null;
  if (!kind || !role || !id || !label || !meta || !text) {
    return null;
  }
  return {
    id,
    kind,
    role,
    label,
    meta,
    text,
    severity: value.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(value.afterHistoryIndex) ? Math.max(0, Math.floor(Number(value.afterHistoryIndex))) : undefined,
  };
}

function normalizeEntry(entry: CodexWebTimelineMessage): CodexWebTimelineMessage {
  return {
    id: entry.id,
    kind: 'message',
    role: entry.role,
    label: entry.label,
    meta: entry.meta,
    text: entry.text,
    severity: entry.severity === 'error' ? 'error' : undefined,
    afterHistoryIndex: Number.isFinite(entry.afterHistoryIndex) ? Math.max(0, Math.floor(Number(entry.afterHistoryIndex))) : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
