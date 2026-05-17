# Codex Web MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first self-hosted mobile Codex web console in `packages/codex-web` while keeping Codex auth, execution, files, shell, and state on the Mac.

**Architecture:** A new Node HTTP package serves static mobile UI and authenticated JSON/SSE APIs. The backend stores password/session state in `~/.codex-web/auth.json`, uses `CodexAppClient` from `packages/codex-native-api` for local Codex app-server integration, and keeps tunnel setup outside the repo.

**Tech Stack:** Node.js >=24, TypeScript NodeNext, built-in `http`, `node:test`, static HTML/CSS/JS, `@codex-mobile-web-app/codex-native-api`.

---

## Current Constraints

- The current working directory is not a Git repository. `git status`, worktree creation, and `git commit` fail with `fatal: not a git repository`.
- Do not modify or depend on `../CodexBridge-main`.
- Some RED tests and partial implementation files already exist in `packages/codex-web`:
  - `package.json`, `tsconfig.json`
  - tests for auth/config/events/server auth
  - partial `auth_store.ts`, `config.ts`, `event_model.ts`
  - `packages/codex-native-api/src/index.ts` partially exports `CodexAppClient`
- `npm run test --workspace packages/codex-web` may require escalation because `tsx` creates a local IPC pipe under `/var/folders/.../T`.

## File Structure

- `packages/codex-web/src/auth_store.ts`: password hashing, token hashing, login/logout/session verification.
- `packages/codex-web/src/config.ts`: defaults and `~/.config/codex-web/service.env` parsing.
- `packages/codex-web/src/event_model.ts`: Codex provider event to UI event normalization.
- `packages/codex-web/src/runtime.ts`: `CodexAppClient` wrapper for sessions, turns, approvals, models, usage, stop.
- `packages/codex-web/src/event_bus.ts`: in-memory turn event history and SSE subscriber delivery.
- `packages/codex-web/src/server.ts`: HTTP routing, auth middleware, JSON helpers, static serving, SSE route.
- `packages/codex-web/src/cli.ts`: `serve` and `auth set-password` commands.
- `packages/codex-web/src/index.ts`: public exports.
- `packages/codex-web/public/index.html`, `styles.css`, `app.js`: mobile dark task-console UI.
- `scripts/service/*codex-web-launchd-user.sh`: install/status/restart/logs launchd service scripts.
- Root `package.json`: include `codex-web` in build/typecheck/test scripts.
- `README.md`: add first-run and service instructions.

## Task 1: Auth, Config, And Event Model

**Files:**
- Finish: `packages/codex-web/src/auth_store.ts`
- Finish: `packages/codex-web/src/config.ts`
- Finish: `packages/codex-web/src/event_model.ts`
- Keep tests: `packages/codex-web/test/auth_store.test.ts`
- Keep tests: `packages/codex-web/test/config.test.ts`
- Keep tests: `packages/codex-web/test/events.test.ts`
- Modify if needed: `packages/codex-native-api/src/index.ts`

- [ ] **Step 1: Run existing focused tests to verify RED**

Run: `npm run test --workspace packages/codex-web`

Expected: tests fail only because implementation is incomplete or TypeScript exports are missing. If the sandbox blocks `tsx` IPC with `EPERM`, rerun the same command with escalation.

- [ ] **Step 2: Complete auth store implementation**

Ensure `AuthStore` supports:
- `setPassword(password)` writing salted PBKDF2 hash only.
- `login({ password, deviceName })` rejects with a setup-required error until a password has been explicitly configured.
- `login({ password, deviceName })` returns opaque token prefixed `cw_`, stores only SHA-256 token hash.
- `verifyToken(token)` returns public session and updates `lastSeenAt`.
- `logout(token)` deletes only matching session.
- State file path is caller-provided and writes mode `0600`.

- [ ] **Step 3: Complete config implementation**

Ensure `loadServiceConfig()` defaults to:
- `host: "0.0.0.0"`
- `port: 43210`
- `stateDir: ~/.codex-web`
- `authPath: ~/.codex-web/auth.json`
- `envPath: ~/.config/codex-web/service.env`
- `defaultCwd: homeDir`

Parse `CODEX_WEB_HOST`, `CODEX_WEB_PORT`, `CODEX_WEB_DEFAULT_CWD`, `CODEX_REAL_BIN`, `CODEX_WEB_STATE_DIR`, and `CODEX_WEB_DEBUG`.

- [ ] **Step 4: Complete event normalization**

Implement UI event types from the design doc:
- `turn.started`
- `assistant.delta`
- `assistant.final`
- `batch.started`
- `batch.updated`
- `batch.completed`
- `approval.requested`
- `approval.resolved`
- `turn.completed`
- `turn.failed`

Preserve raw provider payloads on emitted events.

- [ ] **Step 5: Verify GREEN for this task**

Run: `npm run test --workspace packages/codex-web`

Expected: auth/config/events tests pass. Server test may still fail until Task 2.

## Task 2: Runtime Adapter And Authenticated HTTP/SSE Server

**Files:**
- Create: `packages/codex-web/src/runtime.ts`
- Create: `packages/codex-web/src/event_bus.ts`
- Create/finish: `packages/codex-web/src/server.ts`
- Create: `packages/codex-web/src/index.ts`
- Modify tests: add or extend `packages/codex-web/test/server_auth.test.ts`
- Add focused runtime/event-bus tests if useful.

- [ ] **Step 1: Write/extend failing server tests**

Test these behaviors:
- `/api/health` rejects missing bearer token with 401.
- `/api/health` accepts valid bearer token.
- `GET /api/turns/:turnId/events` rejects missing token.
- `POST /api/auth/login` does not require bearer token.
- Static `/` is public.

- [ ] **Step 2: Implement `CodexWebEventBus`**

Provide:
- `append(turnId, event)`
- `list(turnId, afterId?)`
- `subscribe(turnId, listener)` returning unsubscribe function

Use in-memory bounded event history per turn.

- [ ] **Step 3: Implement `CodexWebRuntime`**

Wrap `CodexAppClient` directly:
- Construct with `codexBin`, `defaultCwd`, optional injected client for tests.
- `listModels()`, `readUsage()`, `listSessions()`, `createSession()`, `readSession()`, `updateSessionSettings()`.
- `startTurn(sessionId, input)` starts/resumes thread, emits normalized events to event bus, handles progress and approval callbacks.
- `interruptTurn(turnId)`.
- `resolveApproval(approvalId, decision)` maps `accept`, `accept_for_session`, `deny` to Codex options `1`, `2`, `3`.

Keep Codex auth/token server-side only.

- [ ] **Step 4: Implement `createCodexWebServer`**

Routes:
- Public static: `/`, `/app.js`, `/styles.css`.
- Public auth: `POST /api/auth/login`.
- Authenticated: all other `/api/*`, including SSE.
- `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/health`, `GET /api/models`, `GET /api/usage`.
- `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:sessionId`, `PATCH /api/sessions/:sessionId/settings`.
- `POST /api/sessions/:sessionId/turns`.
- `GET /api/turns/:turnId/events` as SSE.
- `POST /api/turns/:turnId/interrupt`.
- `POST /api/approvals/:approvalId/accept`, `accept-for-session`, `deny`.

- [ ] **Step 5: Verify GREEN for server tests**

Run: `npm run test --workspace packages/codex-web`

Expected: all `packages/codex-web/test/*.test.ts` pass.

## Task 3: Mobile UI

**Files:**
- Create: `packages/codex-web/public/index.html`
- Create: `packages/codex-web/public/styles.css`
- Create: `packages/codex-web/public/app.js`
- Modify if needed: `packages/codex-web/src/server.ts`

- [ ] **Step 1: Build static app shell**

Create dark, compact mobile UI matching `docs/assets/codex-web-reference.jpg` direction:
- Login page.
- Main chat/task page.
- Top app bar with workspace/status.
- Scrollable timeline.
- Bottom fixed composer.
- Model select, reasoning select, Plan/default toggle.
- Send/Stop same action slot.

- [ ] **Step 2: Implement browser auth flow**

Use `localStorage` only for opaque `codexWebToken`.
- On load call `GET /api/auth/me`.
- On invalid token clear localStorage and show login.
- Login posts password and device name to `/api/auth/login`.

- [ ] **Step 3: Implement live turn UI**

Implement:
- `POST /api/sessions` when needed.
- `POST /api/sessions/:sessionId/turns`.
- `EventSource` to `/api/turns/:turnId/events?token=...` because native EventSource cannot set Authorization headers.
- Render assistant deltas/final, turn state, batches, approvals.
- Approval buttons call the three approval endpoints with bearer auth.
- Stop calls interrupt endpoint.

- [ ] **Step 4: Keep UI operational, not marketing**

No landing page, no decorative cards inside cards, no Codex credentials exposed in JS.

## Task 4: CLI, Scripts, Docs, And Workspace Commands

**Files:**
- Create: `packages/codex-web/src/cli.ts`
- Create: `scripts/service/install-codex-web-launchd-user.sh`
- Create: `scripts/service/status-codex-web-launchd-user.sh`
- Create: `scripts/service/restart-codex-web-launchd-user.sh`
- Create: `scripts/service/logs-codex-web-launchd-user.sh`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Implement CLI**

Support:
- `codex-web serve [--host HOST] [--port PORT]`
- `codex-web auth set-password`

`serve` loads `~/.config/codex-web/service.env`, creates state/log directories, starts HTTP server. It should accept `CODEX_WEB_PASSWORD` once for first-run setup but must not write plaintext password to env files.

- [ ] **Step 2: Implement launchd scripts**

`install` writes `~/Library/LaunchAgents/com.ganxing.codex-web.plist` with:
- `RunAtLoad=true`
- `KeepAlive=true`
- repo root working directory
- logs under `~/.codex-web/logs/`
- environment values from `~/.config/codex-web/service.env` via shell wrapper command

`status`, `restart`, and `logs` should operate on that label.

- [ ] **Step 3: Update root workspace scripts**

Root commands should include both packages:
- `npm run build`
- `npm run typecheck`
- `npm test`

- [ ] **Step 4: Update README**

Document:
- first run password setup
- default host/port
- external tunnel boundary
- launchd scripts
- no plaintext password storage

## Task 5: Verification And Handoff

**Files:**
- No new files expected.

- [ ] **Step 1: Run focused tests**

Run: `npm run test --workspace packages/codex-web`

Expected: 0 failures.

- [ ] **Step 2: Run imported core tests**

Run: `npm run test --workspace packages/codex-native-api`

Expected: 0 failures.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: TypeScript exits 0.

- [ ] **Step 4: Check git status**

Run: `git status --short`

Expected in this environment: likely fails because the directory is not a Git repository. Report this explicitly instead of claiming commits were created.

- [ ] **Step 5: Final review checklist**

Confirm:
- No plaintext password in repo or service env.
- No unauthenticated `/api/*` except `POST /api/auth/login`.
- Static UI only stores opaque token.
- Default host is `0.0.0.0`.
- Tunnel setup is not implemented.
- No dependency on `../CodexBridge-main`.
