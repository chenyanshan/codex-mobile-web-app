import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { Socket } from 'node:net';
import path from 'node:path';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import {
  canCreateProjectSession,
  canReadAppSession,
  canWriteAppSession,
  localAdminPrincipal,
  type CodexWebPrincipal,
} from './access_control.js';
import type { PublicAuthSession } from './auth_store.js';
import type { CodexWebConfig } from './config.js';
import type { CodexWebStoredEvent } from './event_bus.js';
import type {
  CodexWebAppSession,
  CodexWebIdentityState,
  CodexWebProject,
  CodexWebRole,
  CodexWebUser,
  FileIdentityStore,
} from './identity_store.js';
import { FileReportStore } from './report_store.js';
import type { CodexWebReport } from './report_store.js';
import type {
  CodexWebRuntime,
  CodexWebSession,
  AppendSessionTimelineEntryInput,
  CodexWebStartTurnResult,
  CreateSessionInput,
  StartTurnInput,
  UpdateSessionSettingsInput,
} from './runtime.js';

export interface CodexWebAuthLike {
  isConfigured(): Promise<boolean>;
  login(args: {
    username?: string | null;
    password: string;
    deviceName?: string | null;
  }): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean }>;
  verifyToken(token: string | null | undefined): Promise<PublicAuthSession | null>;
  logout(token: string | null | undefined): Promise<void>;
  setMultiUserEnabled?(enabled: boolean): Promise<CodexWebIdentityState>;
}

export interface CreateCodexWebServerOptions {
  auth: CodexWebAuthLike;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  identityStore?: CodexWebIdentityStoreLike | null;
  staticFiles?: StaticFilesRecord;
}

export interface CodexWebServerHandle {
  baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface AuthenticatedRequestContext {
  token: string;
  session: PublicAuthSession;
}

interface CodexWebIdentityStoreLike {
  readState(): Promise<CodexWebIdentityState>;
  setMultiUserEnabled?(enabled: boolean): Promise<CodexWebIdentityState>;
  ensureBootstrapAdminFromPasswordHash?: FileIdentityStore['ensureBootstrapAdminFromPasswordHash'];
  upsertProject?(project: CodexWebProject): Promise<CodexWebProject>;
  upsertRole?(role: CodexWebRole): Promise<CodexWebRole>;
  upsertUserWithPassword?(input: {
    id: string;
    username: string;
    password: string;
    enabled?: boolean;
    canNewSession?: boolean;
    roleIds?: string[];
    directProjectGrants?: any[];
  }): Promise<CodexWebUser>;
  updateUserAccess?(input: {
    id: string;
    enabled?: boolean;
    canNewSession?: boolean;
    roleIds?: string[];
    directProjectGrants?: any[];
  }): Promise<CodexWebUser>;
  deleteUser?(userId: string): Promise<void>;
  updateUserProjectFavorite?(input: { userId: string; projectId: string; favorite: boolean }): Promise<CodexWebUser>;
  upsertSession(session: CodexWebAppSession): Promise<CodexWebAppSession>;
  deleteSession?(sessionId: string): Promise<void>;
  createShare?(args: { sessionId: string; createdByUserId: string }): ReturnType<FileIdentityStore['createShare']>;
  findShareByToken?(token: string): Promise<string | null>;
}

const SETUP_REQUIRED_MESSAGE = 'Password not configured. Run codex-web auth set-password.';
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_UPLOAD_BODY_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT_PER_CLIENT = 10;
const LOGIN_RATE_LIMIT_GLOBAL = 100;
const BUILD_ID_PLACEHOLDER = '__CODEX_WEB_BUILD_ID__';
type StaticFileAsset = { body: string | Buffer; contentType: string };
type StaticFileEntry = StaticFileAsset | (() => StaticFileAsset);
type StaticFilesRecord = Record<string, StaticFileEntry>;

interface ParsedUploadFile {
  fileName: string;
  mimeType: string | null;
  data: Buffer;
}

interface StoredUploadAttachment {
  id: string;
  kind: 'image' | 'file';
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  storage: 'project' | 'state';
  localPath: string;
  displayPath: string;
}

export function createCodexWebServer({
  auth,
  runtime,
  config,
  identityStore = null,
  staticFiles,
}: CreateCodexWebServerOptions): CodexWebServerHandle {
  const resolvedStaticFiles = staticFiles ?? loadDefaultStaticFiles();
  const activeSseClosers = new Set<() => void>();
  const sockets = new Set<Socket>();
  const loginRateLimiter = new FixedWindowRateLimiter({
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    perClientLimit: LOGIN_RATE_LIMIT_PER_CLIENT,
    globalLimit: LOGIN_RATE_LIMIT_GLOBAL,
  });
  const server = http.createServer((request, response) => {
    void handleRequest({
      request,
      response,
      auth,
      runtime,
      identityStore,
      staticFiles: resolvedStaticFiles,
      config,
      loginRateLimiter,
      registerSseCloser: (close) => {
        activeSseClosers.add(close);
        return () => {
          activeSseClosers.delete(close);
        };
      },
    }).catch((error) => {
      writeErrorResponse({ request, response, error });
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });

  let baseUrl = `http://${config.host}:${config.port}`;

  return {
    get baseUrl() {
      return baseUrl;
    },
    async start(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          const address = server.address();
          if (address && typeof address === 'object') {
            baseUrl = `http://${address.address}:${address.port}`;
          }
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      for (const close of [...activeSseClosers]) {
        close();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      for (const socket of sockets) {
        socket.destroy();
      }
    },
  };
}

function loadDefaultStaticFiles(): StaticFilesRecord {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const buildId = createBuildId();
  const readText = (relativePath: string) => readFileSync(path.join(publicDir, relativePath), 'utf8');
  const readBinary = (relativePath: string) => readFileSync(path.join(publicDir, relativePath));
  const indexAsset = (): StaticFileAsset => ({
    body: readText('index.html'),
    contentType: 'text/html; charset=utf-8',
  });
  return {
    '/': indexAsset,
    '/index.html': indexAsset,
    '/app.js': () => ({
      body: injectBuildId(readText('app.js'), buildId),
      contentType: 'application/javascript; charset=utf-8',
    }),
    '/styles.css': () => ({
      body: readText('styles.css'),
      contentType: 'text/css; charset=utf-8',
    }),
    '/pwa-pull-refresh.js': () => ({
      body: readText('pwa-pull-refresh.js'),
      contentType: 'application/javascript; charset=utf-8',
    }),
    '/manifest.webmanifest': () => ({
      body: readText('manifest.webmanifest'),
      contentType: 'application/manifest+json; charset=utf-8',
    }),
    '/service-worker.js': () => ({
      body: injectBuildId(readText('service-worker.js'), buildId),
      contentType: 'application/javascript; charset=utf-8',
    }),
    '/icon-192.png': () => ({
      body: readBinary('icon-192.png'),
      contentType: 'image/png',
    }),
    '/icon-512.png': () => ({
      body: readBinary('icon-512.png'),
      contentType: 'image/png',
    }),
    '/apple-touch-icon.png': () => ({
      body: readBinary('apple-touch-icon.png'),
      contentType: 'image/png',
    }),
  };
}

function createBuildId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function injectBuildId(source: string, buildId: string): string {
  return source.replaceAll(BUILD_ID_PLACEHOLDER, buildId);
}

async function handleRequest({
  request,
  response,
  auth,
  runtime,
  identityStore,
  staticFiles,
  config,
  loginRateLimiter,
  registerSseCloser,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  auth: CodexWebAuthLike;
  runtime: CodexWebRuntime;
  identityStore: CodexWebIdentityStoreLike | null;
  staticFiles: StaticFilesRecord;
  config: CodexWebConfig;
  loginRateLimiter: FixedWindowRateLimiter;
  registerSseCloser: (close: () => void) => () => void;
}): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${config.host}:${config.port}`}`);
  const pathname = url.pathname;
  const configured = await auth.isConfigured();

  if (!pathname.startsWith('/api/')) {
    if (!configured && pathname === '/') {
      writeSetupRequiredPage(response);
      return;
    }
    const asset = resolveStaticFile(staticFiles[pathname] ?? (isShareAppRoute(pathname) ? staticFiles['/'] : undefined));
    if (!asset) {
      writeJson(response, 404, { error: 'Not found' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
    });
    response.end(asset.body);
    return;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!configured) {
      writeSetupRequiredJson(response);
      return;
    }
    const rateLimit = loginRateLimiter.take(getClientAddress(request));
    if (!rateLimit.allowed) {
      writeJson(response, 429, {
        error: 'rate_limited',
        message: 'Too many login attempts. Try again later.',
        retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1_000),
      }, {
        'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1_000)),
      });
      return;
    }
    const body = await readJsonBody(request);
    const login = await loginWithPassword({
      auth,
      username: typeof body.username === 'string' ? body.username : null,
      password: String(body.password ?? ''),
      deviceName: typeof body.deviceName === 'string' ? body.deviceName : null,
      response,
    });
    if (!login) {
      return;
    }
    writeJson(response, 200, login);
    return;
  }

  if (!configured) {
    writeSetupRequiredJson(response);
    return;
  }

  const shareHandled = await handlePublicShareRequest({
    pathname,
    method,
    response,
    identityStore,
    runtime,
    registerSseCloser,
    request,
    url,
  });
  if (shareHandled) {
    return;
  }

  const authContext = await authenticateRequest({ auth, request });
  if (!authContext) {
    response.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'WWW-Authenticate': 'Bearer',
    });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const identityState = identityStore ? await identityStore.readState() : null;
  const principal = authContext.session.principal ?? localAdminPrincipal();
  if (identityStore && identityState && (identityState.settings.multiUserEnabled === true || pathname.startsWith('/api/admin/'))) {
    const handled = await handleMultiUserRequest({
      request,
      response,
      pathname,
      method,
      url,
      authContext,
      auth,
      principal,
      identityStore,
      identityState,
      runtime,
      config,
      registerSseCloser,
    });
    if (handled) {
      return;
    }
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    writeJson(response, 200, { session: authContext.session });
    return;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await auth.logout(authContext.token);
    writeJson(response, 200, { ok: true });
    return;
  }

  if (pathname === '/api/health' && method === 'GET') {
    writeJson(response, 200, {
      ok: true,
      host: config.host,
      port: config.port,
    });
    return;
  }

  if (pathname === '/api/models' && method === 'GET') {
    writeJson(response, 200, { items: await runtime.listModels() });
    return;
  }

  if (pathname === '/api/usage' && method === 'GET') {
    writeJson(response, 200, { usage: await runtime.readUsage() });
    return;
  }

  const reportStore = new FileReportStore({
    reportsDir: config.reportsDir,
    indexPath: config.reportIndexPath,
  });

  if (pathname === '/api/reports' && method === 'GET') {
    writeJson(response, 200, { items: await reportStore.listReports() });
    return;
  }

  if (pathname === '/api/reports/resolve' && method === 'POST') {
    const body = await readJsonBody(request);
    const inputPath = typeof body.path === 'string' ? body.path : '';
    if (!inputPath.trim()) {
      writeJson(response, 400, {
        error: 'invalid_report_path',
        message: 'path is required',
      });
      return;
    }
    const report = await resolveReportForResponse(reportStore, inputPath, response);
    if (!report) {
      return;
    }
    writeJson(response, 200, { report });
    return;
  }

  if (pathname === '/api/runtime/reload' && method === 'POST') {
    const result = await runtime.reloadRuntime();
    writeJson(response, 200, { ok: true, ...result });
    return;
  }

  if (pathname === '/api/sessions' && method === 'GET') {
    const options = url.searchParams.get('favorite') === 'true' ? { favorite: true } : {};
    writeJson(response, 200, { items: await runtime.listSessions(options) });
    return;
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    const body = await readJsonBody(request);
    const session = await runtime.createSession(body as CreateSessionInput);
    writeJson(response, 201, { session });
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u);
  if (sessionMatch && method === 'GET') {
    const session = await runtime.readSession(decodeURIComponent(sessionMatch[1]!));
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { session });
    return;
  }

  const sessionTimelineMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/u);
  if (sessionTimelineMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionTimelineMatch[1]!);
    const session = await runtime.readSession(sessionId);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    const body = await readJsonBody(request);
    const entryInput = normalizeSessionTimelineEntryInput(body);
    if (!entryInput) {
      writeJson(response, 400, {
        error: 'invalid_timeline_entry',
        message: 'A non-empty system message is required.',
      });
      return;
    }
    const entry = runtime.appendSessionTimelineEntry(sessionId, entryInput);
    if (!entry) {
      writeJson(response, 400, {
        error: 'invalid_timeline_entry',
        message: 'A non-empty system message is required.',
      });
      return;
    }
    writeJson(response, 201, { entry });
    return;
  }

  if (sessionMatch && method === 'DELETE') {
    const archived = await runtime.archiveSession(decodeURIComponent(sessionMatch[1]!));
    if (!archived) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { ok: true });
    return;
  }

  const sessionFavoriteMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/favorite$/u);
  if (sessionFavoriteMatch && method === 'PATCH') {
    const sessionId = decodeURIComponent(sessionFavoriteMatch[1]!);
    const body = await readJsonBody(request);
    if (typeof body.favorite !== 'boolean') {
      writeJson(response, 400, { error: 'favorite must be a boolean' });
      return;
    }
    const favoriteOrder = Number.isFinite(body.favoriteOrder) ? Number(body.favoriteOrder) : null;
    const session = await runtime.updateSessionFavorite(sessionId, body.favorite, favoriteOrder);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { session });
    return;
  }

  const sessionSettingsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/settings$/u);
  if (sessionSettingsMatch && method === 'PATCH') {
    const sessionId = decodeURIComponent(sessionSettingsMatch[1]!);
    const body = await readJsonBody(request);
    const session = await runtime.updateSessionSettings(sessionId, body as UpdateSessionSettingsInput);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    writeJson(response, 200, { session });
    return;
  }

  const sessionAttachmentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/attachments$/u);
  if (sessionAttachmentsMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionAttachmentsMatch[1]!);
    const session = await runtime.readSession(sessionId);
    if (!session) {
      writeSessionNotFound(response);
      return;
    }
    const items = await storeSessionAttachments({
      request,
      config,
      principal,
      projectCwd: normalizeOptionalString(session.cwd),
      projectKey: `cwd-${stableIdHash(normalizeOptionalString(session.cwd) || sessionId, 16)}`,
    });
    writeJson(response, 201, { items });
    return;
  }

  const reportContentMatch = pathname.match(/^\/api\/reports\/([^/]+)\/content$/u);
  if (reportContentMatch && method === 'GET') {
    const reportId = decodeURIComponent(reportContentMatch[1]!);
    const content = await readReportContentForResponse(reportStore, reportId, response);
    if (!content) {
      return;
    }
    writeJson(response, 200, content);
    return;
  }

  const reportFavoriteMatch = pathname.match(/^\/api\/reports\/([^/]+)\/favorite$/u);
  if (reportFavoriteMatch && method === 'PATCH') {
    const reportId = decodeURIComponent(reportFavoriteMatch[1]!);
    const body = await readJsonBody(request);
    if (typeof body.favorite !== 'boolean') {
      writeJson(response, 400, { error: 'favorite must be a boolean' });
      return;
    }
    const favorite = body.favorite;
    const report = await readReportForResponse(
      () => reportStore.setFavorite(reportId, favorite),
      response,
    );
    if (!report) {
      return;
    }
    writeJson(response, 200, { report });
    return;
  }

  const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/u);
  if (reportMatch && method === 'GET') {
    const report = await readReportForResponse(
      () => reportStore.readReport(decodeURIComponent(reportMatch[1]!)),
      response,
    );
    if (!report) {
      return;
    }
    writeJson(response, 200, { report });
    return;
  }

  const startTurnMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/u);
  if (startTurnMatch && method === 'POST') {
    const sessionId = decodeURIComponent(startTurnMatch[1]!);
    const body = await readJsonBody(request);
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return;
    }
    const input = await normalizeStartTurnInput({
      body,
      config,
      principal,
      runtime,
      sessionId,
      projectCwd: '',
      projectKey: '',
    });
    if (!input) {
      writeSessionNotFound(response);
      return;
    }
    const turn = await startSessionTurn({
      runtime,
      sessionId,
      input,
      response,
    });
    if (!turn) {
      return;
    }
    writeJson(response, 202, turn);
    return;
  }

  const interruptMatch = pathname.match(/^\/api\/turns\/([^/]+)\/interrupt$/u);
  if (interruptMatch && method === 'POST') {
    await runtime.interruptTurn(decodeURIComponent(interruptMatch[1]!));
    writeJson(response, 200, { ok: true });
    return;
  }

  const eventsMatch = pathname.match(/^\/api\/turns\/([^/]+)\/events$/u);
  if (eventsMatch && method === 'GET') {
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId: decodeURIComponent(eventsMatch[1]!),
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      registerSseCloser,
    });
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/(accept|accept-for-session|deny)$/u);
  if (approvalMatch && method === 'POST') {
    const approvalId = decodeURIComponent(approvalMatch[1]!);
    const action = approvalMatch[2]!;
    const decision = action === 'accept'
      ? 'accept'
      : action === 'accept-for-session'
        ? 'accept_for_session'
        : 'deny';
    await runtime.resolveApproval(approvalId, decision);
    writeJson(response, 200, { ok: true });
    return;
  }

  writeJson(response, 404, { error: 'Not found' });
}

function resolveStaticFile(entry: StaticFileEntry | undefined): StaticFileAsset | null {
  if (!entry) {
    return null;
  }
  return typeof entry === 'function' ? entry() : entry;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

class FixedWindowRateLimiter {
  private readonly windowMs: number;

  private readonly perClientLimit: number;

  private readonly globalLimit: number;

  private windowStartedAt = 0;

  private globalCount = 0;

  private readonly clientCounts = new Map<string, number>();

  constructor({
    windowMs,
    perClientLimit,
    globalLimit,
  }: {
    windowMs: number;
    perClientLimit: number;
    globalLimit: number;
  }) {
    this.windowMs = windowMs;
    this.perClientLimit = perClientLimit;
    this.globalLimit = globalLimit;
  }

  take(clientId: string, now = Date.now()): RateLimitResult {
    this.rotateWindow(now);
    const clientCount = (this.clientCounts.get(clientId) ?? 0) + 1;
    const globalCount = this.globalCount + 1;
    if (clientCount > this.perClientLimit || globalCount > this.globalLimit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, this.windowStartedAt + this.windowMs - now),
      };
    }
    this.clientCounts.set(clientId, clientCount);
    this.globalCount = globalCount;
    return { allowed: true, retryAfterMs: 0 };
  }

  private rotateWindow(now: number): void {
    if (this.windowStartedAt > 0 && now - this.windowStartedAt < this.windowMs) {
      return;
    }
    this.windowStartedAt = now;
    this.globalCount = 0;
    this.clientCounts.clear();
  }
}

async function authenticateRequest({
  auth,
  request,
}: {
  auth: CodexWebAuthLike;
  request: IncomingMessage;
}): Promise<AuthenticatedRequestContext | null> {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }
  const session = await auth.verifyToken(token);
  if (!session) {
    return null;
  }
  return { token, session };
}

async function handlePublicShareRequest({
  pathname,
  method,
  response,
  identityStore,
  runtime,
  registerSseCloser,
  request,
  url,
}: {
  pathname: string;
  method: string;
  response: ServerResponse;
  identityStore: CodexWebIdentityStoreLike | null;
  runtime: CodexWebRuntime;
  registerSseCloser: (close: () => void) => () => void;
  request: IncomingMessage;
  url: URL;
}): Promise<boolean> {
  const shareSessionMatch = pathname.match(/^\/api\/share\/([^/]+)\/session$/u);
  const shareEventsMatch = pathname.match(/^\/api\/share\/([^/]+)\/turns\/([^/]+)\/events$/u);
  if (!shareSessionMatch && !shareEventsMatch) {
    if (pathname.startsWith('/api/share/')) {
      writeJson(response, 404, { error: 'Not found' });
      return true;
    }
    return false;
  }
  if (!identityStore?.findShareByToken) {
    writeSessionNotFound(response);
    return true;
  }
  if (method !== 'GET') {
    writeJson(response, 404, { error: 'Not found' });
    return true;
  }
  const token = decodeURIComponent((shareSessionMatch?.[1] ?? shareEventsMatch?.[1])!);
  const shareId = await identityStore.findShareByToken(token);
  if (!shareId) {
    writeSessionNotFound(response);
    return true;
  }
  const state = await identityStore.readState();
  const share = state.shares.find((item) => item.id === shareId && item.enabled !== false);
  const appSession = share ? state.sessions.find((item) => item.id === share.sessionId) : null;
  if (!share || !appSession) {
    writeSessionNotFound(response);
    return true;
  }
  if (shareEventsMatch) {
    const turnId = decodeURIComponent(shareEventsMatch[2]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    if (threadId !== appSession.codexThreadId) {
      writeSessionNotFound(response);
      return true;
    }
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId,
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      registerSseCloser,
    });
    return true;
  }
  const session = await runtime.readSession(appSession.codexThreadId);
  if (!session) {
    writeSessionNotFound(response);
    return true;
  }
  writeJson(response, 200, {
    mode: 'share',
    session: presentSessionForUser({
      runtimeSession: session,
      appSession,
      project: state.projects.find((item) => item.id === appSession.projectId) ?? null,
      includeCwd: false,
    }),
  });
  return true;
}

function isShareAppRoute(pathname: string): boolean {
  return /^\/share\/[^/]+$/u.test(pathname);
}

async function handleMultiUserRequest({
  request,
  response,
  pathname,
  method,
  url,
  authContext,
  auth,
  principal,
  identityStore,
  identityState,
  runtime,
  config,
  registerSseCloser,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  url: URL;
  authContext: AuthenticatedRequestContext;
  auth: CodexWebAuthLike;
  principal: CodexWebPrincipal;
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  registerSseCloser: (close: () => void) => () => void;
}): Promise<boolean> {
  if (pathname === '/api/auth/me' || pathname === '/api/auth/logout') {
    return false;
  }

  if (pathname === '/api/projects' && method === 'GET') {
    const favoriteProjectIds = favoriteProjectIdsForPrincipal(identityState, principal);
    const items = identityState.projects
      .filter((project) => (
        principal.isAdmin
        || (project.enabled !== false && canReadProject(identityState, principal, project.id))
      ))
      .map((project) => ({
        id: project.id,
        displayName: projectDisplayName(project, project.id),
        canCreate: principal.isAdmin ? true : canCreateProjectSession(identityState, principal, project.id),
        favorite: favoriteProjectIds.has(project.id),
      }));
    writeJson(response, 200, { items });
    return true;
  }

  const projectFavoriteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/favorite$/u);
  if (projectFavoriteMatch && method === 'PATCH') {
    if (typeof identityStore.updateUserProjectFavorite !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const projectId = decodeURIComponent(projectFavoriteMatch[1]!);
    const project = findProject(identityState, projectId);
    if (
      !project
      || (!principal.isAdmin && (project.enabled === false || !canReadProject(identityState, principal, project.id)))
    ) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.favorite !== 'boolean') {
      writeJson(response, 400, { error: 'favorite must be a boolean' });
      return true;
    }
    await identityStore.updateUserProjectFavorite({
      userId: principal.userId,
      projectId: project.id,
      favorite: body.favorite,
    });
    writeJson(response, 200, { projectId: project.id, favorite: body.favorite });
    return true;
  }

  if (pathname === '/api/sessions' && method === 'GET') {
    const readableSessionsByThreadId = new Map(
      identityState.sessions
        .filter((appSession) => canReadAppSession(identityState, principal, appSession))
        .map((appSession) => [appSession.codexThreadId, appSession]),
    );
    if (url.searchParams.get('favorite') === 'true') {
      const items = [];
      for (const runtimeSession of await runtime.listSessions({ favorite: true })) {
        const appSession = readableSessionsByThreadId.get(runtimeSession.id);
        if (!appSession) {
          continue;
        }
        items.push(presentSessionForUser({
          runtimeSession,
          appSession,
          project: findProject(identityState, appSession.projectId),
          includeCwd: false,
        }));
      }
      writeJson(response, 200, { items });
      return true;
    }
    const items = [];
    for (const runtimeSession of await runtime.listSessions()) {
      const appSession = readableSessionsByThreadId.get(runtimeSession.id);
      if (!appSession) {
        continue;
      }
      items.push(presentSessionForUser({
        runtimeSession,
        appSession,
        project: findProject(identityState, appSession.projectId),
        includeCwd: false,
      }));
    }
    writeJson(response, 200, { items });
    return true;
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    const body = await readJsonBody(request);
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const project = findProject(identityState, projectId);
    if (
      !project
      || (!principal.isAdmin && (project.enabled === false || !canCreateProjectSession(identityState, principal, project.id)))
    ) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.createSession({
      ...(body as CreateSessionInput),
      cwd: project.cwd,
    });
    const now = new Date().toISOString();
    const appSession = await identityStore.upsertSession({
      id: crypto.randomUUID(),
      codexThreadId: runtimeSession.id,
      projectId: project.id,
      ownerUserId: principal.userId,
      createdAt: now,
      updatedAt: now,
    });
    writeJson(response, 201, {
      session: presentSessionForUser({
        runtimeSession,
        appSession,
        project,
        includeCwd: false,
      }),
    });
    return true;
  }

  const adminSessionsMatch = pathname.match(/^\/api\/admin\/sessions(?:\/([^/]+))?$/u);
  if (pathname.startsWith('/api/admin/')) {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    const handledAdmin = await handleAdminManagementRequest({
      request,
      response,
      pathname,
      method,
      identityStore,
      identityState,
      auth,
    });
    if (handledAdmin) {
      return true;
    }
  }

  if (adminSessionsMatch) {
    if (!principal.isAdmin) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    const adminIdentityState = await ensureAdminLegacySessionMappings({
      identityStore,
      identityState,
      runtime,
      principal,
    });
    const sessionId = adminSessionsMatch[1] ? decodeURIComponent(adminSessionsMatch[1]) : null;
    if (!sessionId && method === 'GET') {
      const userId = url.searchParams.get('userId');
      const projectId = url.searchParams.get('projectId');
      const items = adminIdentityState.sessions
        .filter((session) => !userId || session.ownerUserId === userId)
        .filter((session) => !projectId || session.projectId === projectId)
        .map((session) => presentAppSessionAudit(adminIdentityState, session));
      writeJson(response, 200, { items });
      return true;
    }
    if (sessionId && method === 'GET') {
      const appSession = adminIdentityState.sessions.find((session) => session.id === sessionId);
      if (!appSession) {
        writeSessionNotFound(response);
        return true;
      }
      const runtimeSession = await runtime.readSession(appSession.codexThreadId);
      if (!runtimeSession) {
        writeSessionNotFound(response);
        return true;
      }
      writeJson(response, 200, {
        mode: 'observer',
        session: presentSessionForUser({
          runtimeSession,
          appSession,
          project: findProject(adminIdentityState, appSession.projectId),
          includeCwd: true,
        }),
      });
      return true;
    }
  }

  const shareCreateMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/share$/u);
  if (shareCreateMatch && method === 'POST') {
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId: decodeURIComponent(shareCreateMatch[1]!),
    });
    const resolved = resolveReadableAppSession(stateForSession, principal, decodeURIComponent(shareCreateMatch[1]!));
    if (!resolved || !identityStore.createShare) {
      writeSessionNotFound(response);
      return true;
    }
    const created = await identityStore.createShare({
      sessionId: resolved.appSession.id,
      createdByUserId: principal.userId,
    });
    writeJson(response, 201, {
      token: created.token,
      shareUrl: `/share/${encodeURIComponent(created.token)}`,
    });
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u);
  if (sessionMatch && method === 'GET') {
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId: decodeURIComponent(sessionMatch[1]!),
    });
    const resolved = resolveReadableAppSession(stateForSession, principal, decodeURIComponent(sessionMatch[1]!));
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        includeCwd: false,
      }),
    });
    return true;
  }

  const startTurnMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/u);
  if (startTurnMatch && method === 'POST') {
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId: decodeURIComponent(startTurnMatch[1]!),
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, decodeURIComponent(startTurnMatch[1]!));
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return true;
    }
    const runtimeSession = hasRequestAttachments(body)
      ? await runtime.readSession(resolved.appSession.codexThreadId)
      : null;
    const projectCwd = normalizeOptionalString(resolved.project?.cwd) || normalizeOptionalString(runtimeSession?.cwd);
    const input = await normalizeStartTurnInput({
      body,
      config,
      principal,
      runtime,
      sessionId: resolved.appSession.codexThreadId,
      projectCwd,
      projectKey: safePathSegment(resolved.project?.id || resolved.appSession.projectId || `cwd-${stableIdHash(projectCwd, 16)}`),
    });
    if (!input) {
      writeSessionNotFound(response);
      return true;
    }
    const turn = await startSessionTurn({
      runtime,
      sessionId: resolved.appSession.codexThreadId,
      input,
      response,
    });
    if (!turn) {
      return true;
    }
    writeJson(response, 202, turn);
    return true;
  }

  const sessionAttachmentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/attachments$/u);
  if (sessionAttachmentsMatch && method === 'POST') {
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId: decodeURIComponent(sessionAttachmentsMatch[1]!),
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, decodeURIComponent(sessionAttachmentsMatch[1]!));
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const runtimeSession = await runtime.readSession(resolved.appSession.codexThreadId);
    const projectCwd = normalizeOptionalString(resolved.project?.cwd) || normalizeOptionalString(runtimeSession?.cwd);
    const items = await storeSessionAttachments({
      request,
      config,
      principal,
      projectCwd,
      projectKey: safePathSegment(resolved.project?.id || resolved.appSession.projectId || `cwd-${stableIdHash(projectCwd, 16)}`),
    });
    writeJson(response, 201, { items });
    return true;
  }

  const sessionSettingsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/settings$/u);
  if (sessionSettingsMatch && method === 'PATCH') {
    const stateForSession = await stateForSessionAccess({
      identityStore,
      identityState,
      runtime,
      principal,
      sessionId: decodeURIComponent(sessionSettingsMatch[1]!),
    });
    const resolved = resolveWritableAppSession(stateForSession, principal, decodeURIComponent(sessionSettingsMatch[1]!));
    if (!resolved) {
      writeSessionNotFound(response);
      return true;
    }
    const body = await readJsonBody(request);
    const runtimeSession = await runtime.updateSessionSettings(resolved.appSession.codexThreadId, body as UpdateSessionSettingsInput);
    if (!runtimeSession) {
      writeSessionNotFound(response);
      return true;
    }
    writeJson(response, 200, {
      session: presentSessionForUser({
        runtimeSession,
        appSession: resolved.appSession,
        project: resolved.project,
        includeCwd: false,
      }),
    });
    return true;
  }

  const interruptMatch = pathname.match(/^\/api\/turns\/([^/]+)\/interrupt$/u);
  if (interruptMatch && method === 'POST') {
    const turnId = decodeURIComponent(interruptMatch[1]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canWriteAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    if (typeof runtime.interruptTurnForThread === 'function') {
      await runtime.interruptTurnForThread(threadId!, turnId);
    } else {
      await runtime.interruptTurn(turnId);
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/(accept|accept-for-session|deny)$/u);
  if (approvalMatch && method === 'POST') {
    const approvalId = decodeURIComponent(approvalMatch[1]!);
    const threadId = runtime.threadIdForApproval?.(approvalId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canWriteAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    const action = approvalMatch[2]!;
    const decision = action === 'accept'
      ? 'accept'
      : action === 'accept-for-session'
        ? 'accept_for_session'
        : 'deny';
    if (typeof runtime.resolveApprovalForThread === 'function') {
      await runtime.resolveApprovalForThread(threadId!, approvalId, decision);
    } else {
      await runtime.resolveApproval(approvalId, decision);
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  const eventsMatch = pathname.match(/^\/api\/turns\/([^/]+)\/events$/u);
  if (eventsMatch && method === 'GET') {
    const turnId = decodeURIComponent(eventsMatch[1]!);
    const threadId = runtime.threadIdForTurn?.(turnId);
    const appSession = threadId ? identityState.sessions.find((session) => session.codexThreadId === threadId) : null;
    if (!appSession || !canReadAppSession(identityState, principal, appSession)) {
      writeSessionNotFound(response);
      return true;
    }
    await streamTurnEvents({
      request,
      response,
      runtime,
      turnId,
      afterId: normalizeLastEventId(url.searchParams.get('after'), request.headers['last-event-id']),
      registerSseCloser,
    });
    return true;
  }

  return false;
}

async function handleAdminManagementRequest({
  request,
  response,
  pathname,
  method,
  identityStore,
  identityState,
  auth,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  auth: CodexWebAuthLike;
}): Promise<boolean> {
  if (pathname === '/api/admin/settings' && method === 'GET') {
    writeJson(response, 200, { settings: identityState.settings });
    return true;
  }
  if (pathname === '/api/admin/settings' && method === 'PATCH') {
    const setMultiUserEnabled = typeof auth.setMultiUserEnabled === 'function'
      ? (enabled: boolean) => auth.setMultiUserEnabled!(enabled)
      : identityStore.setMultiUserEnabled?.bind(identityStore);
    if (typeof setMultiUserEnabled !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const state = await setMultiUserEnabled(body.multiUserEnabled === true);
    writeJson(response, 200, { settings: state.settings });
    return true;
  }
  if (pathname === '/api/admin/projects' && method === 'GET') {
    writeJson(response, 200, { items: identityState.projects });
    return true;
  }
  if (pathname === '/api/admin/projects' && method === 'POST') {
    if (typeof identityStore.upsertProject !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const project = await identityStore.upsertProject({
      id: String(body.id ?? ''),
      internalName: String(body.internalName ?? ''),
      cwd: String(body.cwd ?? ''),
      displayName: String(body.displayName ?? ''),
      enabled: body.enabled !== false,
    });
    writeJson(response, 201, { project });
    return true;
  }
  if (pathname === '/api/admin/roles' && method === 'GET') {
    writeJson(response, 200, { items: identityState.roles });
    return true;
  }
  if (pathname === '/api/admin/roles' && method === 'POST') {
    if (typeof identityStore.upsertRole !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const projectIds = Array.isArray(body.projectIds)
      ? body.projectIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const role = await identityStore.upsertRole({
      id: String(body.id ?? ''),
      name: String(body.name ?? ''),
      isAdmin: body.isAdmin === true,
      projectGrants: projectIds.length
        ? projectIds.map((projectId) => ({ projectId, canRead: true, canCreate: true, canWrite: true }))
        : normalizeRoleProjectGrants(body.projectGrants),
    });
    writeJson(response, 201, { role });
    return true;
  }
  if (pathname === '/api/admin/users' && method === 'GET') {
    writeJson(response, 200, { items: identityState.users.map(presentAdminUser) });
    return true;
  }
  if (pathname === '/api/admin/users' && method === 'POST') {
    if (typeof identityStore.upsertUserWithPassword !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
    const roleIds = roleId
      ? [roleId]
      : Array.isArray(body.roleIds)
        ? body.roleIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 1)
        : [];
    const user = await identityStore.upsertUserWithPassword({
      id: String(body.id ?? ''),
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
      enabled: body.enabled !== false,
      roleIds,
      directProjectGrants: Array.isArray(body.directProjectGrants) ? body.directProjectGrants as any[] : [],
    });
    writeJson(response, 201, { user: presentAdminUser(user) });
    return true;
  }
  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/u);
  if (adminUserMatch && method === 'PATCH') {
    if (typeof identityStore.updateUserAccess !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    const body = await readJsonBody(request);
    const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
    const roleIds = roleId
      ? [roleId]
      : Array.isArray(body.roleIds)
        ? body.roleIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 1)
        : [];
    try {
      const user = await identityStore.updateUserAccess({
        id: decodeURIComponent(adminUserMatch[1]!),
        enabled: body.enabled !== false,
        roleIds,
        directProjectGrants: Array.isArray(body.directProjectGrants) ? body.directProjectGrants as any[] : undefined,
      });
      writeJson(response, 200, { user: presentAdminUser(user) });
    } catch {
      writeSessionNotFound(response);
    }
    return true;
  }
  if (adminUserMatch && method === 'DELETE') {
    if (typeof identityStore.deleteUser !== 'function') {
      writeJson(response, 501, { error: 'not_supported' });
      return true;
    }
    try {
      await identityStore.deleteUser(decodeURIComponent(adminUserMatch[1]!));
      response.statusCode = 204;
      response.end();
    } catch {
      writeSessionNotFound(response);
    }
    return true;
  }
  return false;
}

function presentAdminUser(user: CodexWebUser): Record<string, unknown> {
  const [roleId = ''] = user.roleIds;
  return {
    id: user.id,
    username: user.username,
    enabled: user.enabled,
    roleId,
    roleIds: user.roleIds,
    directProjectGrants: user.directProjectGrants,
    favoriteProjectIds: user.favoriteProjectIds,
  };
}

function normalizeRoleProjectGrants(value: unknown): Array<{
  projectId: string;
  canRead: boolean;
  canCreate: boolean;
  canWrite: boolean;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((grant) => {
      if (!grant || typeof grant !== 'object') {
        return null;
      }
      const projectId = typeof (grant as { projectId?: unknown }).projectId === 'string'
        ? (grant as { projectId: string }).projectId.trim()
        : '';
      if (!projectId) {
        return null;
      }
      return {
        projectId,
        canRead: true,
        canCreate: true,
        canWrite: true,
      };
    })
    .filter((grant): grant is { projectId: string; canRead: boolean; canCreate: boolean; canWrite: boolean } => grant !== null);
}

function canReadProject(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  projectId: string,
): boolean {
  if (principal.isAdmin) {
    return true;
  }
  const grant = canReadProjectGrant(state, principal, projectId);
  return grant === true;
}

function canReadProjectGrant(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  projectId: string,
): boolean {
  const user = state.users.find((item) => item.id === principal.userId && item.enabled !== false);
  if (!user) {
    return false;
  }
  const grants = [
    ...state.roles
      .filter((role) => user.roleIds.includes(role.id))
      .flatMap((role) => role.projectGrants),
    ...user.directProjectGrants,
  ].filter((grant) => grant.projectId === projectId);
  return grants.some((grant) => grant.canRead === true || grant.canCreate === true || grant.canWrite === true);
}

function resolveReadableAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  sessionId: string,
): { appSession: CodexWebAppSession; project: CodexWebProject | null } | null {
  const appSession = findAppSessionByExternalId(state, sessionId);
  if (!appSession || !canReadAppSession(state, principal, appSession)) {
    return null;
  }
  return {
    appSession,
    project: findProject(state, appSession.projectId),
  };
}

function resolveWritableAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  sessionId: string,
): { appSession: CodexWebAppSession; project: CodexWebProject | null } | null {
  const appSession = findAppSessionByExternalId(state, sessionId);
  if (!appSession || !canWriteAppSession(state, principal, appSession)) {
    return null;
  }
  return {
    appSession,
    project: findProject(state, appSession.projectId),
  };
}

function findAppSessionByExternalId(state: CodexWebIdentityState, sessionId: string): CodexWebAppSession | null {
  return state.sessions.find((session) => session.id === sessionId)
    ?? state.sessions.find((session) => session.codexThreadId === sessionId)
    ?? null;
}

function findProject(state: CodexWebIdentityState, projectId: string): CodexWebProject | null {
  return state.projects.find((project) => project.id === projectId) ?? null;
}

function favoriteProjectIdsForPrincipal(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
): Set<string> {
  const user = state.users.find((item) => item.id === principal.userId && item.enabled !== false);
  return new Set(user?.favoriteProjectIds ?? []);
}

async function stateForSessionAccess({
  identityStore,
  identityState,
  runtime,
  principal,
  sessionId,
}: {
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  principal: CodexWebPrincipal;
  sessionId: string;
}): Promise<CodexWebIdentityState> {
  if (!principal.isAdmin || findAppSessionByExternalId(identityState, sessionId)) {
    return identityState;
  }
  return ensureAdminLegacySessionMappings({
    identityStore,
    identityState,
    runtime,
    principal,
  });
}

async function ensureAdminLegacySessionMappings({
  identityStore,
  identityState,
  runtime,
  principal,
}: {
  identityStore: CodexWebIdentityStoreLike;
  identityState: CodexWebIdentityState;
  runtime: CodexWebRuntime;
  principal: CodexWebPrincipal;
}): Promise<CodexWebIdentityState> {
  if (typeof identityStore.upsertProject !== 'function') {
    return identityState;
  }
  const runtimeSessions = await runtime.listSessions();
  const mappedThreadIds = new Set(identityState.sessions.map((session) => session.codexThreadId));
  const projectsById = new Map(identityState.projects.map((project) => [project.id, project]));
  const ownerUserId = adminOwnerUserId(identityState, principal);
  let changed = false;

  for (const runtimeSession of runtimeSessions) {
    const threadId = normalizeOptionalString(runtimeSession.id);
    if (!threadId || mappedThreadIds.has(threadId)) {
      continue;
    }
    const project = legacyProjectForRuntimeSession(runtimeSession);
    const existingProject = projectsById.get(project.id);
    if (!existingProject) {
      await identityStore.upsertProject(project);
      projectsById.set(project.id, project);
      changed = true;
    } else if (existingProject.enabled === false) {
      const enabledProject = {
        ...existingProject,
        enabled: true,
      };
      await identityStore.upsertProject(enabledProject);
      projectsById.set(project.id, enabledProject);
      changed = true;
    }
    const timestamp = isoFromRuntimeTimestamp(runtimeSession.updatedAt, new Date().toISOString());
    await identityStore.upsertSession({
      id: legacyAppSessionId(threadId),
      codexThreadId: threadId,
      projectId: project.id,
      ownerUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    mappedThreadIds.add(threadId);
    changed = true;
  }

  return changed ? identityStore.readState() : identityState;
}

function adminOwnerUserId(state: CodexWebIdentityState, principal: CodexWebPrincipal): string {
  const adminUser = state.users.find((user) => user.id === 'user_admin')
    ?? state.users.find((user) => user.username === 'admin')
    ?? state.users.find((user) => user.enabled !== false && user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin)));
  return adminUser?.id ?? principal.userId;
}

function legacyProjectForRuntimeSession(runtimeSession: CodexWebSession): CodexWebProject {
  const cwd = normalizeOptionalString(runtimeSession.cwd) || '__codex_web_legacy_unknown_cwd__';
  const displayName = cwdLeafName(cwd) || normalizeOptionalString(runtimeSession.projectName) || 'Legacy Session';
  return {
    id: `project_admin_legacy_${stableIdHash(cwd, 20)}`,
    internalName: displayName,
    cwd,
    displayName,
    enabled: true,
  };
}

function legacyAppSessionId(threadId: string): string {
  return `app_legacy_${stableIdHash(threadId, 24)}`;
}

function stableIdHash(value: string, length: number): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isoFromRuntimeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function presentAppSessionAudit(
  state: CodexWebIdentityState,
  appSession: CodexWebAppSession,
): Record<string, unknown> {
  const project = findProject(state, appSession.projectId);
  return {
    id: appSession.id,
    projectId: appSession.projectId,
    projectDisplayName: projectDisplayName(project, appSession.projectId),
    ownerUserId: appSession.ownerUserId,
    codexThreadId: appSession.codexThreadId,
    createdAt: appSession.createdAt,
    updatedAt: appSession.updatedAt,
  };
}

function presentSessionForUser({
  runtimeSession,
  appSession,
  project,
  includeCwd,
}: {
  runtimeSession: any;
  appSession: CodexWebAppSession;
  project: CodexWebProject | null;
  includeCwd: boolean;
}): Record<string, unknown> {
  const { cwd, projectName, ...rest } = runtimeSession ?? {};
  return {
    ...rest,
    id: appSession.id,
    projectId: appSession.projectId,
    projectDisplayName: projectDisplayName(project, appSession.projectId),
    ownerUserId: appSession.ownerUserId,
    ...(includeCwd ? { cwd, projectName } : {}),
  };
}

function projectDisplayName(project: CodexWebProject | null | undefined, fallback: string): string {
  const displayName = cwdLeafName(project?.displayName);
  if (displayName) {
    return displayName;
  }
  return cwdLeafName(project?.cwd) || normalizeOptionalString(fallback) || normalizeOptionalString(project?.id) || 'Unknown project';
}

function cwdLeafName(cwd: unknown): string {
  const parts = normalizeOptionalString(cwd).split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : '';
}

function getClientAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress || 'unknown';
}

async function loginWithPassword({
  auth,
  username,
  password,
  deviceName,
  response,
}: {
  auth: CodexWebAuthLike;
  username: string | null;
  password: string;
  deviceName: string | null;
  response: ServerResponse;
}): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean } | null> {
  try {
    return await auth.login({ username, password, deviceName });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Invalid password' || error.message === 'Invalid username or password')) {
      writeJson(response, 401, {
        error: 'invalid_password',
        message: error.message,
      });
      return null;
    }
    throw error;
  }
}

async function startSessionTurn({
  runtime,
  sessionId,
  input,
  response,
}: {
  runtime: CodexWebRuntime;
  sessionId: string;
  input: StartTurnInput;
  response: ServerResponse;
}): Promise<CodexWebStartTurnResult | null> {
  try {
    return await runtime.startTurn(sessionId, input);
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      writeRequestLog({
        level: 'warn',
        method: 'POST',
        path: `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
        status: 404,
        code: 'session_not_found',
        message: error instanceof Error ? error.message : String(error),
      });
      writeSessionNotFound(response);
      return null;
    }
    if (isTurnConflictError(error)) {
      const activeTurnId = extractActiveTurnId(error);
      writeRequestLog({
        level: 'warn',
        method: 'POST',
        path: `/api/sessions/${encodeURIComponent(sessionId)}/turns`,
        status: 409,
        code: 'turn_conflict',
        message: error instanceof Error ? error.message : String(error),
      });
      writeJson(response, 409, {
        error: 'turn_conflict',
        message: error instanceof Error ? error.message : String(error),
        ...(activeTurnId ? { activeTurnId } : {}),
      });
      return null;
    }
    throw error;
  }
}

async function storeSessionAttachments({
  request,
  config,
  principal,
  projectCwd,
  projectKey,
}: {
  request: IncomingMessage;
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  projectCwd: string;
  projectKey: string;
}): Promise<StoredUploadAttachment[]> {
  const files = await readMultipartUploadFiles(request);
  if (!files.length) {
    throw createHttpError(400, 'invalid_upload', 'Upload request must include at least one file.');
  }
  const userSegment = safePathSegment(principal.userId || principal.username || 'local-user');
  const projectStorage = normalizeOptionalString(projectCwd)
    ? path.join(projectCwd, 'uploads', userSegment)
    : '';
  if (projectStorage) {
    try {
      return await writeUploadFiles({
        files,
        rootDir: projectStorage,
        storage: 'project',
        createProjectGitignore: true,
      });
    } catch (error) {
      if (!isProjectUploadFallbackError(error)) {
        throw error;
      }
    }
  }
  const stateStorage = path.join(
    config.stateDir,
    'uploads',
    'projects',
    safePathSegment(projectKey || `cwd-${stableIdHash(projectCwd || 'unknown', 16)}`),
    userSegment,
  );
  try {
    return await writeUploadFiles({
      files,
      rootDir: stateStorage,
      storage: 'state',
      createProjectGitignore: false,
    });
  } catch (error) {
    if (isProjectUploadFallbackError(error)) {
      throw createHttpError(403, 'project_upload_not_writable', 'Upload directory is not writable.');
    }
    throw error;
  }
}

async function normalizeStartTurnInput({
  body,
  config,
  principal,
  runtime,
  sessionId,
  projectCwd,
  projectKey,
}: {
  body: Record<string, unknown>;
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  runtime: CodexWebRuntime;
  sessionId: string;
  projectCwd: string;
  projectKey: string;
}): Promise<StartTurnInput | null> {
  if (!hasRequestAttachments(body)) {
    return body as unknown as StartTurnInput;
  }
  let resolvedProjectCwd = normalizeOptionalString(projectCwd);
  if (!resolvedProjectCwd) {
    const session = await runtime.readSession(sessionId);
    if (!session) {
      return null;
    }
    resolvedProjectCwd = normalizeOptionalString(session.cwd);
  }
  const allowedRoots = allowedUploadRoots({
    config,
    principal,
    projectCwd: resolvedProjectCwd,
    projectKey: projectKey || `cwd-${stableIdHash(resolvedProjectCwd || sessionId, 16)}`,
  });
  const attachments = [];
  for (const raw of body.attachments as unknown[]) {
    const attachment = normalizeAttachmentRequest(raw);
    if (!attachment) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment payload is invalid.');
    }
    const localPath = path.resolve(attachment.localPath);
    if (!allowedRoots.some((root) => isPathInside(localPath, root))) {
      throw createHttpError(400, 'invalid_attachment', 'Attachment path is outside the allowed upload directories.');
    }
    try {
      await fs.access(localPath);
    } catch {
      throw createHttpError(400, 'invalid_attachment', 'Attachment file is not accessible.');
    }
    attachments.push({
      ...attachment,
      localPath,
    });
  }
  return {
    ...(body as unknown as StartTurnInput),
    attachments,
  };
}

function hasRequestAttachments(body: Record<string, unknown>): boolean {
  return Array.isArray(body.attachments) && body.attachments.length > 0;
}

function allowedUploadRoots({
  config,
  principal,
  projectCwd,
  projectKey,
}: {
  config: CodexWebConfig;
  principal: CodexWebPrincipal;
  projectCwd: string;
  projectKey: string;
}): string[] {
  const userSegment = safePathSegment(principal.userId || principal.username || 'local-user');
  const roots = [
    path.resolve(
      config.stateDir,
      'uploads',
      'projects',
      safePathSegment(projectKey || `cwd-${stableIdHash(projectCwd || 'unknown', 16)}`),
      userSegment,
    ),
  ];
  if (projectCwd) {
    roots.unshift(path.resolve(projectCwd, 'uploads', userSegment));
  }
  return roots;
}

function normalizeAttachmentRequest(value: unknown): {
  kind: 'image' | 'file';
  localPath: string;
  fileName?: string | null;
  mimeType?: string | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const localPath = typeof record.localPath === 'string' ? record.localPath.trim() : '';
  if (!localPath) {
    return null;
  }
  return {
    kind: record.kind === 'image' ? 'image' : 'file',
    localPath,
    fileName: typeof record.fileName === 'string' && record.fileName.trim() ? record.fileName.trim() : null,
    mimeType: typeof record.mimeType === 'string' && record.mimeType.trim() ? record.mimeType.trim() : null,
    transcriptText: typeof record.transcriptText === 'string' && record.transcriptText.trim() ? record.transcriptText.trim() : null,
    durationSeconds: typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
      ? record.durationSeconds
      : null,
  };
}

async function writeUploadFiles({
  files,
  rootDir,
  storage,
  createProjectGitignore,
}: {
  files: ParsedUploadFile[];
  rootDir: string;
  storage: 'project' | 'state';
  createProjectGitignore: boolean;
}): Promise<StoredUploadAttachment[]> {
  await ensureUploadDirectory(rootDir, createProjectGitignore);
  const root = path.resolve(rootDir);
  const items: StoredUploadAttachment[] = [];
  for (const file of files) {
    const id = `att_${crypto.randomUUID().replace(/-/gu, '').slice(0, 20)}`;
    const safeName = safeUploadFileName(file.fileName);
    const localPath = path.resolve(root, `${id}-${safeName}`);
    if (!isPathInside(localPath, root)) {
      throw createHttpError(400, 'invalid_upload', 'Upload path is invalid.');
    }
    await fs.writeFile(localPath, file.data, { flag: 'wx', mode: 0o600 });
    items.push({
      id,
      kind: file.mimeType?.toLowerCase().startsWith('image/') ? 'image' : 'file',
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.data.byteLength,
      storage,
      localPath,
      displayPath: localPath,
    });
  }
  return items;
}

async function ensureUploadDirectory(rootDir: string, createProjectGitignore: boolean): Promise<void> {
  const root = path.resolve(rootDir);
  const parent = path.dirname(root);
  await rejectSymlinkIfPresent(parent);
  await rejectSymlinkIfPresent(root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await rejectSymlinkIfPresent(root);
  if (createProjectGitignore) {
    const uploadsDir = path.dirname(root);
    await rejectSymlinkIfPresent(uploadsDir);
    await fs.writeFile(path.join(uploadsDir, '.gitignore'), '*\n!.gitignore\n', { flag: 'w', mode: 0o600 });
  }
}

async function rejectSymlinkIfPresent(filePath: string): Promise<void> {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw createHttpError(403, 'project_upload_not_writable', 'Upload directory must not be a symbolic link.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function readMultipartUploadFiles(request: IncomingMessage): Promise<ParsedUploadFile[]> {
  const contentType = String(request.headers['content-type'] ?? '');
  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) {
    throw createHttpError(400, 'invalid_upload', 'Upload request must use multipart/form-data.');
  }
  const body = await readRequestBody(request, MAX_UPLOAD_BODY_BYTES);
  const raw = body.toString('latin1');
  const segments = raw.split(`--${boundary}`);
  const files: ParsedUploadFile[] = [];
  for (const segment of segments) {
    if (!segment || segment === '--\r\n' || segment === '--') {
      continue;
    }
    let part = segment;
    if (part.startsWith('\r\n')) {
      part = part.slice(2);
    }
    if (part.endsWith('\r\n')) {
      part = part.slice(0, -2);
    }
    if (part.endsWith('--')) {
      part = part.slice(0, -2);
    }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      continue;
    }
    const headerText = part.slice(0, headerEnd);
    const contentText = part.slice(headerEnd + 4);
    const headers = parseMultipartHeaders(headerText);
    const disposition = headers.get('content-disposition') || '';
    const name = multipartDispositionValue(disposition, 'name');
    const fileName = multipartDispositionValue(disposition, 'filename');
    if (!fileName || (name !== 'files' && name !== 'file')) {
      continue;
    }
    const data = Buffer.from(contentText, 'latin1');
    if (data.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw createHttpError(413, 'payload_too_large', 'Uploaded file is too large.');
    }
    files.push({
      fileName: normalizeUploadedFileName(fileName),
      mimeType: normalizeOptionalString(headers.get('content-type')) || null,
      data,
    });
  }
  return files;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseMultipartBoundary(contentType: string): string {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/iu);
  return normalizeOptionalString(match?.[1] || match?.[2]);
}

function parseMultipartHeaders(headerText: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of headerText.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function multipartDispositionValue(disposition: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = disposition.match(new RegExp(`${escapedKey}="([^"]*)"`, 'iu'));
  return match ? Buffer.from(match[1]!, 'latin1').toString('utf8') : '';
}

function normalizeUploadedFileName(fileName: string): string {
  const normalized = path.basename(fileName.replace(/\\/gu, '/')).trim();
  return normalized || 'upload';
}

function safeUploadFileName(fileName: string): string {
  const normalized = normalizeUploadedFileName(fileName)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return normalized || 'upload';
}

function safePathSegment(value: string): string {
  const normalized = normalizeOptionalString(value)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return normalized || 'unknown';
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isProjectUploadFallbackError(error: unknown): boolean {
  if (isHttpError(error)) {
    return error.statusCode === 403;
  }
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === 'EACCES'
    || code === 'EPERM'
    || code === 'EROFS'
    || code === 'ENOTDIR'
    || code === 'ENOENT';
}

function writeSessionNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: 'session_not_found',
    message: 'Selected session was not found.',
  });
}

function normalizeSessionTimelineEntryInput(value: unknown): AppendSessionTimelineEntryInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const role = entry.role === 'user' || entry.role === 'assistant' || entry.role === 'system'
    ? entry.role
    : null;
  const text = typeof entry.text === 'string' ? entry.text.trim() : '';
  if (role !== 'system' || !text) {
    return null;
  }
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null,
    role,
    label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : null,
    meta: typeof entry.meta === 'string' && entry.meta.trim() ? entry.meta.trim() : null,
    text,
    severity: entry.severity === 'error' ? 'error' : null,
    ...(Number.isFinite(entry.afterHistoryIndex) ? { afterHistoryIndex: Number(entry.afterHistoryIndex) } : {}),
  };
}

async function resolveReportForResponse(
  reportStore: FileReportStore,
  inputPath: string,
  response: ServerResponse,
): Promise<CodexWebReport | null> {
  return readReportForResponse(() => reportStore.resolveReport(inputPath), response);
}

async function readReportContentForResponse(
  reportStore: FileReportStore,
  reportId: string,
  response: ServerResponse,
): Promise<{ report: CodexWebReport; content: string } | null> {
  try {
    const content = await reportStore.readContent(reportId);
    if (!content) {
      writeReportNotFound(response);
      return null;
    }
    return content;
  } catch (error) {
    if (isInvalidReportPathError(error)) {
      writeInvalidReportPath(response, error);
      return null;
    }
    throw error;
  }
}

async function readReportForResponse(
  read: () => Promise<CodexWebReport | null>,
  response: ServerResponse,
): Promise<CodexWebReport | null> {
  try {
    const report = await read();
    if (!report) {
      writeReportNotFound(response);
      return null;
    }
    return report;
  } catch (error) {
    if (isInvalidReportPathError(error)) {
      writeInvalidReportPath(response, error);
      return null;
    }
    throw error;
  }
}

function writeReportNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: 'report_not_found',
    message: 'Selected report was not found.',
  });
}

function writeInvalidReportPath(response: ServerResponse, error: unknown): void {
  writeJson(response, 400, {
    error: 'invalid_report_path',
    message: error instanceof Error ? error.message : 'Invalid report path.',
  });
}

function isInvalidReportPathError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid report id|outside the reports directory|markdown or html/u.test(message);
}

function isSessionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown session/i.test(message)
    || /thread not found/i.test(message)
    || /session not found/i.test(message)
    || /unknown thread/i.test(message);
}

function isTurnConflictError(error: unknown): boolean {
  return error instanceof Error
    && (error as Error & { code?: string }).code === 'turn_conflict';
}

function extractActiveTurnId(error: unknown): string | null {
  const activeTurnId = error instanceof Error
    ? (error as Error & { activeTurnId?: unknown }).activeTurnId
    : null;
  return typeof activeTurnId === 'string' && activeTurnId.trim()
    ? activeTurnId.trim()
    : null;
}

function extractBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/iu);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

async function streamTurnEvents({
  request,
  response,
  runtime,
  turnId,
  afterId,
  registerSseCloser,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  runtime: CodexWebRuntime;
  turnId: string;
  afterId?: string | number | null;
  registerSseCloser: (close: () => void) => () => void;
}): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
  });

  const writeEvent = (entry: CodexWebStoredEvent) => {
    response.write(`id: ${entry.sequence}\n`);
    response.write('event: message\n');
    response.write(`data: ${JSON.stringify(entry.event)}\n\n`);
  };

  for (const entry of runtime.getTurnEvents(turnId, afterId)) {
    writeEvent(entry);
  }

  const unsubscribe = runtime.subscribeToTurn(turnId, writeEvent);
  const heartbeat = setInterval(() => {
    response.write(': keepalive\n\n');
  }, 15_000);
  let closed = false;
  let unregisterForcedClose: (() => void) | null = null;

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    unregisterForcedClose?.();
    unregisterForcedClose = null;
    if (!response.writableEnded && !response.destroyed) {
      response.end();
    }
  };

  unregisterForcedClose = registerSseCloser(() => {
    cleanup();
    request.socket.destroy();
  });

  request.once('close', cleanup);
  request.once('aborted', cleanup);
  response.once('close', cleanup);
  response.once('error', cleanup);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
  }
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw createHttpError(413, 'payload_too_large', 'Request body is too large.');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createHttpError(400, 'invalid_json', 'Request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isHttpError(error)) {
      throw error;
    }
    throw createHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function normalizeLastEventId(
  queryAfter: string | null,
  headerValue: string | string[] | undefined,
): string | number | null {
  if (queryAfter && queryAfter.trim()) {
    return queryAfter.trim();
  }
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue)) {
    const first = headerValue.find((value) => value.trim());
    return first?.trim() ?? null;
  }
  return null;
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

interface HttpError extends Error {
  statusCode: number;
  code: string;
}

function createHttpError(statusCode: number, code: string, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error
    && Number.isInteger((error as Partial<HttpError>).statusCode)
    && typeof (error as Partial<HttpError>).code === 'string';
}

function writeErrorResponse({
  request,
  response,
  error,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  error: unknown;
}): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  if (isHttpError(error)) {
    writeRequestLog({
      level: error.statusCode >= 500 ? 'error' : 'warn',
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      status: error.statusCode,
      code: error.code,
      message: error.message,
    });
    writeJson(response, error.statusCode, {
      error: error.code,
      message: error.message,
    });
    return;
  }
  writeRequestLog({
    level: 'error',
    method: request.method ?? 'GET',
    path: request.url ?? '/',
    status: 500,
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
  });
  writeJson(response, 500, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function writeRequestLog({
  level,
  method,
  path,
  status,
  code,
  message,
}: {
  level: 'warn' | 'error';
  method: string;
  path: string;
  status: number;
  code: string;
  message: string;
}): void {
  const safePath = path.split('?')[0] || '/';
  const payload = {
    ts: new Date().toISOString(),
    level,
    method,
    path: safePath,
    status,
    code,
    message,
  };
  process.stderr.write(`[codex-web] ${JSON.stringify(payload)}\n`);
}

function writeSetupRequiredJson(response: ServerResponse): void {
  writeJson(response, 503, {
    error: 'setup_required',
    message: SETUP_REQUIRED_MESSAGE,
  });
}

function writeSetupRequiredPage(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Web Setup Required</title>
</head>
<body>
  <main>
    <h1>Setup required</h1>
    <p>${SETUP_REQUIRED_MESSAGE}</p>
    <pre><code>codex-web auth set-password</code></pre>
  </main>
</body>
</html>
`);
}
