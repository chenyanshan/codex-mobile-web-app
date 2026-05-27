# Codex Web Multi-User RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-host multi-user facade with RBAC, admin audit/observer APIs, and read-only session sharing while keeping the Codex runtime single-user.

**Architecture:** Add identity/project/session/share metadata stores above `CodexWebRuntime`. Server routes authenticate into a principal, authorize app session ids, then call runtime with internal Codex thread ids. Runtime gains only thread lookup helpers for turn and approval ids; it does not learn users or roles.

**Tech Stack:** Node.js HTTP server, TypeScript, JSON file stores under `~/.codex-web`, Node test runner.

---

### Task 1: Identity Store And Access Control

**Files:**
- Create: `packages/codex-web/src/identity_store.ts`
- Create: `packages/codex-web/src/access_control.ts`
- Test: `packages/codex-web/test/identity_store.test.ts`

- [ ] Write tests for password hashing, role grants, direct user grants, session ownership, and share token hashing.
- [ ] Implement the file-backed identity store with atomic writes.
- [ ] Implement pure access-control helpers for project grants and session operations.
- [ ] Run `npm test --workspace packages/codex-web -- test/identity_store.test.ts`.

### Task 2: Hybrid Authentication

**Files:**
- Modify: `packages/codex-web/src/auth_store.ts`
- Create: `packages/codex-web/src/hybrid_auth_store.ts`
- Test: `packages/codex-web/test/hybrid_auth_store.test.ts`

- [ ] Extend public auth sessions with optional principal metadata.
- [ ] Add a hybrid auth store that delegates to legacy password auth in single-user mode and verifies username/password users in multi-user mode.
- [ ] Keep legacy tokens as local admin principals for bootstrap access.
- [ ] Run `npm test --workspace packages/codex-web -- test/auth_store.test.ts test/hybrid_auth_store.test.ts`.

### Task 3: Runtime Thread Guards

**Files:**
- Modify: `packages/codex-web/src/runtime.ts`
- Test: `packages/codex-web/test/runtime.test.ts`

- [ ] Add failing tests for `threadIdForTurn`, `threadIdForApproval`, and guarded interrupt/approval helpers.
- [ ] Implement the minimal runtime lookup helpers using existing maps.
- [ ] Run `npm test --workspace packages/codex-web -- test/runtime.test.ts`.

### Task 4: Server Multi-User Facade

**Files:**
- Modify: `packages/codex-web/src/server.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`

- [ ] Add tests that multi-user session list/read/create/write routes enforce owner and project grants.
- [ ] Add tests that ordinary users create sessions by `projectId` and see `projectDisplayName`, not cwd.
- [ ] Add tests that admin can list all sessions and observe any session read-only.
- [ ] Add tests that share links read without bearer auth.
- [ ] Implement app session route mapping and authorization.
- [ ] Run `npm test --workspace packages/codex-web -- test/server_auth.test.ts test/server_multi_user.test.ts`.

### Task 5: CLI Wiring And Exports

**Files:**
- Modify: `packages/codex-web/src/cli.ts`
- Modify: `packages/codex-web/src/index.ts`
- Test: `packages/codex-web/test/cli.test.ts`

- [ ] Wire the default service to `HybridAuthStore` and `FileIdentityStore`.
- [ ] Export new store and access-control types.
- [ ] Run `npm test --workspace packages/codex-web -- test/cli.test.ts`.

### Task 6: Verification

**Files:**
- No new files.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test --workspace packages/codex-web -- test/auth_store.test.ts test/hybrid_auth_store.test.ts test/identity_store.test.ts test/runtime.test.ts test/server_auth.test.ts test/server_multi_user.test.ts test/cli.test.ts`.
- [ ] Run `npm test`.

