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

## Post-Install Handoff

After the installer succeeds, point the user to:

- `README.md` for the normal project overview
- `README.zh-CN.md` for Chinese instructions
- `docs/pwa-setup.md` for mobile PWA installation on iPhone or Android
