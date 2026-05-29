# Role Project New Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project assignment imply new-session permission and remove the admin `canNewSession` controls.

**Architecture:** Keep backward-compatible identity storage, but move create permission derivation to project grants instead of a dedicated user toggle. Update the admin UI and admin API callers to remove the obsolete control while keeping legacy state readable.

**Tech Stack:** Plain browser JS, TypeScript server modules, Node test suite

---

### Task 1: Lock the new behavior in tests

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts`
- Modify: `packages/codex-web/test/identity_store.test.ts`
- Modify: `packages/codex-web/test/server_multi_user.test.ts`

- [ ] **Step 1: Write failing UI assertions**

```ts
assert.doesNotMatch(html, /name="canNewSession" type="checkbox"/u);
assert.doesNotMatch(html, /name="userCanNewSession" type="checkbox"/u);
```

- [ ] **Step 2: Write failing permission assertions**

```ts
assert.deepEqual(effectiveProjectGrant(state, principal, 'project_one'), {
  projectId: 'project_one',
  canRead: true,
  canCreate: true,
  canWrite: true,
});
assert.equal(canCreateProjectSession(state, principal, 'project_one'), true);
```

- [ ] **Step 3: Write failing admin API payload assertions**

```ts
assert.deepEqual(JSON.parse(posts[2].options.body), {
  id: 'user_writer',
  username: 'writer',
  password: 'writer-password',
  enabled: true,
  roleId: 'role_writer',
  roleIds: ['role_writer'],
  directProjectGrants: [],
});
```

- [ ] **Step 4: Run focused tests and confirm failure**

Run: `npm test -- packages/codex-web/test/public_ui.test.ts packages/codex-web/test/identity_store.test.ts packages/codex-web/test/server_multi_user.test.ts`

Expected: failures mentioning removed `canNewSession` UI/API behavior and project grants still resolving `canCreate: false`.

### Task 2: Implement permission and API changes

**Files:**
- Modify: `packages/codex-web/src/access_control.ts`
- Modify: `packages/codex-web/src/server.ts`

- [ ] **Step 1: Make project grants imply create permission**

```ts
return {
  projectId,
  canRead: grants.some((grant) => grant.canRead === true || grant.canCreate === true || grant.canWrite === true),
  canCreate: grants.some((grant) => grant.canRead === true || grant.canCreate === true || grant.canWrite === true),
  canWrite: true,
};
```

- [ ] **Step 2: Normalize role project grants with create enabled**

```ts
return {
  projectId,
  canRead: true,
  canCreate: true,
  canWrite: true,
};
```

- [ ] **Step 3: Remove admin user API dependence on `canNewSession`**

```ts
writeJson(response, 200, { user: presentAdminUser(user) });
```

Implementation detail: stop threading `body.canNewSession` into POST/PATCH user writes while keeping legacy payload parsing harmless.

- [ ] **Step 4: Run focused server/access tests**

Run: `npm test -- packages/codex-web/test/identity_store.test.ts packages/codex-web/test/server_multi_user.test.ts`

Expected: PASS

### Task 3: Remove obsolete admin UI controls

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Remove create-user checkbox and inline user checkbox**

```js
await saveAdminUser({
  id: String(form.get('id') || '').trim(),
  username: String(form.get('username') || '').trim(),
  password: String(form.get('password') || ''),
  enabled: form.get('enabled') === 'on',
  roleId: String(form.get('roleId') || '').trim(),
});
```

- [ ] **Step 2: Remove `canNewSession` copy from user meta and PATCH body**

```js
return [status, roleId].filter(Boolean).join(' · ');
```

- [ ] **Step 3: Run focused UI tests**

Run: `npm test -- packages/codex-web/test/public_ui.test.ts`

Expected: PASS

### Task 4: Final verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 2: Run the focused changed-module tests**

Run: `npm test -- packages/codex-web/test/public_ui.test.ts packages/codex-web/test/identity_store.test.ts packages/codex-web/test/server_multi_user.test.ts`

Expected: PASS
