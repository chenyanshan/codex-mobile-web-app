# Codex Mobile Web App

Self-hosted mobile web console for controlling a local logged-in Codex runtime.

The phone is only the UI. The Mac keeps the Codex login, starts the Codex
runtime, reads and writes local project files, executes shell commands, and
stores app state. Remote access is expected to be provided by an external tunnel
or reverse proxy.

## Current State

This repository has been split out from `CodexBridge-main` as a new project.
The first imported core is:

```text
packages/codex-native-api
```

That package contains the reusable local Codex integration:

- local Codex auth discovery
- `codex app-server` client
- localhost API facade
- native runtime and continuation support
- daemon/service-manager utilities

The first mobile web app service is implemented in:

```text
packages/codex-web
```

The approved direction is captured in:

```text
docs/superpowers/specs/2026-05-17-codex-mobile-web-app-design.md
```

The visual reference is stored at:

```text
docs/assets/codex-web-reference.jpg
```

## Development

Requirements:

- Node.js `>=24`
- npm
- local Codex CLI installed
- local Codex login at `~/.codex/auth.json` or `CODEX_HOME/auth.json`

Install dependencies:

```bash
npm install
```

Check both workspaces:

```bash
npm run typecheck
npm test
```

## Codex Web Setup

The first web service lives in `packages/codex-web`. By default it binds to
`0.0.0.0:43210` so phones on the same network can reach the Mac, and keeps all
runtime state outside the repo.

Default paths:

```text
~/.config/codex-web/service.env
~/.codex-web/auth.json
~/.codex-web/logs/
```

`~/.codex-web/auth.json` stores only the salted password hash and hashed session
tokens. The browser keeps only an opaque session token. Do not store
`CODEX_WEB_PASSWORD` in `service.env`.

Set the password once:

```bash
npm run codex-web -- auth set-password
```

For non-interactive automation, a one-time environment variable is also
supported. Avoid putting real passwords in committed scripts, env files, or
shared shell history:

```bash
CODEX_WEB_PASSWORD='choose-a-strong-password' npm run codex-web -- auth set-password
```

You can also bootstrap first run directly from the server process:

```bash
CODEX_WEB_PASSWORD='choose-a-strong-password' npm run serve
```

After the password is configured, start the web service:

```bash
npm run serve
```

If no password has been configured and you start the service without
`CODEX_WEB_PASSWORD`, the app serves a setup-required page until you run the
password command above.

The generated `~/.config/codex-web/service.env` defaults to:

```env
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=/Users/you/path/to/codex-mobile-web-app
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
```

Change host, port, default working directory, or Codex binary by editing
`~/.config/codex-web/service.env`. To restrict the service to this Mac only,
set:

```env
CODEX_WEB_HOST=127.0.0.1
```

Tunnel and reverse-proxy setup stay outside this repository.

## macOS launchd

Install the user LaunchAgent:

```bash
scripts/service/install-codex-web-launchd-user.sh
```

This writes `~/Library/LaunchAgents/com.ganxing.codex-web.plist`, creates
`~/.config/codex-web/service.env` if it does not exist, uses the repo root as
the LaunchAgent working directory, and writes logs under `~/.codex-web/logs/`.

Service helpers:

```bash
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/logs-codex-web-launchd-user.sh
```

The LaunchAgent uses `/bin/zsh -lc` to source `~/.config/codex-web/service.env`
and run `npm run serve --workspace packages/codex-web`, because launchd does
not source env files by itself.

## Product Direction

The intended first product is a single-user mobile PWA:

- password-protected access
- persistent browser session token
- live Codex turn stream
- command/file-change batch cards
- approval controls
- model and reasoning controls
- macOS launchd service for startup after user login

Tunnel setup is intentionally outside this repository.
