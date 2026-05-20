import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexWebConfig {
  host: string;
  port: number;
  defaultCwd: string;
  codexBin: string;
  stateDir: string;
  authPath: string;
  reportsDir: string;
  reportIndexPath: string;
  envPath: string;
  debug: boolean;
}

export function loadServiceConfig({
  env = process.env,
  homeDir = os.homedir(),
  envPath = path.join(homeDir, '.config', 'codex-web', 'service.env'),
}: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  envPath?: string;
} = {}): CodexWebConfig {
  const fileEnv = readEnvFile(envPath);
  const merged = {
    ...fileEnv,
    ...env,
  };
  const stateDir = normalizeString(merged.CODEX_WEB_STATE_DIR)
    || path.join(homeDir, '.codex-web');
  const port = parsePort(merged.CODEX_WEB_PORT, 43210);
  return {
    host: normalizeString(merged.CODEX_WEB_HOST) || '0.0.0.0',
    port,
    defaultCwd: normalizeString(merged.CODEX_WEB_DEFAULT_CWD) || homeDir,
    codexBin: normalizeString(merged.CODEX_REAL_BIN) || 'codex',
    stateDir,
    authPath: path.join(stateDir, 'auth.json'),
    reportsDir: path.join(stateDir, 'reports'),
    reportIndexPath: path.join(stateDir, 'report-index.json'),
    envPath,
    debug: parseBoolean(merged.CODEX_WEB_DEBUG, false),
  };
}

export function readEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const entries: Record<string, string> = {};
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^"|"$/gu, '');
    if (/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
      entries[key] = value;
    }
  }
  return entries;
}

function parsePort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}
