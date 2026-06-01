# Session Card First Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a fixed two-line first-message summary on session cards and remove cwd fallback metadata.

**Architecture:** Keep the existing session summary data model and only change the session-card renderer plus its CSS. Reuse `firstUserInput` from normalized session summaries so the list stays lightweight and does not need new requests.

**Tech Stack:** Plain browser JS, CSS, Node test suite

---

### Task 1: Lock the card behavior in tests

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing summary-source assertion**

```ts
assert.match(html, /Original setup question/u);
assert.doesNotMatch(html, /Latest debugging question/u);
```

- [ ] **Step 2: Write the failing empty-summary assertion**

```ts
assert.match(html, /class="session-summary"><\/span>/u);
assert.doesNotMatch(html, /No prompt preview/u);
assert.doesNotMatch(html, /No cwd/u);
```

- [ ] **Step 3: Write the failing style assertion**

```ts
assert.match(styles, /\.session-summary\s*\{[^}]*-webkit-line-clamp:\s*2;/su);
assert.match(styles, /\.session-summary\s*\{[^}]*min-height:\s*calc\(var\(--session-summary-line-height\)\s*\*\s*2\);/su);
```

- [ ] **Step 4: Run focused UI tests and confirm failure**

Run: `npm test -- packages/codex-web/test/public_ui.test.ts`

Expected: failures showing the card still uses preview text, still renders cwd/placeholder copy, and has no fixed two-line summary style.

### Task 2: Implement the session card summary layout

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/public/styles.css`

- [ ] **Step 1: Render the first-message summary**

```js
const summary = firstInputForSession(session);
<span class="session-summary"${summary ? ' data-i18n-skip' : ''}>${escapeHtml(summary)}</span>
```

- [ ] **Step 2: Remove cwd metadata and keep only the timestamp**

```js
<span class="session-card-meta">
  <span>${escapeHtml(formatShortDateTime(lastInputAtForSession(session)))}</span>
</span>
```

- [ ] **Step 3: Add fixed two-line summary styles**

```css
:root {
  --session-summary-line-height: 1.35em;
}

.session-summary {
  min-height: calc(var(--session-summary-line-height) * 2);
  line-height: var(--session-summary-line-height);
  white-space: normal;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
```

- [ ] **Step 4: Run focused UI tests**

Run: `npm test -- packages/codex-web/test/public_ui.test.ts`

Expected: PASS

### Task 3: Final verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 2: Re-run focused UI tests**

Run: `npm test -- packages/codex-web/test/public_ui.test.ts`

Expected: PASS
