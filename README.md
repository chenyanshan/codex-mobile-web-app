# Codex Mobile Web App

English | [中文](README.zh-CN.md)

Self-hosted mobile web console for controlling a local logged-in Codex runtime.

The phone is only the remote UI. The Mac or Linux host keeps the Codex login,
starts the Codex runtime, reads and writes local project files, executes shell
commands, and stores app state. Remote access through a tunnel or reverse proxy
is intentionally outside this repository.

## Current State

This repository was split out from `CodexBridge-main`.

Imported reusable Codex integration:

```text
packages/codex-native-api
```

Mobile web service:

```text
packages/codex-web
```

Project design docs:

```text
docs/superpowers/specs/2026-05-17-codex-mobile-web-app-design.md
docs/superpowers/specs/2026-05-19-codex-mobile-reports-design.md
```

Visual reference:

```text
docs/assets/codex-web-reference.jpg
```

## AI Install

If you want Codex or another agent to install this project for you, use the
root [`install.md`](install.md). That file is the AI install entrypoint for both
GitHub blob links and local checkouts.

Expected agent behavior:

- The user can say this directly in a Codex chat:
  `Help me install https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`
- The user can also say:
  `Help me install this project`
- If the user shares a GitHub `README.md` or `install.md` blob link, derive the
  repo root and follow `install.md`.
- If the user says "help me install this project" from inside a local checkout,
  find the repo root and follow `install.md`.
- On macOS, the automated flow should ask for a password and whether launchd
  autostart should be installed.
- On Windows, the automated flow should stop and report that this repository
  does not provide a Windows installer.

## Requirements

- Node.js `>=24`
- npm
- local Codex CLI installed
- local Codex login at `~/.codex/auth.json` or `CODEX_HOME/auth.json`

## Install Dependencies

```bash
npm install
```

Check both workspaces:

```bash
npm run typecheck
npm test
```

## Automated macOS Install

For the AI-guided install flow, the repo provides:

```text
install.md
scripts/install/install-codex-web-macos.sh
```

The installer script handles dependency install, password setup, service start,
and optional launchd autostart. The detailed AI-oriented flow lives in
[`install.md`](install.md).

Typical Codex chat flow:

1. The user says `Help me install https://github.com/chenyanshan/codex-mobile-web-app/blob/main/README.md`
2. Codex resolves the repo root and reads `install.md`
3. Codex asks for:
   the password
   whether launchd autostart should be installed
4. Codex runs the installer script on macOS

## Install The Report Skill

This repo includes the report companion skill at:

```text
skills/codex-mobile-report
```

Install it into your local Codex skills directory:

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-mobile-report
cp -R skills/codex-mobile-report/. ~/.codex/skills/codex-mobile-report/
```

For active development, use a symlink instead so local edits are picked up:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-mobile-report" ~/.codex/skills/codex-mobile-report
```

The skill writes phone-readable Markdown or self-contained HTML reports under:

```text
~/.codex-web/reports/
```

Codex Web exposes those reports through authenticated APIs and renders report
links in the mobile app.

## Codex Web Setup

The web service lives in `packages/codex-web`. By default it binds to
`0.0.0.0:43210` so phones on the same network can reach the host, while all
runtime state stays outside the repo.

Default paths:

```text
~/.config/codex-web/service.env
~/.codex-web/auth.json
~/.codex-web/logs/
~/.codex-web/reports/
~/.codex-web/report-index.json
```

`~/.codex-web/auth.json` stores only the salted password hash and hashed session
tokens. The browser stores only an opaque session token. Do not store
`CODEX_WEB_PASSWORD` in `service.env`.

Set the password once:

```bash
npm run codex-web -- auth set-password
```

For non-interactive automation, a one-time environment variable is supported.
Avoid putting real passwords in committed scripts, env files, or shared shell
history:

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
`~/.config/codex-web/service.env`. To restrict the service to this machine only:

```env
CODEX_WEB_HOST=127.0.0.1
```

## macOS Install

Install the user LaunchAgent:

```bash
scripts/service/install-codex-web-launchd-user.sh
```

This writes `~/Library/LaunchAgents/com.ganxing.codex-web.plist`, creates
`~/.config/codex-web/service.env` if needed, uses the repo root as the working
directory, and writes logs under `~/.codex-web/logs/`.

Service helpers:

```bash
scripts/service/status-codex-web-launchd-user.sh
scripts/service/restart-codex-web-launchd-user.sh
scripts/service/logs-codex-web-launchd-user.sh
```

The LaunchAgent uses `/bin/zsh -lc` to source
`~/.config/codex-web/service.env` and run:

```bash
npm run serve --workspace packages/codex-web
```

## Linux Install

On Linux, run Codex Web as a user `systemd` service.

Create the service environment file:

```bash
mkdir -p ~/.config/codex-web ~/.codex-web/logs
cat > ~/.config/codex-web/service.env <<EOF
CODEX_WEB_HOST=0.0.0.0
CODEX_WEB_PORT=43210
CODEX_WEB_DEFAULT_CWD=$(pwd)
CODEX_REAL_BIN=codex
CODEX_WEB_DEBUG=0
EOF
chmod 600 ~/.config/codex-web/service.env
```

Create the user service:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/codex-web.service <<EOF
[Unit]
Description=Codex Web mobile console
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=%h/.config/codex-web/service.env
ExecStart=/usr/bin/env npm run serve --workspace packages/codex-web
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
```

Enable and start the service:

```bash
systemctl --user daemon-reload
systemctl --user enable --now codex-web.service
systemctl --user status codex-web.service
```

Allow it to start after login sessions end if your distro supports lingering:

```bash
loginctl enable-linger "$USER"
```

Read logs:

```bash
journalctl --user -u codex-web.service -f
```

If your Linux firewall blocks LAN access, allow TCP port `43210` or change
`CODEX_WEB_PORT` in `~/.config/codex-web/service.env`.

## Install As PWA

After the server is running, open Codex Web from your phone browser and log in
once for that device.

On iPhone or iPad:

1. Open the app in Safari.
2. Tap `Share`.
3. Tap `Add to Home Screen`.
4. Launch the saved icon from the Home Screen.

On Android:

1. Open the app in Chrome.
2. Open the browser menu.
3. Tap `Install app` or `Add to Home screen`.
4. Launch the saved shortcut/app from the launcher.

More detailed phone install notes live in [`docs/pwa-setup.md`](docs/pwa-setup.md).

## Product Direction

The intended first product is a single-user mobile PWA:

- password-protected access
- persistent browser session token
- live Codex turn stream
- command and file-change batch cards
- approval controls
- model and reasoning controls
- reports list and authenticated report viewer
- macOS launchd and Linux systemd startup options

Tunnel and reverse-proxy setup stay outside this repository.
