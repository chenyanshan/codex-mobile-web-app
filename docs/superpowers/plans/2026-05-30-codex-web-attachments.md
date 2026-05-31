# Codex Web Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated file/image upload support and attach uploaded files to the next Codex turn.

**Architecture:** The server stores uploaded files under the session project when possible, falls back to the Codex Web state directory, and returns attachment metadata. The runtime converts attachments into Codex `input` items, with text metadata for all files and `localImage` for images. The vanilla frontend manages a composer attachment tray and includes uploaded attachments with the turn request.

**Tech Stack:** Node HTTP server, TypeScript, `node:test`, vanilla browser JavaScript, CSS.

---

### Task 1: Server Upload API

**Files:**
- Modify: `packages/codex-web/src/config.ts`
- Modify: `packages/codex-web/src/server.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`

- [ ] Write failing server tests for `POST /api/sessions/:sessionId/attachments`.
- [ ] Implement config upload directory fields.
- [ ] Implement multipart parsing with file-size limits.
- [ ] Implement project-local write with state-dir fallback.
- [ ] Return uploaded attachment metadata.
- [ ] Run the focused server tests.

### Task 2: Runtime Attachment Input

**Files:**
- Modify: `packages/codex-web/src/runtime.ts`
- Test: `packages/codex-web/test/runtime.test.ts`

- [ ] Write failing tests proving non-image files are listed in text and images add `localImage`.
- [ ] Add attachment types to `StartTurnInput` and runtime client call.
- [ ] Build Codex turn input from text plus attachments.
- [ ] Run focused runtime tests.

### Task 3: Composer UI

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] Write failing UI tests for attachment button/tray and turn payload attachment inclusion.
- [ ] Add attachment state, upload helpers, and composer rendering.
- [ ] Move `Set` from composer leading controls to chat topbar actions.
- [ ] Disable send while uploads are pending.
- [ ] Run focused public UI tests.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run `npm run typecheck`.
- [ ] Run focused changed-package tests.
- [ ] Report any remaining limitations.
