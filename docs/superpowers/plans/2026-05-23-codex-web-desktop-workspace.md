# Codex Web Desktop Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop workspace where the session list remains on the left and the active Codex session remains on the right, while preserving the current mobile single-column flow.

**Architecture:** Add a client-side desktop layout layer at `1100px` instead of replacing the existing mobile `view` model. Desktop rendering maps `sessions`, `chat`, and `new` into one two-pane workspace shell, while `sessionId/currentSession` drive the right pane. Reports and app settings become desktop overlays/panels that preserve the active session context.

**Tech Stack:** Plain browser JavaScript in `packages/codex-web/public/app.js`, CSS in `packages/codex-web/public/styles.css`, Node `node:test` frontend harness in `packages/codex-web/test/public_ui.test.ts`.

---

## File Structure

- Modify `packages/codex-web/public/app.js`
  - Add desktop layout constants and helpers.
  - Add desktop-only UI state for inline new-session launcher and workspace overlays.
  - Add render helpers for workspace shell, sidebar, chat pane, empty state, desktop settings panel, and desktop reports overlay.
  - Add desktop branches to navigation functions without changing mobile behavior.
  - Expose new helpers through the existing test API.

- Modify `packages/codex-web/public/styles.css`
  - Add `@media (min-width: 1100px)` desktop workspace rules.
  - Keep mobile rules as the default below the breakpoint.
  - Scope composer positioning to the right workspace pane in desktop mode.
  - Add active session, inline launcher, empty state, and overlay styles.

- Modify `packages/codex-web/test/public_ui.test.ts`
  - Add desktop layout and state behavior tests.
  - Extend the harness with viewport width control and selector materialization for desktop wrappers.
  - Preserve existing mobile assertions and add regression assertions for mobile behavior.

No backend files should change for this feature.

---

### Task 1: Add Desktop Layout Mode And Test Harness Support

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests near the existing frontend UI behavior tests in `packages/codex-web/test/public_ui.test.ts`:

```ts
test('layout mode switches at the desktop workspace breakpoint', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1099 });

  assert.equal(api.DESKTOP_WORKSPACE_MIN_WIDTH, 1100);
  assert.equal(api.isDesktopLayout(), false);

  context.window.innerWidth = 1100;
  assert.equal(api.isDesktopLayout(), true);

  context.window.innerWidth = 1440;
  assert.equal(api.isDesktopLayout(), true);
});

test('desktop resize preserves active session while mobile resize maps back to chat', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1200 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  api.handleLayoutResize();
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_1');

  context.window.innerWidth = 900;
  api.handleLayoutResize();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_1');
  assert.equal(api.state.currentSession?.id, 'session_1');
});
```

Update `loadAppHarness()` in the same file so viewport width is configurable:

```ts
window: {
  innerWidth: overrides.viewportWidth ?? 390,
  addEventListener() {},
  scrollTo() {},
},
```

Expose the new app helpers from `globalThis.__codexWebTest`:

```ts
DESKTOP_WORKSPACE_MIN_WIDTH: typeof DESKTOP_WORKSPACE_MIN_WIDTH === 'number' ? DESKTOP_WORKSPACE_MIN_WIDTH : null,
isDesktopLayout: typeof isDesktopLayout === 'function' ? isDesktopLayout : null,
handleLayoutResize: typeof handleLayoutResize === 'function' ? handleLayoutResize : null,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: FAIL because `DESKTOP_WORKSPACE_MIN_WIDTH`, `isDesktopLayout`, and `handleLayoutResize` are not defined yet.

- [ ] **Step 3: Add minimal layout mode implementation**

In `packages/codex-web/public/app.js`, add this constant near the other constants:

```js
const DESKTOP_WORKSPACE_MIN_WIDTH = 1100;
```

Add these desktop state fields inside the `state` object near `view`:

```js
  desktopNewSessionOpen: false,
  desktopSettingsOpen: false,
  desktopOverlay: null,
```

Add these helpers near `renderMain()`:

```js
function isDesktopLayout() {
  return typeof window?.innerWidth === 'number'
    && window.innerWidth >= DESKTOP_WORKSPACE_MIN_WIDTH;
}

function isDesktopWorkspaceView() {
  return isDesktopLayout() && ['sessions', 'chat', 'new'].includes(state.view);
}

function handleLayoutResize() {
  if (isDesktopLayout()) {
    return;
  }
  state.desktopNewSessionOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  if (state.sessionId) {
    state.view = 'chat';
    return;
  }
  state.view = 'sessions';
}
```

Register resize handling near the existing global listeners:

```js
window.addEventListener('resize', () => {
  handleLayoutResize();
  render();
});
```

Reset the new fields in `setLoggedOut()`:

```js
  state.desktopNewSessionOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
```

Expose the helpers in the test API block:

```js
  DESKTOP_WORKSPACE_MIN_WIDTH: typeof DESKTOP_WORKSPACE_MIN_WIDTH === 'number' ? DESKTOP_WORKSPACE_MIN_WIDTH : null,
  isDesktopLayout: typeof isDesktopLayout === 'function' ? isDesktopLayout : null,
  handleLayoutResize: typeof handleLayoutResize === 'function' ? handleLayoutResize : null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS for the new layout mode tests and no regressions in existing frontend tests.

- [ ] **Step 5: Commit**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "feat: add desktop layout mode detection"
```

---

### Task 2: Render The Desktop Workspace Shell

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests:

```ts
test('desktop renders a persistent session sidebar and chat pane', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/a', projectName: 'Repo A', lastUserInput: 'Build feature', updatedAt: 20, settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/b', projectName: 'Repo B', lastUserInput: 'Fix bug', updatedAt: 10, settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Ready' },
  ];

  api.render();

  assert.match(context.document.querySelector('#app').innerHTML, /class="shell desktop-shell"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-workspace"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-sidebar"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /class="desktop-chat-pane"/u);
  assert.match(context.document.querySelector('#app').innerHTML, /Build feature/u);
  assert.match(context.document.querySelector('#app').innerHTML, /Ready/u);
});

test('mobile session view does not render desktop workspace wrappers', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.render();

  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-sidebar/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-chat-pane/u);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: FAIL because `renderMain()` still returns single-page mobile shells.

- [ ] **Step 3: Implement the desktop workspace render path**

Change `renderMain()` in `packages/codex-web/public/app.js` so desktop workspace views render before the mobile page switch:

```js
function renderMain() {
  if (isDesktopWorkspaceView()) {
    return renderDesktopWorkspace();
  }
  if (state.view === 'settings') {
    return renderAppSettings();
  }
  if (state.view === 'reports') {
    return renderReportsPage();
  }
  if (state.view === 'report') {
    return renderReportViewer();
  }
  if (state.view === 'new') {
    return renderNewSession();
  }
  if (state.view === 'chat') {
    return renderChat();
  }
  return renderSessionList();
}
```

Add these helpers after `renderMain()`:

```js
function renderDesktopWorkspace() {
  ensureDesktopActiveSession();
  const shell = document.createElement('div');
  shell.className = 'shell desktop-shell';
  shell.innerHTML = `
    <div class="desktop-workspace">
      ${renderDesktopSidebar()}
      ${renderDesktopChatPane()}
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return shell;
}

function renderDesktopSidebar() {
  return `
    <aside class="desktop-sidebar">
      ${renderSessionListHeader({ desktop: true })}
      ${state.desktopNewSessionOpen ? renderDesktopNewSessionLauncher() : ''}
      <main class="session-list desktop-session-list">${renderSessionCards()}</main>
    </aside>
  `;
}

function renderDesktopChatPane() {
  if (!state.currentSession || !state.sessionId) {
    return `
      <section class="desktop-chat-pane desktop-empty-pane">
        <div class="desktop-empty-state">
          <h2>No active session</h2>
          <p class="meta">Select a session on the left or start a new one.</p>
          <button class="primary primary-action" type="button" id="desktop-empty-new-session-button">Start a new session</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="desktop-chat-pane">
      ${renderChatContent({ desktop: true })}
    </section>
  `;
}
```

Split `renderSessionList()` header into a reusable helper:

```js
function renderSessionListHeader({ desktop = false } = {}) {
  const canSortFavorites = state.sortMode === 'favorites';
  const topbarActions = state.favoriteSortMode
    ? `
          <div class="topbar-actions sort-edit-actions">
            <button class="primary compact-button" type="button" id="favorite-sort-save-button">Save</button>
            <button class="ghost compact-button" type="button" id="favorite-sort-cancel-button">Cancel</button>
          </div>
        `
    : `
          <div class="topbar-actions">
            <button class="reports-action compact-button" type="button" id="open-reports-button">Reports</button>
            ${canSortFavorites ? '<button class="ghost compact-button" type="button" id="favorite-sort-button">Sort</button>' : ''}
            <button class="ghost compact-button" type="button" id="open-new-session-button">New</button>
            <button class="ghost compact-button" type="button" id="open-app-settings-button">Set</button>
          </div>
        `;
  return `
    <header class="topbar page-topbar${desktop ? ' desktop-sidebar-topbar' : ''}">
      <div class="topbar-main">
        <div class="page-title">Sessions</div>
        ${topbarActions}
      </div>
      <div class="list-actions${state.favoriteSortMode ? ' is-hidden' : ''}">
        <div class="toggle sort-toggle">
          <button type="button" data-sort-mode="favorites" aria-pressed="${String(state.sortMode === 'favorites')}">Favorites</button>
          <button type="button" data-sort-mode="time" aria-pressed="${String(state.sortMode === 'time')}">All</button>
        </div>
      </div>
    </header>
  `;
}
```

Then simplify `renderSessionList()`:

```js
function renderSessionList() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen">
      ${renderSessionListHeader()}
      <main class="session-list">${renderSessionCards()}</main>
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return shell;
}
```

Split `renderChat()` into a reusable content helper:

```js
function renderChat() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `<div class="screen">${renderChatContent()}</div>`;
  return shell;
}

function renderChatContent({ desktop = false } = {}) {
  const sessionReportsProject = reportProjectForSession(state.currentSession);
  const composerClassName = composerStateClassName();
  return `
      <header class="topbar chat-topbar${desktop ? ' desktop-chat-topbar' : ''}">
        <div class="chat-nav">
          ${desktop ? '<div class="chat-nav-spacer" aria-hidden="true"></div>' : '<button class="ghost chat-back-button" type="button" id="back-to-list-button" aria-label="Sessions">&lt;</button>'}
          <div class="project-title">${escapeHtml(projectNameForSession(state.currentSession, state.cwd))}</div>
          ${sessionReportsProject
            ? `<button class="ghost compact-button session-report-button" type="button" data-session-reports-project="${escapeAttribute(sessionReportsProject)}">Reports</button>`
            : '<div class="chat-nav-spacer" aria-hidden="true"></div>'}
        </div>
      </header>
      <main class="timeline" id="timeline">${renderTimeline()}</main>
      <div class="composer-wrap ${composerClassName}">
        ${state.composerExpanded ? '' : renderComposerStatus()}
        <form class="composer ${composerClassName}" id="composer-form">
          ${state.settingsOpen && !state.composerExpanded ? renderSettingsDrawer() : ''}
          ${state.error && !state.composerExpanded ? `<div class="composer-error">${escapeHtml(shorten(state.error, 96))}</div>` : ''}
          <div class="compact-composer-row">
            ${renderComposerLeadingControls()}
            ${renderMessageEditor()}
          </div>
        </form>
      </div>
  `;
}
```

Add active-session card styling hooks in `renderSessionCards()`:

```js
    <article class="session-card${state.sessionId === session.id ? ' is-active' : ''}">
```

Add `ensureDesktopActiveSession()`:

```js
function ensureDesktopActiveSession() {
  if (!isDesktopLayout() || state.sessionId || state.currentSession) {
    return;
  }
  const [firstSession] = sortedSessions();
  if (!firstSession) {
    return;
  }
  state.sessionId = firstSession.id;
  state.currentSession = firstSession;
  state.cwd = firstSession.cwd || '';
  applySessionSettings(firstSession);
  restoreTimelineForSession(firstSession);
  syncRuntimeStatusFromSession(firstSession, { source: 'stale' });
}
```

Expose render helpers in the test API:

```js
  renderDesktopWorkspace: typeof renderDesktopWorkspace === 'function' ? renderDesktopWorkspace : null,
  renderDesktopSidebar: typeof renderDesktopSidebar === 'function' ? renderDesktopSidebar : null,
  renderDesktopChatPane: typeof renderDesktopChatPane === 'function' ? renderDesktopChatPane : null,
  ensureDesktopActiveSession: typeof ensureDesktopActiveSession === 'function' ? ensureDesktopActiveSession : null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS, with desktop wrappers present only at desktop viewport widths.

- [ ] **Step 5: Commit**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "feat: render desktop workspace shell"
```

---

### Task 3: Make Desktop Session Navigation Preserve The Workspace

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests:

```ts
test('desktop session selection keeps the workspace view active', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_2');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_2',
            cwd: '/repo/two',
            settings: { metadata: {} },
            thread: {
              turns: [
                {
                  id: 'turn_1',
                  items: [
                    { type: 'message', role: 'user', text: 'Desktop question' },
                    { type: 'message', role: 'assistant', text: 'Desktop answer' },
                  ],
                },
              ],
            },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/one', settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];

  await api.selectSession('session_2');

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_2');
  assert.equal(api.state.currentSession?.id, 'session_2');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Desktop answer/u);
});

test('desktop showSessionList keeps the active right pane instead of clearing it', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Still visible' }];

  api.showSessionList();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_1');
  assert.equal(api.state.currentSession?.id, 'session_1');
  assert.equal(api.state.timeline.length, 1);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Still visible/u);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: FAIL because `selectSession()` sets `view = 'chat'` and `showSessionList()` clears the active session.

- [ ] **Step 3: Add desktop branches to navigation functions**

Update `showSessionList()`:

```js
function showSessionList() {
  saveCurrentTimeline();
  stopStream();
  rememberSessionListScroll();
  state.view = 'sessions';
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.reportReturnView = 'reports';
  state.favoriteSortMode = false;
  state.favoriteSortDraft = [];
  state.archiveConfirmSessionId = null;
  state.desktopNewSessionOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  if (!isDesktopLayout()) {
    state.sessionId = null;
    state.currentSession = null;
    state.turnId = null;
    state.pendingTurn = false;
    state.composerExpanded = false;
    resetSessionHistoryWindow();
  }
  state.error = '';
  render();
}
```

Update `selectSession()` by replacing both unconditional `state.view = 'chat';` assignments with:

```js
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
```

Also close desktop-only panels after selecting a session:

```js
  state.desktopNewSessionOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
```

Update `renderSessionListAfterBackgroundUpdate()`:

```js
function renderSessionListAfterBackgroundUpdate() {
  if (state.view !== 'sessions' && !isDesktopWorkspaceView()) {
    return;
  }
  rememberSessionListScroll();
  render();
}
```

Update `showMoreSessionHistory()` so desktop active sessions can load older history:

```js
  if ((!isDesktopWorkspaceView() && state.view !== 'chat') || !state.sessionId) {
    return false;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS, including the existing mobile tests that expect mobile navigation to remain page-based.

- [ ] **Step 5: Commit**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "feat: preserve desktop workspace during session navigation"
```

---

### Task 4: Add Desktop Inline New Session Launcher

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests:

```ts
test('desktop new session opens an inline sidebar launcher', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.cwd = '/repo/current';
  api.openNewSessionPage();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopNewSessionOpen, true);
  assert.equal(api.state.newCwd, '/repo/current');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-new-session-launcher/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /id="new-session-form"/u);
});

test('mobile new session still uses the full-screen new page', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.openNewSessionPage();

  assert.equal(api.state.view, 'new');
  assert.equal(api.state.desktopNewSessionOpen, false);
  assert.match(api.context.document.querySelector('#app').innerHTML, /class="new-session-page"/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /desktop-new-session-launcher/u);
});

test('desktop new session submit keeps the workspace shell and activates the draft session', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.desktopNewSessionOpen = true;
  api.state.newCwd = '/repo/new';

  api.onNewSessionSubmit({
    preventDefault() {},
  });

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopNewSessionOpen, false);
  assert.equal(api.state.cwd, '/repo/new');
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /No context yet/u);
});
```

Expose `openNewSessionPage` and `onNewSessionSubmit` in the test API:

```ts
openNewSessionPage: typeof openNewSessionPage === 'function' ? openNewSessionPage : null,
onNewSessionSubmit: typeof onNewSessionSubmit === 'function' ? onNewSessionSubmit : null,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: FAIL because desktop `openNewSessionPage()` still navigates to `new` and clears the active session.

- [ ] **Step 3: Implement the desktop launcher**

Add `renderDesktopNewSessionLauncher()` near `renderNewSession()`:

```js
function renderDesktopNewSessionLauncher() {
  return `
    <section class="desktop-new-session-launcher">
      <form class="panel stack" id="new-session-form">
        <div class="field">
          <label for="new-cwd-input">Project path</label>
          <textarea id="new-cwd-input" name="cwd" rows="3" placeholder="Use server default">${escapeHtml(state.newCwd || state.cwd)}</textarea>
        </div>
        ${renderPathChoices()}
        <div class="actions">
          <button class="ghost compact-button" type="button" id="desktop-new-session-cancel-button">Cancel</button>
          <button class="primary compact-button" type="submit">Start</button>
        </div>
      </form>
    </section>
  `;
}
```

Update `openNewSessionPage()`:

```js
function openNewSessionPage() {
  saveCurrentTimeline();
  if (isDesktopLayout()) {
    applyDefaultSettings();
    state.favoriteSortMode = false;
    state.favoriteSortDraft = [];
    state.view = 'sessions';
    state.desktopNewSessionOpen = true;
    state.desktopSettingsOpen = false;
    state.desktopOverlay = null;
    state.archiveConfirmSessionId = null;
    state.currentReport = null;
    state.currentReportContent = '';
    state.currentReportLoading = false;
    state.newCwd = state.cwd || '';
    state.error = '';
    render();
    return;
  }
  stopStream();
  applyDefaultSettings();
  state.favoriteSortMode = false;
  state.favoriteSortDraft = [];
  state.view = 'new';
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.newCwd = state.cwd || '';
  resetTurnState();
  state.error = '';
  render();
}
```

Update `onNewSessionSubmit()`:

```js
function onNewSessionSubmit(event) {
  event.preventDefault();
  saveCurrentTimeline();
  stopStream();
  applyDefaultSettings();
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.desktopNewSessionOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  state.cwd = state.newCwd.trim();
  state.prompt = '';
  state.composerExpanded = false;
  state.settingsOpen = false;
  resetTurnState();
  state.status = 'Ready';
  state.statusTone = 'success';
  state.error = '';
  render();
}
```

Bind the cancel and empty-state buttons in `bindGlobalEvents()`:

```js
  const desktopNewSessionCancelButton = document.querySelector('#desktop-new-session-cancel-button');
  if (desktopNewSessionCancelButton) {
    desktopNewSessionCancelButton.addEventListener('click', () => {
      state.desktopNewSessionOpen = false;
      render();
    });
  }

  const desktopEmptyNewSessionButton = document.querySelector('#desktop-empty-new-session-button');
  if (desktopEmptyNewSessionButton) {
    desktopEmptyNewSessionButton.addEventListener('click', () => {
      openNewSessionPage();
    });
  }
```

Update the test API block:

```js
  openNewSessionPage: typeof openNewSessionPage === 'function' ? openNewSessionPage : null,
  onNewSessionSubmit: typeof onNewSessionSubmit === 'function' ? onNewSessionSubmit : null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS, with mobile `new` page behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "feat: add desktop inline new session launcher"
```

---

### Task 5: Add Desktop Settings Panel And Reports Overlay

**Files:**
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests:

```ts
test('desktop app settings opens as a panel without clearing the active session', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Keep me' }];

  api.openAppSettingsPage();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopSettingsOpen, true);
  assert.equal(api.state.sessionId, 'session_1');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-settings-panel/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Keep me/u);
});

test('desktop reports open as a right-pane overlay and close back to workspace', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    fetch: async (url) => {
      if (String(url).startsWith('/api/reports')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_a';
  api.state.currentSession = { id: 'session_a', cwd: '/Users/alice/work/project-a', projectName: 'Project A', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Workspace text' }];

  await api.openReportsPage({ project: 'project-a', returnView: 'chat' });

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopOverlay, 'reports');
  assert.equal(api.state.reportProject, 'project-a');
  assert.equal(api.state.sessionId, 'session_a');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-overlay/u);

  api.closeReportsPage();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.desktopOverlay, null);
  assert.equal(api.state.sessionId, 'session_a');
  assert.match(api.context.document.querySelector('#app').innerHTML, /Workspace text/u);
});
```

Expose `openAppSettingsPage` in the test API:

```ts
openAppSettingsPage: typeof openAppSettingsPage === 'function' ? openAppSettingsPage : null,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: FAIL because settings and reports still navigate to full-screen views on desktop.

- [ ] **Step 3: Implement desktop auxiliary surfaces**

Add desktop panel rendering into `renderDesktopWorkspace()`:

```js
  shell.innerHTML = `
    <div class="desktop-workspace">
      ${renderDesktopSidebar()}
      ${renderDesktopChatPane()}
      ${state.desktopSettingsOpen ? renderDesktopSettingsPanel() : ''}
      ${state.desktopOverlay === 'reports' ? renderDesktopReportsOverlay() : ''}
    </div>
    ${renderArchiveConfirmModal()}
  `;
```

Add these helpers near app settings/report rendering:

```js
function renderDesktopSettingsPanel() {
  return `
    <aside class="desktop-settings-panel">
      <header class="desktop-panel-header">
        <h2>Settings</h2>
        <button class="ghost compact-button" type="button" id="desktop-settings-close-button">Close</button>
      </header>
      <main class="app-settings-page desktop-settings-body">
        ${renderAppSettingsSections()}
      </main>
    </aside>
  `;
}

function renderDesktopReportsOverlay() {
  const title = state.reportProject ? state.reportProject : 'Reports';
  return `
    <section class="desktop-overlay">
      <div class="desktop-overlay-card">
        ${renderPageNav(title, { backId: 'desktop-reports-close-button' })}
        <main class="report-list">${state.reportProject ? renderReportCards() : renderReportProjects()}</main>
      </div>
    </section>
  `;
}
```

Extract the settings page body from `renderAppSettings()`:

```js
function renderAppSettings() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen">
      <header class="topbar page-topbar">
        <div class="topbar-main">
          <div class="page-title">Settings</div>
          <button class="ghost compact-button" type="button" id="back-to-list-button">Sessions</button>
        </div>
      </header>
      <main class="app-settings-page">
        ${renderAppSettingsSections()}
      </main>
    </div>
  `;
  return shell;
}

function renderAppSettingsSections() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Theme</div>
          <div class="toggle theme-toggle">
            <button type="button" data-app-theme="dark" aria-pressed="${String(state.theme === 'dark')}">Dark</button>
            <button type="button" data-app-theme="light" aria-pressed="${String(state.theme === 'light')}">White</button>
            <button type="button" data-app-theme="sunny" aria-pressed="${String(state.theme === 'sunny')}">Yellow</button>
            <button type="button" data-app-theme="forest" aria-pressed="${String(state.theme === 'forest')}">Green</button>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-section-title">Message Size</div>
          <div class="toggle">
            <button type="button" data-message-font-size="small" aria-pressed="${String(state.messageFontSize === 'small')}">Small</button>
            <button type="button" data-message-font-size="medium" aria-pressed="${String(state.messageFontSize === 'medium')}">Medium</button>
            <button type="button" data-message-font-size="large" aria-pressed="${String(state.messageFontSize === 'large')}">Large</button>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-section-title">New Thread</div>
          <div class="controls">
            <div class="control-group">
              <label for="default-model-select">Model</label>
              <select id="default-model-select" name="defaultModel">${renderModelOptions(state.defaultThreadSettings.model)}</select>
            </div>
            <div class="control-group">
              <label for="default-reasoning-select">Reasoning</label>
              <select id="default-reasoning-select" name="defaultReasoningEffort">
                ${renderOptions(['low', 'medium', 'high', 'xhigh'], state.defaultThreadSettings.reasoningEffort)}
              </select>
            </div>
            <div class="control-group">
              <label>Mode</label>
              <div class="toggle">
                <button type="button" data-default-mode="default" aria-pressed="${String(state.defaultThreadSettings.collaborationMode === 'default')}">Default</button>
                <button type="button" data-default-mode="plan" aria-pressed="${String(state.defaultThreadSettings.collaborationMode === 'plan')}">Plan</button>
              </div>
            </div>
            <div class="control-group">
              <label>Permissions</label>
              <div class="toggle permission-toggle">
                <button type="button" data-default-permission-preset="read-only" aria-pressed="${String(state.defaultThreadSettings.accessPreset === 'read-only')}">Read</button>
                <button type="button" data-default-permission-preset="default" aria-pressed="${String(state.defaultThreadSettings.accessPreset === 'default')}">Ask</button>
                <button type="button" data-default-permission-preset="full-access" aria-pressed="${String(state.defaultThreadSettings.accessPreset === 'full-access')}">Full</button>
              </div>
            </div>
          </div>
        </section>
        <section class="settings-section">
          <button class="danger compact-button full-width-button" type="button" id="settings-logout-button">Log out</button>
        </section>
  `;
}
```

Update `openAppSettingsPage()`:

```js
function openAppSettingsPage() {
  saveCurrentTimeline();
  state.favoriteSortMode = false;
  state.favoriteSortDraft = [];
  state.archiveConfirmSessionId = null;
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.error = '';
  if (isDesktopLayout()) {
    state.view = 'sessions';
    state.desktopSettingsOpen = true;
    state.desktopNewSessionOpen = false;
    state.desktopOverlay = null;
    render();
    return;
  }
  stopStream();
  state.view = 'settings';
  state.sessionId = null;
  state.currentSession = null;
  resetTurnState();
  render();
}
```

Update `openReportsPage()` desktop branch at the top after computing `normalizedProject`:

```js
  if (isDesktopLayout()) {
    state.view = 'sessions';
    state.desktopOverlay = 'reports';
    state.desktopNewSessionOpen = false;
    state.desktopSettingsOpen = false;
    state.favoriteSortMode = false;
    state.favoriteSortDraft = [];
    state.archiveConfirmSessionId = null;
    state.currentReport = null;
    state.currentReportContent = '';
    state.currentReportLoading = false;
    state.reportReturnView = 'chat';
    state.reportsReturnView = state.sessionId ? 'chat' : 'sessions';
    state.reportProject = normalizedProject;
    state.error = '';
    if (!state.reportsLoaded) {
      await refreshReportsList({ renderAfter: true });
      return;
    }
    render();
    return;
  }
```

Update `closeReportsPage()`:

```js
  if (isDesktopLayout()) {
    state.desktopOverlay = null;
    state.currentReport = null;
    state.currentReportContent = '';
    state.currentReportLoading = false;
    state.reportProject = '';
    state.view = 'sessions';
    render();
    return;
  }
```

Bind close controls in `bindGlobalEvents()`:

```js
  const desktopSettingsCloseButton = document.querySelector('#desktop-settings-close-button');
  if (desktopSettingsCloseButton) {
    desktopSettingsCloseButton.addEventListener('click', () => {
      state.desktopSettingsOpen = false;
      render();
    });
  }

  const desktopReportsCloseButton = document.querySelector('#desktop-reports-close-button');
  if (desktopReportsCloseButton) {
    desktopReportsCloseButton.addEventListener('click', () => {
      closeReportsPage();
    });
  }
```

Expose `openAppSettingsPage` in the test API block.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS, including existing reports return-flow tests on mobile viewport.

- [ ] **Step 5: Commit**

```bash
git add packages/codex-web/public/app.js packages/codex-web/test/public_ui.test.ts
git commit -m "feat: keep desktop settings and reports inside workspace"
```

---

### Task 6: Add Desktop Workspace CSS

**Files:**
- Modify: `packages/codex-web/public/styles.css`
- Modify: `packages/codex-web/test/public_ui.test.ts`

- [ ] **Step 1: Write the failing style tests**

Add these tests:

```ts
test('desktop workspace CSS creates a two-pane layout at 1100px', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /@media \(min-width:\s*1100px\)/u);
  assert.match(styles, /\.desktop-workspace\s*\{[^}]*display:\s*grid;/su);
  assert.match(styles, /\.desktop-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(300px,\s*340px\) minmax\(0,\s*1fr\);/su);
  assert.match(styles, /\.desktop-sidebar\s*\{[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.desktop-session-list\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.desktop-chat-pane\s*\{[^}]*position:\s*relative;/su);
});

test('desktop composer is anchored inside the right chat pane', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /@media \(min-width:\s*1100px\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /@media \(min-width:\s*1100px\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*left:\s*0;/su);
  assert.match(styles, /@media \(min-width:\s*1100px\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*right:\s*0;/su);
  assert.match(styles, /@media \(min-width:\s*1100px\)[\s\S]*\.desktop-chat-pane \.timeline\s*\{[^}]*padding-bottom:\s*var\(--composer-offset\);/su);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: FAIL because desktop workspace CSS does not exist.

- [ ] **Step 3: Implement desktop CSS**

Add this block near the existing `@media (min-width: 720px)` block:

```css
@media (min-width: 1100px) {
  .desktop-shell {
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 12%, transparent), transparent 34rem),
      var(--bg);
  }

  .desktop-workspace {
    height: 100dvh;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
    overflow: hidden;
  }

  .desktop-sidebar {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 78%, var(--bg));
  }

  .desktop-sidebar-topbar {
    position: static;
    padding: 18px 14px 12px;
  }

  .desktop-session-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }

  .desktop-chat-pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }

  .desktop-chat-topbar {
    position: static;
  }

  .desktop-chat-pane .timeline {
    padding: 14px 18px var(--composer-offset);
    scroll-padding-bottom: var(--composer-offset);
  }

  .desktop-chat-pane .message-card {
    max-width: min(72ch, 74%);
  }

  .desktop-chat-pane .composer-wrap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 8px 18px 14px;
  }

  .desktop-chat-pane .composer {
    width: min(100%, 820px);
  }

  .session-card.is-active {
    border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
    background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  }

  .desktop-new-session-launcher {
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }

  .desktop-new-session-launcher .panel {
    width: 100%;
    padding: 12px;
    box-shadow: none;
  }

  .desktop-empty-pane {
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .desktop-empty-state {
    width: min(100%, 420px);
    display: grid;
    gap: 12px;
    text-align: center;
  }

  .desktop-empty-state h2 {
    margin: 0;
    font-size: 20px;
  }

  .desktop-settings-panel {
    position: absolute;
    left: 18px;
    bottom: 18px;
    z-index: 30;
    width: min(420px, calc(100vw - 36px));
    max-height: calc(100dvh - 36px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: var(--shadow);
  }

  .desktop-panel-header {
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--border);
  }

  .desktop-panel-header h2 {
    margin: 0;
    font-size: 15px;
  }

  .desktop-settings-body {
    padding: 12px;
  }

  .desktop-overlay {
    position: absolute;
    inset: 18px;
    z-index: 25;
    display: grid;
    place-items: stretch;
    pointer-events: none;
  }

  .desktop-overlay-card {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: var(--shadow);
    pointer-events: auto;
  }

  .desktop-overlay-card .topbar {
    position: static;
  }
}
```

- [ ] **Step 4: Run the style tests to verify they pass**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS for desktop style tests and existing mobile style tests.

- [ ] **Step 5: Commit**

```bash
git add packages/codex-web/public/styles.css packages/codex-web/test/public_ui.test.ts
git commit -m "style: add desktop workspace layout"
```

---

### Task 7: Verify Desktop Runtime Behavior In Browser

**Files:**
- Modify: `packages/codex-web/test/public_ui.test.ts`
- Optional modify: `packages/codex-web/public/app.js`
- Optional modify: `packages/codex-web/public/styles.css`

- [ ] **Step 1: Add final regression tests for mobile preservation**

Add this test:

```ts
test('mobile session navigation still clears active session when returning to list', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 390 });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Mobile only' }];

  api.showSessionList();

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, null);
  assert.equal(api.state.currentSession, null);
  assert.equal(api.state.timeline.length, 0);
});
```

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS across all workspace tests.

- [ ] **Step 5: Manual browser verification**

Start the app:

```bash
npm run serve --workspace packages/codex-web
```

Open the served URL in Chrome at desktop width `>= 1100px` and verify:

- the app shows a left session list and right active session pane
- selecting a session updates only the right pane
- `New` opens an inline sidebar launcher
- `Settings` opens as a desktop panel without clearing chat
- `Reports` opens as a workspace overlay and closes back to the same active session
- resizing below `1100px` returns to the mobile single-column flow

If manual verification finds layout defects, fix the smallest relevant CSS or render helper and rerun:

```bash
npm test --workspace packages/codex-web -- public_ui.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/codex-web/public/app.js packages/codex-web/public/styles.css packages/codex-web/test/public_ui.test.ts
git commit -m "test: verify desktop workspace behavior"
```

---

## Final Verification

After all tasks are complete, run:

```bash
npm run typecheck
npm test
```

Expected:

- TypeScript typecheck passes.
- Full workspace test suite passes.
- Desktop width `>= 1100px` has persistent left session list and right active session.
- Mobile width `< 1100px` keeps the existing single-column flow.

## Self-Review

Spec coverage:

- Persistent left session list and right active-session pane: Tasks 2, 3, and 6.
- Desktop session selection without page replacement: Task 3.
- Desktop inline new-session launcher: Task 4.
- Desktop settings and reports without losing active session context: Task 5.
- Responsive transition and mobile preservation: Tasks 1 and 7.
- UI/state/style tests: Tasks 1 through 7.

Completion-marker scan:

- No draft markers or unspecified implementation steps are intentionally left in this plan.

Type and name consistency:

- `DESKTOP_WORKSPACE_MIN_WIDTH`, `isDesktopLayout()`, `isDesktopWorkspaceView()`, `handleLayoutResize()`, `desktopNewSessionOpen`, `desktopSettingsOpen`, and `desktopOverlay` are introduced in Task 1 and reused consistently in later tasks.
