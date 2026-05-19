import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { Socket } from 'node:net';
import path from 'node:path';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import type { PublicAuthSession } from './auth_store.js';
import type { CodexWebConfig } from './config.js';
import type { CodexWebStoredEvent } from './event_bus.js';
import type {
  CodexWebRuntime,
  CreateSessionInput,
  StartTurnInput,
  UpdateSessionSettingsInput,
} from './runtime.js';

export interface CodexWebAuthLike {
  isConfigured(): Promise<boolean>;
  login(args: {
    password: string;
    deviceName?: string | null;
  }): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean }>;
  verifyToken(token: string | null | undefined): Promise<PublicAuthSession | null>;
  logout(token: string | null | undefined): Promise<void>;
}

export interface CreateCodexWebServerOptions {
  auth: CodexWebAuthLike;
  runtime: CodexWebRuntime;
  config: CodexWebConfig;
  staticFiles?: Record<string, { body: string | Buffer; contentType: string }>;
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

const SETUP_REQUIRED_MESSAGE = 'Password not configured. Run codex-web auth set-password.';
const MAX_JSON_BODY_BYTES = 64 * 1024;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT_PER_CLIENT = 10;
const LOGIN_RATE_LIMIT_GLOBAL = 100;

const DEFAULT_STATIC_FILES = loadDefaultStaticFiles();

export function createCodexWebServer({
  auth,
  runtime,
  config,
  staticFiles = DEFAULT_STATIC_FILES,
}: CreateCodexWebServerOptions): CodexWebServerHandle {
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
      staticFiles,
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

function loadDefaultStaticFiles(): Record<string, { body: string | Buffer; contentType: string }> {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const indexHtml = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  return {
    '/': {
      body: indexHtml,
      contentType: 'text/html; charset=utf-8',
    },
    '/index.html': {
      body: indexHtml,
      contentType: 'text/html; charset=utf-8',
    },
    '/app.js': {
      body: readFileSync(path.join(publicDir, 'app.js'), 'utf8'),
      contentType: 'application/javascript; charset=utf-8',
    },
    '/styles.css': {
      body: readFileSync(path.join(publicDir, 'styles.css'), 'utf8'),
      contentType: 'text/css; charset=utf-8',
    },
    '/pwa-pull-refresh.js': {
      body: readFileSync(path.join(publicDir, 'pwa-pull-refresh.js'), 'utf8'),
      contentType: 'application/javascript; charset=utf-8',
    },
    '/manifest.webmanifest': {
      body: readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'),
      contentType: 'application/manifest+json; charset=utf-8',
    },
    '/service-worker.js': {
      body: readFileSync(path.join(publicDir, 'service-worker.js'), 'utf8'),
      contentType: 'application/javascript; charset=utf-8',
    },
    '/icon-192.png': {
      body: readFileSync(path.join(publicDir, 'icon-192.png')),
      contentType: 'image/png',
    },
    '/icon-512.png': {
      body: readFileSync(path.join(publicDir, 'icon-512.png')),
      contentType: 'image/png',
    },
    '/apple-touch-icon.png': {
      body: readFileSync(path.join(publicDir, 'apple-touch-icon.png')),
      contentType: 'image/png',
    },
  };
}

async function handleRequest({
  request,
  response,
  auth,
  runtime,
  staticFiles,
  config,
  loginRateLimiter,
  registerSseCloser,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  auth: CodexWebAuthLike;
  runtime: CodexWebRuntime;
  staticFiles: Record<string, { body: string | Buffer; contentType: string }>;
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
    const asset = staticFiles[pathname];
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

  const authContext = await authenticateRequest({ auth, request });
  if (!authContext) {
    response.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'WWW-Authenticate': 'Bearer',
    });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
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

  const startTurnMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/u);
  if (startTurnMatch && method === 'POST') {
    const sessionId = decodeURIComponent(startTurnMatch[1]!);
    const body = await readJsonBody(request);
    if (typeof body.text !== 'string' || !body.text.trim()) {
      writeJson(response, 400, { error: 'text is required' });
      return;
    }
    const turn = await startSessionTurn({
      runtime,
      sessionId,
      input: body as unknown as StartTurnInput,
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

function getClientAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress || 'unknown';
}

async function loginWithPassword({
  auth,
  password,
  deviceName,
  response,
}: {
  auth: CodexWebAuthLike;
  password: string;
  deviceName: string | null;
  response: ServerResponse;
}): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean } | null> {
  try {
    return await auth.login({ password, deviceName });
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid password') {
      writeJson(response, 401, {
        error: 'invalid_password',
        message: 'Invalid password',
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
}): Promise<{ turnId: string } | null> {
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
    throw error;
  }
}

function writeSessionNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: 'session_not_found',
    message: 'Selected session was not found.',
  });
}

function isSessionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown session/i.test(message)
    || /thread not found/i.test(message)
    || /session not found/i.test(message)
    || /unknown thread/i.test(message);
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
