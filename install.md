---
ai_entrypoint: true
title: Codex Mobile Web App AI Install Guide
supported_platforms:
  automated:
    - macOS
  manual:
    - Linux
unsupported_platforms:
  - Windows
primary_script: scripts/install/install-codex-web-macos.sh
required_questions:
  - password
  - autostart
---

# Codex Mobile Web App Install

This file is the AI install entrypoint for this repository.

If a user shares a GitHub `README.md` or `install.md` blob URL such as:

- `https://github.com/<owner>/<repo>/blob/<ref>/README.md`
- `https://github.com/<owner>/<repo>/blob/<ref>/install.md`

the agent should derive the repository root from the URL, clone or update the
repository locally, then execute the install flow in this file from the repo
root.

If a user says "help me install this project" from inside a local checkout, the
agent should locate the repo root and use this `install.md` instead of trying to
infer steps from `README.md`.

## Platform Gate

- macOS: supported for automated install.
- Linux: use the manual setup in `README.md`.
- Windows: unsupported for this automated install flow.

If the host is Windows, stop after explaining that automated install is
unsupported and do not attempt to translate the steps.

## Questions The Agent Must Ask

Ask the user these two questions before running the installer:

1. What password should Codex Web use?
2. Should it be installed as a macOS login/startup service?

The password may be passed to the installer directly because this repository is
explicitly optimized for personal/internal use rather than a hardened shared
deployment flow.

## macOS Automated Install

From the repo root, run:

```bash
scripts/install/install-codex-web-macos.sh --password '<user-password>' --autostart yes
```

or:

```bash
scripts/install/install-codex-web-macos.sh --password '<user-password>' --autostart no
```

The installer script will:

- run `npm install`
- write the password via `npm run codex-web -- auth set-password`
- install or skip launchd based on `--autostart`
- start the service
- print the local and LAN URLs when available

## Install The Report Skill

After the macOS installer succeeds, the agent should also install the bundled
report skill from:

```text
skills/codex-mobile-report
```

Run:

```bash
mkdir -p ~/.codex/skills
mkdir -p ~/.codex/skills/codex-mobile-report
cp -R skills/codex-mobile-report/. ~/.codex/skills/codex-mobile-report/
```

If the user plans to keep editing this repository locally, the agent may use a
symlink instead:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/codex-mobile-report" ~/.codex/skills/codex-mobile-report
```

## How To Use After Install

After installation, the agent should explain the basic usage flow:

1. Open the printed local URL on the Mac, or the printed LAN URL on the phone.
2. Log in with the password that was set during install.
3. On iPhone or Android, follow `docs/pwa-setup.md` to add the app to the home
   screen.
4. In later Codex chats, the user can ask for a phone-readable report such as:
   `请用 codex-mobile-report 给我生成手机可读报告`
5. The report skill writes reports under:
   `~/.codex-web/reports/`
6. Codex Web lists those reports inside the mobile app.

## Post-Install Handoff

After the installer succeeds, point the user to:

- `README.md` for the normal project overview
- `README.zh-CN.md` for Chinese instructions
- `docs/pwa-setup.md` for mobile PWA installation on iPhone or Android
- `skills/codex-mobile-report` for phone-readable report generation
