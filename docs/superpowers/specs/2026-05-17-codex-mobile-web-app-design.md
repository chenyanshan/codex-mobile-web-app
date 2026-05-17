# Codex Mobile Web App Design

## Goal

Build a self-hosted mobile web app for controlling Codex from a phone while all
execution stays on the current Mac.

The phone is only the UI. The Mac keeps the Codex login, starts the Codex
runtime, reads and writes local project files, executes shell commands, and
stores app state. Remote access is handled outside this project by the user's
chosen tunnel or reverse proxy.

## Non-Goals

- Do not turn this into a hosted multi-user SaaS.
- Do not move Codex credentials or file execution to the phone.
- Do not make tunnel setup part of this project.
- Do not replace the existing WeChat bridge.
- Do not base the mobile UI on WeChat slash-command behavior.

## Recommended Architecture

Add a new Codex Web service beside the current WeChat bridge:

```text
phone browser / PWA
  -> Codex Web HTTP API + SSE/WebSocket stream
  -> Codex Web backend
  -> CodexAppClient
  -> local codex app-server
  -> local Codex auth under CODEX_HOME or ~/.codex
```

The web service should be separate from `BridgeCoordinator` and
`WeixinBridgeRuntime`. Those modules are useful references, but their command
surface and delivery behavior are optimized for chat platforms. The mobile app
needs native UI events for turns, command batches, file-change batches,
approvals, and model/session controls.

The backend should reuse the existing lower-level Codex integration:

- `packages/codex-native-api/src/codex_app_client.ts`
- `packages/codex-native-api/src/native_runtime.ts` where useful
- `packages/codex-native-api/src/auth_state.ts`
- `src/providers/codex/config.ts` or an extracted equivalent

The existing `packages/codex-native-api` OpenAI-compatible `/v1/*` API is a
good base for health, models, and local Codex runtime startup, but it is not
enough by itself for the target UI because the UI needs richer live turn
events than generic Responses API output.

## First-Version Scope

The first version is a single-user mobile Codex console:

- Password-protected web app
- Persistent browser login on each device
- New turn from prompt input
- Live turn status and final answer
- Model selector
- Reasoning effort selector
- Plan/default mode selector
- Current working directory display and editable default cwd
- Approval cards for command/file/permission requests
- Stop current turn
- Basic thread/session list
- Basic service status and logs link text
- launchd user service install/start/restart/status/log scripts for macOS

The first version may show command and file-change events as coarse cards if
the app-server notification payload does not yet expose stable diff detail.
The UI should preserve raw event metadata so richer cards can be added without
changing the backend contract.

## Authentication

Use a simple password plus persistent per-device session token.

Server state lives outside the repo:

```text
~/.codex-web/auth.json
```

The file stores password and session data without plaintext secrets:

```json
{
  "passwordHash": "...",
  "passwordSalt": "...",
  "sessions": [
    {
      "id": "...",
      "tokenHash": "...",
      "deviceName": "iPhone Safari",
      "createdAt": "2026-05-17T00:00:00.000Z",
      "lastSeenAt": "2026-05-17T00:00:00.000Z"
    }
  ]
}
```

The browser stores only the opaque session token in localStorage. It does not
store the plaintext password.

Authentication flow:

1. Unauthenticated browser loads login page.
2. Browser sends password to `POST /api/auth/login`.
3. Server verifies the password hash.
4. Server creates a random session token and stores only its hash.
5. Browser stores the token in localStorage.
6. Future API calls send `Authorization: Bearer <token>`.
7. Browser calls `GET /api/auth/me` on app load to restore the session.

Logout deletes only the current session:

```text
POST /api/auth/logout
```

Changing phones or clearing browser storage requires entering the password
again. Other users who open the tunnel URL also need the password.

If no password has been configured, the service should not expose the app. It
should show a setup-required page and the CLI should print a clear command:

```bash
codex-web auth set-password
```

An optional first-run initializer may accept `CODEX_WEB_PASSWORD`, hash it,
write the auth file, then clear the value from process memory. The password
must not be written to service env files as plaintext.

## Network Binding And Tunnel Boundary

Default binding is LAN-facing so phones on the same network can reach the Mac:

```bash
codex-web serve --host 0.0.0.0 --port 43210
```

Local-only binding remains supported through configuration:

```bash
codex-web serve --host 127.0.0.1 --port 43210
```

The service must require authentication for every non-static API route. Static
HTML/JS/CSS can be served without a token, but the app data routes and event
streams must reject unauthenticated requests.

The project does not configure Cloudflare Tunnel, Tailscale, frp, ngrok, or any
other tunnel. The user can point any tunnel at the service port.

## macOS launchd Service

Add macOS user-service scripts similar to the existing WeChat bridge scripts:

```text
scripts/service/install-codex-web-launchd-user.sh
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/logs-codex-web-launchd-user.sh
```

The generated plist should live at:

```text
~/Library/LaunchAgents/com.ganxing.codex-web.plist
```

It should use:

- `RunAtLoad=true`
- `KeepAlive=true`
- repo root as working directory
- a stable environment file
- stdout/stderr logs under `~/.codex-web/logs/`

Suggested environment file:

```text
~/.config/codex-web/service.env
```

Suggested state directory:

```text
~/.codex-web/
```

Config values:

```env
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=/Users/chenyanshan/Documents/vibecoding/temp
CODEX_REAL_BIN=/opt/homebrew/bin/codex
CODEX_WEB_DEBUG=0
```

If the user wants to restrict access to the Mac only, they edit:

```env
CODEX_WEB_HOST=127.0.0.1
```

and restart the service.

## Backend API

Initial API shape:

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

GET  /api/health
GET  /api/models
GET  /api/usage

GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:sessionId
PATCH /api/sessions/:sessionId/settings

POST /api/sessions/:sessionId/turns
GET  /api/turns/:turnId/events
POST /api/turns/:turnId/interrupt

POST /api/approvals/:approvalId/accept
POST /api/approvals/:approvalId/accept-for-session
POST /api/approvals/:approvalId/deny
```

The event endpoint can start as SSE because it is simple and works well through
most reverse proxies. WebSocket can be added later if bidirectional live input
becomes necessary.

## Event Model

Normalize Codex app-server notifications into UI-friendly events:

```ts
type CodexWebEvent =
  | { type: 'turn.started'; turnId: string; threadId: string }
  | { type: 'assistant.delta'; turnId: string; text: string; phase: string | null }
  | { type: 'assistant.final'; turnId: string; text: string }
  | { type: 'batch.started'; turnId: string; batchId: string; kind: 'command' | 'file_change' | 'permission' | 'unknown'; title: string }
  | { type: 'batch.updated'; turnId: string; batchId: string; summary: Record<string, unknown> }
  | { type: 'batch.completed'; turnId: string; batchId: string; status: string }
  | { type: 'approval.requested'; turnId: string; approvalId: string; approvalKind: string; summary: Record<string, unknown> }
  | { type: 'approval.resolved'; turnId: string; approvalId: string; decision: 'accepted' | 'accepted_for_session' | 'denied' }
  | { type: 'turn.completed'; turnId: string; status: string }
  | { type: 'turn.failed'; turnId: string; message: string };
```

Store raw Codex notification payloads on each event during the first version.
That keeps the public app contract stable while allowing better UI cards as the
project learns which notifications are stable.

## Frontend UX

The first screen should be the actual Codex console, not a landing page.

Mobile layout:

- Top app bar with menu, current workspace, connection status
- Scrollable turn timeline
- Assistant message blocks
- Batch cards for commands and file changes
- Approval cards with accept, accept for session, and deny actions
- Bottom composer fixed to the viewport bottom
- Model chip, reasoning-effort chip, plan/default toggle
- Send and stop button occupying the same action slot depending on turn state

The UI should be dense and operational rather than decorative. The reference
image uses compact dark cards, small status chips, and collapsible batches; the
implementation should follow that direction without copying any private visual
assets.

## Error Handling

- If Codex CLI is missing, show a setup error with the resolved `CODEX_REAL_BIN`.
- If Codex auth is missing, show a local login-required error.
- If the app-server exits, mark active turns failed and surface a reconnect
  action.
- If an event stream disconnects, the client should reconnect and request
  missed events by last event id.
- If a session token is invalid, clear localStorage and return to login.
- If no password exists, block all app API routes except setup status.

## Testing

Backend tests:

- password hash and token session persistence
- auth middleware rejects missing/invalid tokens
- login creates a reusable token and stores only its hash
- logout removes only the current session
- service config defaults to LAN-facing host
- local-only bind remains configurable
- event normalization for assistant deltas, approvals, command batches, and file-change batches

Frontend tests:

- login restore from localStorage token
- login fallback when token is rejected
- composer starts a turn
- event stream renders assistant text and batch cards
- approval buttons call the correct API
- stop button interrupts the active turn

Operational verification:

- run typecheck
- run focused backend tests
- run frontend build
- install launchd service
- verify `launchctl print gui/$UID/com.ganxing.codex-web` reports `state = running`
- verify mobile or browser can open the app through the configured host/port

## Open Questions

The current design assumes:

- single-user self-hosted use
- one password shared by all trusted devices
- macOS launchd is the first service target
- tunnel setup is external
- first version can use SSE instead of WebSocket

These assumptions should be revisited only after the first working mobile app
is in use.
