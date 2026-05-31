# Codex Web Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the project-first desktop/mobile workspace redesign with a three-pane desktop shell, drawer-based mobile navigation, and a dedicated full-screen admin console.

**Architecture:** Extend the existing `public/app.js` state machine instead of introducing a new routing layer. Add project-selection and workspace-shell state, update rendering helpers to split desktop into project rail + session pane + workspace pane, and keep mobile on a single-column flow backed by the same project model.

**Tech Stack:** Vanilla ES modules, DOM-string rendering in `packages/codex-web/public/app.js`, CSS in `packages/codex-web/public/styles.css`, Node `node:test` UI harness tests.

---

### Task 1: Lock UI Coverage With Tests

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts`
- Verify: `packages/codex-web/test/public_ui.test.ts`

- [ ] Add failing tests for the new desktop project rail, project filtering, desktop project-driven session opening, project-driven new-session fallback, mobile drawer navigation that returns to filtered session lists, Settings title controls, and admin full-screen isolation.
- [ ] Run the focused UI test file and confirm the new tests fail for the expected missing behavior.

### Task 2: Add Project-Scoped Workspace State

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Verify: `packages/codex-web/test/public_ui.test.ts`

- [ ] Add the minimum new state and helpers for unified project navigation, project filtering, and workspace-mode selection.
- [ ] Update session filtering and default-project selection helpers to respect the current project context.
- [ ] Re-run the focused UI tests and confirm the state-level tests now pass or fail only on rendering gaps.

### Task 3: Implement The Desktop Three-Pane Shell

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Verify: `packages/codex-web/test/public_ui.test.ts`

- [ ] Replace the current desktop sidebar shell with a project rail + session pane + workspace pane layout.
- [ ] Move `Sessions`, `Set`, and `Admin Console` into the first-column rail.
- [ ] Render `New` in the session pane topbar and keep `Admin Console` full-screen.
- [ ] Re-run focused UI tests and fix failing desktop assertions.

### Task 4: Bring Mobile Into The Same Information Architecture

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`
- Verify: `packages/codex-web/test/public_ui.test.ts`

- [ ] Add the mobile project drawer, keep project switches on the filtered session list, and expose a full-size drawer trigger.
- [ ] Preserve chat navigation, pull-to-refresh, and admin full-screen behavior.
- [ ] Re-run focused UI tests and fix failing mobile assertions.

### Task 5: Verify The Full Frontend Surface

**Files:**
- Verify: `packages/codex-web/test/public_ui.test.ts`
- Verify: `packages/codex-web/package.json`

- [ ] Run the focused public UI test suite.
- [ ] Run `npm run typecheck` from `packages/codex-web`.
- [ ] Fix any regressions and re-run verification until both commands pass.
