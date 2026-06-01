# Timeline Error Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep an optimistic user message visible in the chat timeline before any request or turn failure message.

**Architecture:** Preserve the existing optimistic local user entry inserted by `sendComposerMessage()`, then anchor failure messages relative to that entry instead of blindly appending them. Keep the change local to `packages/codex-web/public/app.js` and lock it with a focused regression test in the public UI harness.

**Tech Stack:** Plain browser JavaScript, Node test runner, existing `public_ui.test.ts` harness

---

### Task 1: Lock The Regression With A Failing Test

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('composer request failures keep the optimistic user message before the error', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: 'rate_limit', message: '429 Too Many Requests' }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  await api.sendComposerMessage('Question before rate limit');

  assert.deepEqual(api.state.timeline.map((item) => item.text), [
    'Question before rate limit',
    '429 Too Many Requests',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/codex-web/test/public_ui.test.ts --test-name-pattern "composer request failures keep the optimistic user message before the error"`
Expected: `FAIL` because the error is inserted in the wrong place or the optimistic entry is dropped.

- [ ] **Step 3: Write minimal implementation**

```js
function appendTimelineError(turnId, message, options = {}) {
  const pendingUserEntryId = String(options.pendingUserEntryId || '').trim();
  const entry = {
    id: `error_${turnId || Date.now()}`,
    kind: 'message',
    role: 'system',
    severity: 'error',
    label: 'Error',
    meta: 'failed',
    text: String(message || 'Turn failed'),
  };
  appendAfterPendingUserEntry(entry, pendingUserEntryId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/codex-web/test/public_ui.test.ts --test-name-pattern "composer request failures keep the optimistic user message before the error"`
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-01-timeline-error-ordering.md packages/codex-web/test/public_ui.test.ts packages/codex-web/public/app.js
git commit -m "fix: keep optimistic user messages ahead of timeline errors"
```

### Task 2: Implement Anchored Error Insertion And Verify

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Test: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Thread the optimistic entry id into request-failure handling**

```js
surfaceTimelineError(state.turnId || `request_${Date.now()}`, errorMessage, {
  pendingUserEntryId: optimisticUserEntry.id,
});
```

- [ ] **Step 2: Add a helper that inserts the error after the optimistic user entry when present**

```js
function appendAfterPendingUserEntry(entry, pendingUserEntryId) {
  const pendingIndex = state.timeline.findIndex((item) => item?.id === pendingUserEntryId);
  if (pendingIndex < 0) {
    appendOrReplace(entry, (item) => item.id === entry.id, { moveToEnd: true });
    return;
  }
  const existingIndex = state.timeline.findIndex((item) => item?.id === entry.id);
  if (existingIndex >= 0) {
    state.timeline.splice(existingIndex, 1);
  }
  state.timeline.splice(pendingIndex + 1, 0, entry);
}
```

- [ ] **Step 3: Keep existing turn-failure and stream-failure behavior as the fallback path**

```js
surfaceTimelineError(event.turnId, event.details || event.message || 'Turn failed');
```

- [ ] **Step 4: Run focused tests**

Run: `node --test packages/codex-web/test/public_ui.test.ts --test-name-pattern "timeline error|composer request failures keep the optimistic user message before the error"`
Expected: `PASS`

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: zero errors
