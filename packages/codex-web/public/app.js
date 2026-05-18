const TOKEN_KEY = 'codexWebToken';
const TIMELINE_CACHE_KEY = 'codexWebTimelineCache';
const MAX_TIMELINE_CACHE_SESSIONS = 16;
const MAX_TIMELINE_CACHE_ITEMS = 80;
const MAX_TIMELINE_CACHE_MAP_ITEMS = 24;
const MAX_TIMELINE_ITEM_TEXT = 12000;
const MAX_TIMELINE_SUMMARY_TEXT = 4000;
const MAX_TIMELINE_SUMMARY_ARRAY_ITEMS = 24;
const MAX_TIMELINE_SUMMARY_OBJECT_KEYS = 32;
const MAX_TIMELINE_SUMMARY_DEPTH = 4;
const MIN_HYDRATED_COMPLETE_EXCHANGES = 2;
const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_REASONING_EFFORT = 'xhigh';
const DEFAULT_COLLABORATION_MODE = 'default';
const DEFAULT_PERMISSION_PRESET = 'full-access';
const DEFAULT_APPROVAL_POLICY = 'never';
const DEFAULT_SANDBOX_MODE = 'danger-full-access';
const PROMPT_TEXTAREA_MAX_HEIGHT = 116;
const STREAM_STALE_MS = 30_000;
const EDGE_SWIPE_START_PX = 24;
const EDGE_SWIPE_TRIGGER_PX = 72;
const EDGE_SWIPE_MAX_VERTICAL_PX = 48;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  authSession: null,
  models: [],
  sessions: [],
  sessionsLoading: false,
  currentSession: null,
  sessionId: null,
  view: 'sessions',
  sortMode: 'favorites',
  archiveConfirmSessionId: null,
  cwd: '',
  newCwd: '',
  turnId: null,
  pendingTurn: false,
  setupRequired: false,
  setupMessage: '',
  loginError: '',
  error: '',
  status: 'Checking auth',
  statusTone: 'warn',
  prompt: '',
  model: DEFAULT_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  collaborationMode: DEFAULT_COLLABORATION_MODE,
  settingsOpen: false,
  permissionPreset: DEFAULT_PERMISSION_PRESET,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  timeline: [],
  sessionHistoryItems: [],
  sessionHistoryStartIndex: 0,
  timelineCache: loadTimelineCache(),
  batches: new Map(),
  approvals: new Map(),
  streamAbortController: null,
  lastTurnEventSequence: null,
  lastTurnEventAt: 0,
  streamWasBackgrounded: false,
};

const app = document.querySelector('#app');
let composerResizeObserver = null;
let composerOffsetRun = 0;
let pullToRefreshCleanup = null;
let edgeSwipeStart = null;

bootstrap();
registerServiceWorker();
setupPwaPullToRefresh();
setupEdgeSwipeBackNavigation();
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('pageshow', onPageResume);
window.addEventListener('focus', onPageResume);

function bootstrap() {
  if (!state.token) {
    render();
    setLoggedOut();
    return;
  }
  state.authSession = createCachedAuthSession();
  state.sessionsLoading = true;
  state.status = 'Loading';
  state.statusTone = 'warn';
  render();
  void restoreAuth();
}

async function restoreAuth() {
  try {
    state.status = 'Restoring session';
    render();
    const { session } = await apiFetch('/api/auth/me');
    state.authSession = session;
    state.status = 'Syncing sessions';
    state.statusTone = 'warn';
    render();
    const [modelsPayload] = await Promise.all([
      apiFetch('/api/models').catch(() => ({ items: [] })),
      refreshSessionsList({ renderAfter: false }).catch(() => null),
    ]);
    state.authSession = session;
    state.models = Array.isArray(modelsPayload.items) ? modelsPayload.items : [];
    state.model = pickModel(state.models, state.model || DEFAULT_MODEL);
    if (!state.sessionId) {
      state.view = 'sessions';
    }
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    handleApiError(error, { auth: true });
  }
}

function createCachedAuthSession() {
  return {
    id: 'cached',
    createdAt: '',
    lastSeenAt: '',
  };
}

function setLoggedOut(message = '') {
  state.authSession = null;
  state.sessions = [];
  state.sessionsLoading = false;
  state.sessionId = null;
  state.currentSession = null;
  state.view = 'sessions';
  state.sortMode = 'favorites';
  state.archiveConfirmSessionId = null;
  state.cwd = '';
  state.newCwd = '';
  state.turnId = null;
  state.pendingTurn = false;
  state.lastTurnEventSequence = null;
  state.lastTurnEventAt = 0;
  state.streamWasBackgrounded = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.timelineCache = loadTimelineCache();
  state.batches = new Map();
  state.approvals = new Map();
  state.status = 'Login required';
  state.statusTone = 'warn';
  state.error = '';
  state.loginError = message;
  applyDefaultSettings();
  stopStream();
  render();
}

function render() {
  app.innerHTML = '';
  if (state.setupRequired) {
    app.appendChild(renderSetup());
    bindGlobalEvents();
    resetComposerOffset();
    return;
  }
  if (!state.authSession) {
    app.appendChild(renderLogin());
    bindGlobalEvents();
    resetComposerOffset();
    return;
  }
  app.appendChild(renderMain());
  bindGlobalEvents();
  if (state.view === 'chat') {
    syncComposerOffset();
  } else {
    resetComposerOffset();
  }
}

function resetSessionHistoryWindow() {
  state.sessionHistoryItems = [];
  state.sessionHistoryStartIndex = 0;
}

function renderSetup() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="center-screen">
      <section class="panel stack">
        <div>
          <h1>Setup required</h1>
          <p class="meta">${escapeHtml(state.setupMessage || 'Password not configured.')}</p>
        </div>
        <pre class="command">codex-web auth set-password</pre>
      </section>
    </div>
  `;
  return shell;
}

function renderLogin() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="center-screen">
      <form class="panel stack" id="login-form">
        <div>
          <h1>Codex Web</h1>
          <p class="meta">Password login for this device.</p>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        ${state.loginError ? `<p class="meta" style="color: var(--danger);">${escapeHtml(state.loginError)}</p>` : ''}
        <div class="actions">
          <button class="primary" type="submit">Log in</button>
        </div>
      </form>
    </div>
  `;
  return shell;
}

function renderMain() {
  if (state.view === 'new') {
    return renderNewSession();
  }
  if (state.view === 'chat') {
    return renderChat();
  }
  return renderSessionList();
}

function renderSessionList() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen">
      <header class="topbar page-topbar">
        <div class="topbar-main">
          <div class="page-title">Sessions</div>
          <button class="ghost compact-button" type="button" id="logout-button">Log out</button>
        </div>
        <div class="list-actions">
          <div class="toggle sort-toggle">
            <button type="button" data-sort-mode="favorites" aria-pressed="${String(state.sortMode === 'favorites')}">Favorites</button>
            <button type="button" data-sort-mode="time" aria-pressed="${String(state.sortMode === 'time')}">Time</button>
          </div>
          <button class="primary compact-button" type="button" id="open-new-session-button">New</button>
        </div>
      </header>
      <main class="session-list">${renderSessionCards()}</main>
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return shell;
}

function renderNewSession() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen">
      <header class="topbar page-topbar">
        <div class="topbar-main">
          <div class="page-title">New Session</div>
          <button class="ghost compact-button" type="button" id="back-to-list-button">Sessions</button>
        </div>
      </header>
      <main class="new-session-page">
        <form class="panel stack" id="new-session-form">
          <div class="field">
            <label for="new-cwd-input">Project path</label>
            <input id="new-cwd-input" type="text" value="${escapeAttribute(state.newCwd || state.cwd)}" placeholder="Use server default">
          </div>
          ${renderPathChoices()}
          <div class="actions">
            <button class="primary" type="submit">Start</button>
          </div>
        </form>
      </main>
    </div>
  `;
  return shell;
}

function renderChat() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen">
      <header class="topbar chat-topbar">
        <div class="chat-nav">
          <button class="ghost chat-back-button" type="button" id="back-to-list-button" aria-label="Sessions">&lt;</button>
          <div class="project-title">${escapeHtml(projectNameForSession(state.currentSession, state.cwd))}</div>
          <div class="chat-nav-spacer" aria-hidden="true"></div>
        </div>
      </header>
      <main class="timeline" id="timeline">${renderTimeline()}</main>
      <div class="composer-wrap">
        ${renderComposerStatus()}
        <form class="composer" id="composer-form">
          ${state.settingsOpen ? renderSettingsDrawer() : ''}
          ${state.error ? `<div class="composer-error">${escapeHtml(shorten(state.error, 96))}</div>` : ''}
          <div class="compact-composer-row">
            <button class="ghost icon-button" type="button" id="settings-toggle" aria-expanded="${String(state.settingsOpen)}">Set</button>
            <textarea id="prompt-input" name="prompt" rows="1" placeholder="Message" ${state.pendingTurn ? 'disabled' : ''}>${escapeHtml(state.prompt)}</textarea>
            <button class="${state.pendingTurn ? 'danger' : 'primary'} compact-send" type="${state.pendingTurn ? 'button' : 'submit'}" id="${state.pendingTurn ? 'stop-button' : 'send-button'}">
              ${state.pendingTurn ? 'Stop' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
  return shell;
}

function renderSessionCards() {
  const sessions = sortedSessions();
  if (!sessions.length) {
    if (state.sessionsLoading) {
      return '<div class="empty-state">Loading sessions...</div>';
    }
    const message = state.sortMode === 'favorites' ? 'No favorites yet.' : 'No sessions yet.';
    return `<div class="empty-state">${message}</div>`;
  }
  return sessions.map((session) => `
    <article class="session-card">
      <button class="session-card-open" type="button" data-session-id="${escapeAttribute(session.id)}">
        <span class="session-card-main">
          <span class="session-project">${escapeHtml(projectNameForSession(session))}</span>
          <span class="session-preview">${escapeHtml(shorten(previewInputForSession(session), 96) || 'No prompt preview')}</span>
        </span>
        <span class="session-card-meta">
          <span>${escapeHtml(shorten(session.cwd || 'No cwd', 54))}</span>
          <span>${escapeHtml(formatShortDateTime(lastInputAtForSession(session)))}</span>
        </span>
      </button>
      <div class="session-card-actions">
        <button class="ghost compact-button session-favorite" type="button" data-session-favorite-id="${escapeAttribute(session.id)}" aria-pressed="${String(isFavoriteSession(session))}">${isFavoriteSession(session) ? 'Unfavorite' : 'Favorite'}</button>
        <button class="ghost compact-button session-archive" type="button" data-session-archive-request-id="${escapeAttribute(session.id)}">Archive</button>
      </div>
    </article>
  `).join('');
}

function renderArchiveConfirmModal() {
  const session = state.sessions.find((item) => item.id === state.archiveConfirmSessionId);
  if (!session) {
    return '';
  }
  return `
    <div class="modal-backdrop">
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-confirm-title">
        <div>
          <h2 id="archive-confirm-title">Archive session?</h2>
          <p class="meta">${escapeHtml(projectNameForSession(session))}</p>
          <p class="meta">${escapeHtml(shorten(previewInputForSession(session), 120) || 'No prompt preview')}</p>
        </div>
        <div class="actions">
          <button class="ghost" type="button" id="archive-cancel-button">Cancel</button>
          <button class="danger" type="button" data-session-archive-confirm-id="${escapeAttribute(session.id)}">Archive</button>
        </div>
      </section>
    </div>
  `;
}

function renderPathChoices() {
  const paths = uniqueSessionPaths();
  if (!paths.length) {
    return '';
  }
  return `
    <div class="path-choices">
      ${paths.map((cwd) => `
        <button type="button" class="path-choice" data-cwd-choice="${escapeAttribute(cwd)}">
          <span>${escapeHtml(projectNameFromCwd(cwd))}</span>
          <small>${escapeHtml(shorten(cwd, 62))}</small>
        </button>
      `).join('')}
    </div>
  `;
}

function renderSettingsDrawer() {
  return `
    <div class="settings-drawer">
      <div class="controls">
        <div class="control-group">
          <label for="model-select">Model</label>
          <select id="model-select" name="model">${renderModelOptions()}</select>
        </div>
        <div class="control-group">
          <label for="reasoning-select">Reasoning</label>
          <select id="reasoning-select" name="reasoningEffort">
            ${renderOptions(['low', 'medium', 'high', 'xhigh'], state.reasoningEffort)}
          </select>
        </div>
        <div class="control-group">
          <label>Mode</label>
          <div class="toggle">
            <button type="button" data-mode="default" aria-pressed="${String(state.collaborationMode === 'default')}">Default</button>
            <button type="button" data-mode="plan" aria-pressed="${String(state.collaborationMode === 'plan')}">Plan</button>
          </div>
        </div>
        <div class="control-group">
          <label>Permissions</label>
          <div class="toggle permission-toggle">
            <button type="button" data-permission-preset="read-only" aria-pressed="${String(state.permissionPreset === 'read-only')}">Read</button>
            <button type="button" data-permission-preset="default" aria-pressed="${String(state.permissionPreset === 'default')}">Ask</button>
            <button type="button" data-permission-preset="full-access" aria-pressed="${String(state.permissionPreset === 'full-access')}">Full</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTimeline() {
  if (!state.timeline.length) {
    return '<div class="empty-state">No context yet.</div>';
  }
  return state.timeline.map((item) => renderTimelineItem(item)).join('');
}

function renderComposerStatus() {
  return `<div class="composer-status" data-tone="${escapeAttribute(state.statusTone)}"><span>${escapeHtml(composerStatusLabel())}</span></div>`;
}

function composerStatusLabel() {
  if (state.pendingTurn) {
    return state.status === 'Stream paused' ? 'Paused' : 'Running';
  }
  if (state.statusTone === 'danger') {
    return 'Failed';
  }
  if (state.status === 'Ready') {
    return 'Done';
  }
  return state.status || 'Idle';
}

function renderTimelineItem(item) {
  if (item.kind === 'message') {
    const body = item.role === 'assistant'
      ? `<div class="message-text markdown-body">${renderMarkdown(item.text)}</div>`
      : `<p class="message-text">${escapeHtml(item.text)}</p>`;
    return `
      <article class="card message-card ${escapeHtml(item.role)}">
        <div class="card-header">
          <span class="card-title">${escapeHtml(item.label)}</span>
          <span class="card-kind">${escapeHtml(item.meta || '')}</span>
        </div>
        ${body}
      </article>
    `;
  }
  if (item.kind === 'work') {
    return renderWorkItem(item);
  }
  if (item.kind === 'batch') {
    return `
      <article class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(item.title)}</span>
          <span class="card-kind">${escapeHtml(item.status || item.batchKind)}</span>
        </div>
        ${renderSummary(item.summary)}
      </article>
    `;
  }
  if (item.kind === 'approval') {
    return `
      <article class="card">
        <div class="card-header">
          <span class="card-title">Approval requested</span>
          <span class="card-kind">${escapeHtml(item.approvalKind)}</span>
        </div>
        ${renderSummary(item.summary)}
        <div class="approval-actions">
          <button type="button" class="primary" data-approval-action="accept" data-approval-id="${escapeAttribute(item.approvalId)}" ${item.resolved ? 'disabled' : ''}>Accept</button>
          <button type="button" class="ghost" data-approval-action="accept-for-session" data-approval-id="${escapeAttribute(item.approvalId)}" ${item.resolved ? 'disabled' : ''}>Session</button>
          <button type="button" class="danger" data-approval-action="deny" data-approval-id="${escapeAttribute(item.approvalId)}" ${item.resolved ? 'disabled' : ''}>Deny</button>
        </div>
      </article>
    `;
  }
  return `
    <article class="card">
      <div class="card-header">
        <span class="card-title">${escapeHtml(item.title)}</span>
        <span class="card-kind">${escapeHtml(item.meta || '')}</span>
      </div>
      <p class="meta">${escapeHtml(item.text || '')}</p>
    </article>
  `;
}

function renderWorkItem(item) {
  const summary = summarizeWorkItem(item);
  const details = workDetailsForItem(item);
  return `
    <details class="card work-card">
      <summary>
        <span class="work-title">Work</span>
        <span class="work-counts">${escapeHtml(formatWorkCounts(summary))}</span>
        <span class="card-kind">${escapeHtml(item.status || 'running')}</span>
      </summary>
      ${details.length ? `
        <div class="work-events">
          ${details.map(renderWorkDetail).join('')}
        </div>
      ` : '<p class="meta">No tool activity yet.</p>'}
    </details>
  `;
}

function summarizeWorkItem(item) {
  const summary = {
    reads: 0,
    commands: 0,
    edits: 0,
    approvals: Array.isArray(item.approvals) ? item.approvals.length : 0,
  };
  for (const batch of item.batches || []) {
    const kind = classifyWorkBatch(batch);
    if (kind === 'read') {
      summary.reads += 1;
    } else if (kind === 'edit') {
      summary.edits += Math.max(1, workChangedFiles(batch).length);
    } else if (kind === 'command') {
      summary.commands += 1;
    }
  }
  return summary;
}

function formatWorkCounts(summary) {
  const parts = [];
  if (summary.reads) {
    parts.push(`Read ${summary.reads}`);
  }
  if (summary.commands) {
    parts.push(`Ran ${summary.commands}`);
  }
  if (summary.edits) {
    parts.push(`Edited ${summary.edits}`);
  }
  if (summary.approvals) {
    parts.push(`Approval ${summary.approvals}`);
  }
  return parts.join(' · ') || 'No activity';
}

function workDetailsForItem(item) {
  return [
    ...(item.batches || []).map((batch) => ({
      kind: classifyWorkBatch(batch),
      title: batch.title || workTitleFromSummary(batch.summary) || 'Tool activity',
      status: batch.status || '',
      summary: batch.summary || {},
      files: workChangedFiles(batch),
    })),
    ...(item.approvals || []).map((approval) => ({
      kind: 'approval',
      title: approval.summary?.command || approval.summary?.reason || approval.approvalKind || 'Approval requested',
      status: approval.resolved ? approval.summary?.decision || 'resolved' : 'requested',
      summary: approval.summary || {},
      files: [],
    })),
  ];
}

function renderWorkDetail(detail) {
  const files = detail.files.length
    ? `<div class="work-files">${detail.files.map((file) => `<span>${escapeHtml(file)}</span>`).join('')}</div>`
    : '';
  return `
    <div class="work-event" data-work-kind="${escapeAttribute(detail.kind)}">
      <div class="work-event-main">
        <span class="work-event-kind">${escapeHtml(workKindLabel(detail.kind))}</span>
        <span class="work-event-title">${escapeHtml(detail.title)}</span>
      </div>
      <span class="work-event-status">${escapeHtml(detail.status || '')}</span>
      ${files}
      ${renderCompactSummary(detail.summary)}
    </div>
  `;
}

function renderCompactSummary(summary) {
  const entries = Object.entries(summary || {})
    .filter(([key, value]) => key !== 'fileChanges' && hasSummaryValue(value))
    .slice(0, 3);
  if (!entries.length) {
    return '';
  }
  return `<div class="work-summary">${entries.map(([key, value]) => `
    <span><strong>${escapeHtml(startCase(key))}</strong> ${escapeHtml(shorten(formatSummaryValue(value), 140))}</span>
  `).join('')}</div>`;
}

function hasSummaryValue(value) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function classifyWorkBatch(batch) {
  if (batch.batchKind === 'file_change') {
    return 'edit';
  }
  if (batch.batchKind === 'command' && isReadCommand(batch.title || batch.summary?.command || '')) {
    return 'read';
  }
  if (batch.batchKind === 'command') {
    return 'command';
  }
  if (batch.batchKind === 'permission') {
    return 'approval';
  }
  return 'tool';
}

function isReadCommand(command) {
  return /^(rg|sed|cat|less|head|tail|ls|find|git\s+(show|diff|status|log|grep)|wc)\b/u.test(String(command || '').trim());
}

function workChangedFiles(batch) {
  const changes = batch.summary?.fileChanges;
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes
    .map((change) => change?.path || change?.file || change?.target || change?.source)
    .filter(Boolean)
    .map(String);
}

function workTitleFromSummary(summary) {
  return summary?.command || summary?.reason || '';
}

function workKindLabel(kind) {
  return {
    read: 'Read',
    command: 'Ran',
    edit: 'Edited',
    approval: 'Approval',
    tool: 'Tool',
  }[kind] || 'Tool';
}

function renderSummary(summary) {
  const entries = Object.entries(summary || {}).filter(([, value]) => hasSummaryValue(value));
  if (!entries.length) {
    return '<p class="meta">No additional details.</p>';
  }
  return `<div class="summary-list">${entries.map(([key, value]) => `
    <div class="summary-item">
      <strong>${escapeHtml(startCase(key))}</strong>
      <span>${escapeHtml(formatSummaryValue(value))}</span>
    </div>
  `).join('')}</div>`;
}

function renderModelOptions() {
  const current = state.model || '';
  const options = [];
  if (!state.models.length) {
    options.push({ id: current, label: current || 'Default model' });
  } else {
    for (const model of state.models) {
      options.push({
        id: model.id || model.name || '',
        label: model.label || model.id || model.name || 'Unnamed model',
      });
    }
    if (current && !options.some((option) => option.id === current)) {
      options.unshift({ id: current, label: current });
    }
  }
  return options.map((option) => {
    const value = option.id || '';
    const selected = value === current ? ' selected' : '';
    return `<option value="${escapeAttribute(value)}"${selected}>${escapeHtml(option.label)}</option>`;
  }).join('');
}

function renderOptions(values, current) {
  return values.map((value) => {
    const selected = value === current ? ' selected' : '';
    const label = value === 'xhigh' ? 'xhigh' : startCase(value);
    return `<option value="${escapeAttribute(value)}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

function bindGlobalEvents() {
  const loginForm = document.querySelector('#login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', onLoginSubmit);
  }

  const composerForm = document.querySelector('#composer-form');
  if (composerForm) {
    composerForm.addEventListener('submit', onComposerSubmit);
  }

  const logoutButton = document.querySelector('#logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', onLogout);
  }

  const stopButton = document.querySelector('#stop-button');
  if (stopButton) {
    stopButton.addEventListener('click', onStopTurn);
  }

  const openNewSessionButton = document.querySelector('#open-new-session-button');
  if (openNewSessionButton) {
    openNewSessionButton.addEventListener('click', () => {
      openNewSessionPage();
    });
  }

  const backToListButton = document.querySelector('#back-to-list-button');
  if (backToListButton) {
    backToListButton.addEventListener('click', () => {
      showSessionList();
    });
  }

  for (const button of document.querySelectorAll('[data-session-id]')) {
    button.addEventListener('click', () => {
      void selectSession(button.getAttribute('data-session-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-sort-mode]')) {
    button.addEventListener('click', () => {
      state.sortMode = button.getAttribute('data-sort-mode') || 'favorites';
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-session-favorite-id]')) {
    button.addEventListener('click', () => {
      void toggleSessionFavorite(button.getAttribute('data-session-favorite-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-session-archive-request-id]')) {
    button.addEventListener('click', () => {
      requestArchiveSession(button.getAttribute('data-session-archive-request-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-session-archive-confirm-id]')) {
    button.addEventListener('click', () => {
      void archiveSession(button.getAttribute('data-session-archive-confirm-id') || '');
    });
  }

  const archiveCancelButton = document.querySelector('#archive-cancel-button');
  if (archiveCancelButton) {
    archiveCancelButton.addEventListener('click', () => {
      cancelArchiveSession();
    });
  }

  const newSessionForm = document.querySelector('#new-session-form');
  if (newSessionForm) {
    newSessionForm.addEventListener('submit', onNewSessionSubmit);
  }

  const newCwdInput = document.querySelector('#new-cwd-input');
  if (newCwdInput) {
    newCwdInput.addEventListener('input', (event) => {
      state.newCwd = event.target.value;
    });
  }

  for (const button of document.querySelectorAll('[data-cwd-choice]')) {
    button.addEventListener('click', () => {
      state.newCwd = button.getAttribute('data-cwd-choice') || '';
      render();
    });
  }

  const promptInput = document.querySelector('#prompt-input');
  if (promptInput) {
    promptInput.addEventListener('input', (event) => {
      state.prompt = event.target.value;
      autoGrowPromptInput(event.target);
      syncComposerOffset();
    });
    autoGrowPromptInput(promptInput);
  }

  const settingsToggle = document.querySelector('#settings-toggle');
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      state.settingsOpen = !state.settingsOpen;
      render();
    });
  }

  const modelSelect = document.querySelector('#model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (event) => {
      state.model = event.target.value;
      void updateSessionSettings();
    });
  }

  const reasoningSelect = document.querySelector('#reasoning-select');
  if (reasoningSelect) {
    reasoningSelect.addEventListener('change', (event) => {
      state.reasoningEffort = event.target.value;
      void updateSessionSettings();
    });
  }

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => {
      state.collaborationMode = button.getAttribute('data-mode') || 'default';
      void updateSessionSettings();
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-permission-preset]')) {
    button.addEventListener('click', () => {
      applyPermissionPreset(button.getAttribute('data-permission-preset') || 'default');
      void updateSessionSettings();
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-approval-action]')) {
    button.addEventListener('click', () => {
      void resolveApproval(
        button.getAttribute('data-approval-id'),
        button.getAttribute('data-approval-action'),
      );
    });
  }
}

function resetComposerOffset() {
  composerOffsetRun += 1;
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
  document.documentElement.style.removeProperty('--composer-offset');
}

function syncComposerOffset() {
  composerOffsetRun += 1;
  const run = composerOffsetRun;
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
  requestAnimationFrame(() => {
    if (run !== composerOffsetRun) {
      return;
    }
    const composerWrap = document.querySelector('.composer-wrap');
    if (!composerWrap) {
      resetComposerOffset();
      return;
    }
    const applyComposerOffset = () => {
      const height = Math.ceil(composerWrap.getBoundingClientRect().height);
      const offset = Math.max(220, height + 16);
      document.documentElement.style.setProperty('--composer-offset', `${offset}px`);
    };
    applyComposerOffset();
    if ('ResizeObserver' in window) {
      composerResizeObserver = new ResizeObserver(applyComposerOffset);
      composerResizeObserver.observe(composerWrap);
    }
  });
}

function autoGrowPromptInput(textarea) {
  if (!textarea?.style) {
    return;
  }
  textarea.style.height = 'auto';
  const nextHeight = Math.min(textarea.scrollHeight, 116);
  textarea.style.height = `${Math.max(38, nextHeight)}px`;
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');
  state.loginError = '';
  state.status = 'Logging in';
  state.statusTone = 'warn';
  render();
  try {
    const payload = await apiFetch('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: { password },
    });
    state.token = payload.token;
    localStorage.setItem(TOKEN_KEY, payload.token);
    state.authSession = payload.session || createCachedAuthSession();
    state.sessionsLoading = true;
    state.setupRequired = false;
    state.setupMessage = '';
    state.status = 'Syncing sessions';
    state.statusTone = 'warn';
    render();
    void restoreAuth();
  } catch (error) {
    handleApiError(error, { login: true });
  }
}

async function onLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_error) {
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TIMELINE_CACHE_KEY);
  state.token = '';
  setLoggedOut();
}

function showSessionList() {
  saveCurrentTimeline();
  stopStream();
  state.view = 'sessions';
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  state.turnId = null;
  state.pendingTurn = false;
  state.prompt = '';
  state.error = '';
  resetSessionHistoryWindow();
  render();
}

function openNewSessionPage() {
  saveCurrentTimeline();
  stopStream();
  applyDefaultSettings();
  state.view = 'new';
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  state.newCwd = state.cwd || '';
  resetTurnState();
  state.error = '';
  render();
}

function onNewSessionSubmit(event) {
  event.preventDefault();
  saveCurrentTimeline();
  stopStream();
  applyDefaultSettings();
  state.view = 'chat';
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  state.cwd = state.newCwd.trim();
  state.prompt = '';
  state.settingsOpen = false;
  resetTurnState();
  state.status = 'Ready';
  state.statusTone = 'success';
  state.error = '';
  render();
}

async function selectSession(sessionId) {
  const nextSession = state.sessions.find((session) => session.id === sessionId) || null;
  if (!nextSession) {
    openNewSessionPage();
    return;
  }
  saveCurrentTimeline();
  state.status = 'Checking session';
  state.statusTone = 'warn';
  render();
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(nextSession.id)}`);
    upsertSession(payload.session);
  } catch (error) {
    if (handleMissingSession(error, '')) {
      return;
    }
    handleApiError(error);
    return;
  }
  const refreshedSession = state.sessions.find((session) => session.id === sessionId) || nextSession;
  stopStream();
  resetSessionHistoryWindow();
  state.sessionId = refreshedSession.id;
  state.currentSession = refreshedSession;
  state.archiveConfirmSessionId = null;
  state.cwd = refreshedSession.cwd || '';
  applySessionSettings(refreshedSession);
  restoreTimelineForSession(refreshedSession);
  const restoredActiveTurn = restoreActiveTurnFromSession(refreshedSession);
  state.view = 'chat';
  state.settingsOpen = false;
  state.error = '';
  if (!restoredActiveTurn) {
    state.status = 'Ready';
    state.statusTone = 'success';
  }
  render();
  scrollTimelineToBottom();
  if (restoredActiveTurn && state.turnId) {
    streamTurnEvents(state.turnId, { forceReconnect: true });
  }
}

async function onComposerSubmit(event) {
  event.preventDefault();
  if (state.pendingTurn) {
    return;
  }
  const text = state.prompt.trim();
  if (!text) {
    return;
  }
  state.error = '';
  state.pendingTurn = true;
  state.lastTurnEventSequence = null;
  state.lastTurnEventAt = Date.now();
  state.streamWasBackgrounded = false;
  state.status = 'Starting turn';
  state.statusTone = 'warn';
  appendMessage({
    id: `local_user_${Date.now()}`,
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'pending',
    text,
  });
  const promptToSend = text;
  state.prompt = '';
  render();

  try {
    const sessionId = await ensureSession();
    optimisticallyUpdateSessionInput(promptToSend);
    saveCurrentTimeline();
    const settings = collectSettings();
    const turn = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: {
        text: promptToSend,
        settings,
      },
    });
    if (turn.session) {
      upsertSession(turn.session);
      state.sessionId = turn.session.id;
      state.currentSession = turn.session;
      state.cwd = turn.session.cwd || state.cwd;
      resetSessionHistoryWindow();
      optimisticallyUpdateSessionInput(promptToSend);
    }
    state.turnId = turn.turnId;
    state.status = 'Turn running';
    state.statusTone = 'warn';
    render();
    void streamTurnEvents(turn.turnId);
  } catch (error) {
    state.pendingTurn = false;
    if (handleMissingSession(error, promptToSend)) {
      return;
    }
    handleApiError(error);
  }
}

async function ensureSession() {
  if (state.sessionId) {
    return state.sessionId;
  }
  state.status = 'Starting session';
  render();
  const payload = await apiFetch('/api/sessions', {
    method: 'POST',
    body: {
      cwd: state.cwd.trim() || null,
      settings: collectSettings(),
    },
  });
  state.currentSession = payload.session;
  state.sessionId = payload.session.id;
  state.cwd = payload.session.cwd || state.cwd;
  upsertSession(payload.session);
  return state.sessionId;
}

function requestArchiveSession(sessionId) {
  if (!sessionId || state.pendingTurn) {
    render();
    return;
  }
  state.archiveConfirmSessionId = sessionId;
  state.error = '';
  render();
}

function cancelArchiveSession() {
  state.archiveConfirmSessionId = null;
  render();
}

async function archiveSession(sessionId) {
  if (!sessionId || state.pendingTurn) {
    render();
    return;
  }
  state.archiveConfirmSessionId = null;
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    removeSession(sessionId);
    state.timelineCache.delete(sessionId);
    persistTimelineCache();
    if (state.sessionId === sessionId) {
      stopStream();
      state.sessionId = null;
      state.currentSession = null;
      resetTurnState();
      state.view = 'sessions';
    }
    state.status = 'Session archived';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    if (isMissingSessionError(error)) {
      removeSession(sessionId);
      state.error = 'Selected session was unavailable and was removed from the list.';
      render();
      return;
    }
    handleApiError(error);
  }
}

async function toggleSessionFavorite(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }
  const favorite = !isFavoriteSession(session);
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/favorite`, {
      method: 'PATCH',
      body: { favorite },
    });
    if (payload?.session) {
      upsertSession(payload.session);
      if (state.currentSession?.id === payload.session.id) {
        state.currentSession = state.sessions.find((item) => item.id === payload.session.id) || payload.session;
      }
    }
    state.status = favorite ? 'Session favorited' : 'Favorite removed';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    if (handleMissingSession(error, '')) {
      return;
    }
    handleApiError(error);
  }
}

async function streamTurnEvents(turnId, options = {}) {
  stopStream();
  const controller = new AbortController();
  state.streamAbortController = controller;
  state.lastTurnEventAt = Date.now();
  if (options.forceReconnect) {
    state.streamWasBackgrounded = false;
  }
  let assistantEntry = state.timeline.find((item) => item.id === `assistant_${turnId}`) || null;
  let buffer = '';
  let eventName = 'message';
  let eventId = '';
  let dataLines = [];

  try {
    const after = state.lastTurnEventSequence == null
      ? ''
      : `?after=${encodeURIComponent(String(state.lastTurnEventSequence))}`;
    const response = await fetch(`/api/turns/${encodeURIComponent(turnId)}/events${after}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw await buildApiError(response);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processSseFrame(rawFrame);
        boundary = buffer.indexOf('\n\n');
      }
    }

    if (buffer.trim()) {
      processSseFrame(buffer);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    if (isRecoverableBackgroundStreamError(turnId, error)) {
      state.streamWasBackgrounded = true;
      state.status = 'Stream paused';
      state.statusTone = 'warn';
      return;
    }
    state.pendingTurn = false;
    state.status = 'Stream failed';
    state.statusTone = 'danger';
    handleApiError(error);
  } finally {
    if (state.streamAbortController === controller) {
      state.streamAbortController = null;
    }
    render();
  }

  function processSseFrame(frame) {
    if (!frame.trim()) {
      return;
    }
    for (const line of frame.split(/\r?\n/u)) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('id:')) {
        eventId = line.slice(3).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (eventName !== 'message' || !dataLines.length) {
      resetFrame();
      return;
    }
    try {
      const payload = JSON.parse(dataLines.join('\n'));
      if (eventId && !payload.sequence) {
        payload.sequence = eventId;
      }
      const sequence = Number(payload.sequence);
      if (Number.isFinite(sequence)) {
        state.lastTurnEventSequence = sequence;
      }
      state.lastTurnEventAt = Date.now();
      assistantEntry = applyTurnEvent(payload, assistantEntry);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    resetFrame();
  }

  function resetFrame() {
    eventName = 'message';
    eventId = '';
    dataLines = [];
  }
}

function isRecoverableBackgroundStreamError(turnId, error) {
  return state.pendingTurn
    && state.turnId === turnId
    && (state.streamWasBackgrounded || document.visibilityState === 'hidden' || isNetworkStreamError(error));
}

async function onStopTurn() {
  if (!state.turnId) {
    return;
  }
  try {
    await apiFetch(`/api/turns/${encodeURIComponent(state.turnId)}/interrupt`, { method: 'POST' });
    state.status = 'Interrupt requested';
    state.statusTone = 'warn';
    render();
  } catch (error) {
    handleApiError(error);
  }
}

async function resolveApproval(approvalId, action) {
  if (!approvalId || !action) {
    return;
  }
  try {
    await apiFetch(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, { method: 'POST' });
    const item = state.approvals.get(approvalId);
    if (item) {
      item.resolved = true;
    }
    state.status = 'Approval sent';
    state.statusTone = 'warn';
    render();
  } catch (error) {
    handleApiError(error);
  }
}

function applyTurnEvent(event, assistantEntry) {
  switch (event.type) {
    case 'turn.started':
      state.status = 'Turn running';
      state.statusTone = 'warn';
      ensureWorkItem(event.turnId);
      break;
    case 'assistant.delta':
      if (!assistantEntry || assistantEntry.id !== `assistant_${event.turnId}`) {
        assistantEntry = {
          id: `assistant_${event.turnId}`,
          kind: 'message',
          role: 'assistant',
          label: 'Assistant',
          meta: event.phase || 'streaming',
          text: '',
        };
        appendMessage(assistantEntry);
      }
      assistantEntry.text += event.text || '';
      assistantEntry.meta = event.phase || 'streaming';
      break;
    case 'assistant.final':
      assistantEntry = {
        id: `assistant_${event.turnId}_final`,
        kind: 'message',
        role: 'assistant',
        label: 'Assistant',
        meta: 'final',
        text: event.text || '',
      };
      appendOrReplace(assistantEntry, (item) => item.id === `assistant_${event.turnId}` || item.id === assistantEntry.id);
      break;
    case 'batch.started':
      upsertWorkBatch(event.turnId, event.batchId, {
        id: `batch_${event.batchId}`,
        batchId: event.batchId,
        batchKind: event.kind,
        title: event.title || 'Batch',
        status: 'started',
        summary: {},
      });
      break;
    case 'batch.updated':
      upsertWorkBatch(event.turnId, event.batchId, {
        summary: event.summary || {},
      });
      break;
    case 'batch.completed':
      upsertWorkBatch(event.turnId, event.batchId, {
        status: event.status || 'completed',
      });
      break;
    case 'approval.requested': {
      const approval = {
        id: `approval_${event.approvalId}`,
        kind: 'approval',
        approvalId: event.approvalId,
        approvalKind: event.approvalKind,
        summary: event.summary || {},
        resolved: false,
      };
      state.approvals.set(event.approvalId, approval);
      upsertWorkApproval(event.turnId, approval);
      break;
    }
    case 'approval.resolved': {
      const approval = state.approvals.get(event.approvalId);
      if (approval) {
        approval.resolved = true;
        approval.summary = {
          ...approval.summary,
          decision: event.decision,
        };
        upsertWorkApproval(event.turnId, approval);
      }
      state.status = 'Approval resolved';
      state.statusTone = 'warn';
      break;
    }
    case 'turn.completed':
      state.pendingTurn = false;
      state.streamWasBackgrounded = false;
      state.status = event.status === 'completed' ? 'Ready' : `Turn ${event.status}`;
      state.statusTone = event.status === 'completed' ? 'success' : 'warn';
      setWorkStatus(event.turnId, event.status || 'completed');
      state.turnId = null;
      stopStream();
      void refreshCurrentSessionMetadata();
      break;
    case 'turn.failed':
      state.pendingTurn = false;
      state.streamWasBackgrounded = false;
      state.status = 'Turn failed';
      state.statusTone = 'danger';
      state.turnId = null;
      stopStream();
      state.error = event.message || 'Turn failed';
      setWorkStatus(event.turnId, 'failed');
      break;
  }
  saveCurrentTimeline();
  render();
  scrollTimelineToBottom();
  return assistantEntry;
}

function upsertBatch(batchId, patch) {
  const current = state.batches.get(batchId) || {
    id: `batch_${batchId}`,
    kind: 'batch',
    batchId,
    batchKind: 'unknown',
    title: 'Batch',
    status: '',
    summary: {},
  };
  const next = { ...current, ...patch, summary: { ...current.summary, ...(patch.summary || {}) } };
  state.batches.set(batchId, next);
  appendOrReplace(next, (item) => item.id === next.id);
}

function ensureWorkItem(turnId) {
  const id = `work_${turnId || 'unknown'}`;
  let item = state.timeline.find((entry) => entry.id === id);
  if (!item) {
    item = {
      id,
      kind: 'work',
      turnId,
      status: 'running',
      batches: [],
      approvals: [],
    };
    state.timeline.push(item);
  }
  return item;
}

function upsertWorkBatch(turnId, batchId, patch) {
  const work = ensureWorkItem(turnId);
  const batches = Array.isArray(work.batches) ? work.batches : [];
  const index = batches.findIndex((item) => item.batchId === batchId);
  const current = index >= 0
    ? batches[index]
    : {
      id: `batch_${batchId}`,
      batchId,
      batchKind: 'unknown',
      title: 'Batch',
      status: '',
      summary: {},
    };
  const next = { ...current, ...patch, summary: { ...current.summary, ...(patch.summary || {}) } };
  if (index >= 0) {
    batches[index] = next;
  } else {
    batches.push(next);
  }
  work.batches = batches;
  state.batches.set(batchId, next);
  appendOrReplace(work, (item) => item.id === work.id);
}

function upsertWorkApproval(turnId, approval) {
  const work = ensureWorkItem(turnId);
  const approvals = Array.isArray(work.approvals) ? work.approvals : [];
  const index = approvals.findIndex((item) => item.approvalId === approval.approvalId);
  if (index >= 0) {
    approvals[index] = approval;
  } else {
    approvals.push(approval);
  }
  work.approvals = approvals;
  appendOrReplace(work, (item) => item.id === work.id);
}

function setWorkStatus(turnId, status) {
  const work = ensureWorkItem(turnId);
  work.status = status;
  appendOrReplace(work, (item) => item.id === work.id);
}

function resetTurnState() {
  state.turnId = null;
  state.pendingTurn = false;
  state.lastTurnEventSequence = null;
  state.lastTurnEventAt = 0;
  state.streamWasBackgrounded = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.batches = new Map();
  state.approvals = new Map();
}

function handleMissingSession(error, promptToRestore) {
  if (!isMissingSessionError(error)) {
    return false;
  }
  const missingSessionId = state.sessionId;
  if (missingSessionId) {
    state.sessions = state.sessions.filter((session) => session.id !== missingSessionId);
  }
  stopStream();
  state.sessionId = null;
  state.currentSession = null;
  state.turnId = null;
  state.pendingTurn = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.batches = new Map();
  state.approvals = new Map();
  if (promptToRestore) {
    state.prompt = promptToRestore;
  }
  state.status = 'Ready';
  state.statusTone = 'warn';
  state.error = 'Selected session was unavailable. Choose another session or create a new one.';
  render();
  return true;
}

function isMissingSessionError(error) {
  const code = error?.payload?.error;
  const message = error?.payload?.message || error?.message || '';
  return error?.status === 404 && code === 'session_not_found'
    || /thread not found|session not found|unknown session|unknown thread/i.test(message);
}

async function refreshCurrentSessionMetadata({ hydrateTimeline = false } = {}) {
  if (!state.sessionId) {
    return null;
  }
  const sessionId = state.sessionId;
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (payload?.session) {
      upsertSession(payload.session);
      const session = state.sessions.find((item) => item.id === sessionId) || null;
      if (state.sessionId === sessionId) {
        state.currentSession = session;
        state.cwd = session?.cwd || state.cwd;
        if (hydrateTimeline && session) {
          hydrateCurrentTimelineFromSession(session);
          restoreActiveTurnFromSession(session);
          reconcileActiveTurnFromSession(session);
        }
      }
      if (state.view === 'sessions' || hydrateTimeline) {
        render();
        scrollTimelineToBottom();
      }
      return session;
    }
  } catch (error) {
    if (isMissingSessionError(error)) {
      if (state.sessionId === sessionId) {
        handleMissingSession(error, '');
      } else {
        removeSession(sessionId);
        if (state.view === 'sessions') {
          render();
        }
      }
      return null;
    }
    console.warn('[codex-web] session refresh failed', error);
  }
  return null;
}

async function refreshSessionsList({ renderAfter = true } = {}) {
  state.sessionsLoading = true;
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch('/api/sessions');
    state.sessions = normalizeSessions(payload);
    syncCurrentSessionFromList();
    return state.sessions;
  } finally {
    state.sessionsLoading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function refreshCurrentView() {
  if (!state.token) {
    return;
  }
  const wasPending = state.pendingTurn;
  if (!wasPending) {
    state.status = 'Refreshing';
    state.statusTone = 'warn';
    render();
  }
  try {
    if (state.view === 'chat' && state.sessionId) {
      await refreshCurrentSessionMetadata({ hydrateTimeline: true });
      if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
        streamTurnEvents(state.turnId, { forceReconnect: true });
      }
    } else {
      await refreshSessionsList({ renderAfter: false });
      render();
    }
    if (!state.pendingTurn) {
      state.status = 'Ready';
      state.statusTone = 'success';
      render();
    }
  } catch (error) {
    handleApiError(error);
  }
}

function hydrateCurrentTimelineFromSession(session) {
  const fullHistory = fullHydratedTimelineFromSession(session);
  const hydrated = selectVisibleHydratedTimelineItems(fullHistory);
  if (!fullHistory.length) {
    return false;
  }
  const previousStart = state.sessionHistoryItems.length
    ? Math.min(state.sessionHistoryStartIndex, fullHistory.length)
    : visibleHydratedStartIndex(fullHistory);
  setSessionHistoryWindow(fullHistory, previousStart);
  if (!hydrated.length) {
    return false;
  }
  const currentText = timelineMessageSignature(state.timeline);
  const visibleHydrated = currentVisibleHydratedTimelineItems(fullHistory);
  const hydratedText = timelineMessageSignature(visibleHydrated);
  if (!hydratedText || hydratedText === currentText || currentText.includes(hydratedText)) {
    return false;
  }
  state.timeline = visibleHydrated.map((item) => ({ ...item }));
  state.batches = new Map();
  state.approvals = new Map();
  saveCurrentTimeline();
  return true;
}

function timelineMessageSignature(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'message')
    .map((item) => `${item.role}:${item.text || ''}`)
    .join('\n');
}

function reconcileActiveTurnFromSession(session) {
  if (!state.pendingTurn || !state.turnId) {
    return;
  }
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  const turn = turns.find((item) => item?.id === state.turnId);
  if (!turn || !isTerminalTurnStatus(turn.status)) {
    return;
  }
  state.pendingTurn = false;
  state.streamWasBackgrounded = false;
  state.status = turn.status === 'completed' ? 'Ready' : `Turn ${turn.status}`;
  state.statusTone = turn.status === 'completed' ? 'success' : 'warn';
  state.turnId = null;
  stopStream();
}

function restoreActiveTurnFromSession(session) {
  if (state.pendingTurn && state.turnId) {
    return false;
  }
  const activeTurn = findActiveTurn(session);
  if (!activeTurn?.id) {
    return false;
  }
  state.pendingTurn = true;
  state.turnId = activeTurn.id;
  state.streamWasBackgrounded = true;
  state.lastTurnEventAt = 0;
  state.status = 'Turn running';
  state.statusTone = 'warn';
  return true;
}

function findActiveTurn(session) {
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.id && isActiveTurnStatus(turn.status)) {
      return turn;
    }
  }
  return null;
}

function isActiveTurnStatus(status) {
  const value = normalizeTurnStatus(status);
  if (!value) {
    return false;
  }
  return !isTerminalTurnStatus(value);
}

function isTerminalTurnStatus(status) {
  return ['completed', 'complete', 'failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(normalizeTurnStatus(status));
}

function normalizeTurnStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function removeSession(sessionId) {
  if (!sessionId) {
    return;
  }
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  if (state.currentSession?.id === sessionId) {
    state.currentSession = null;
  }
}

function optimisticallyUpdateSessionInput(text) {
  const input = String(text || '').trim();
  if (!state.sessionId || !input) {
    return;
  }
  const previous = state.sessions.find((session) => session.id === state.sessionId)
    || state.currentSession
    || { id: state.sessionId, cwd: state.cwd };
  const now = Date.now();
  upsertSession({
    ...previous,
    cwd: previous.cwd || state.cwd,
    projectName: previous.projectName || projectNameFromCwd(previous.cwd || state.cwd),
    preview: previous.preview || input,
    firstUserInput: previous.firstUserInput || input,
    lastUserInput: input,
    lastInputAt: now,
    updatedAt: Math.max(previous.updatedAt || 0, now),
  });
}

function normalizeSessions(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((session) => session && typeof session.id === 'string' && session.id)
    .map((session) => ({
      ...session,
      cwd: typeof session.cwd === 'string' ? session.cwd : '',
      projectName: typeof session.projectName === 'string' ? session.projectName : '',
      title: typeof session.title === 'string' ? session.title : '',
      preview: typeof session.preview === 'string' ? session.preview : '',
      firstUserInput: typeof session.firstUserInput === 'string' ? session.firstUserInput : '',
      lastUserInput: typeof session.lastUserInput === 'string' ? session.lastUserInput : '',
      lastInputAt: typeof session.lastInputAt === 'number' ? session.lastInputAt : null,
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : null,
      settings: session.settings && typeof session.settings === 'object' ? session.settings : null,
    }));
}

function syncCurrentSessionFromList() {
  if (!state.sessionId) {
    return;
  }
  const session = state.sessions.find((item) => item.id === state.sessionId);
  if (!session) {
    state.sessionId = null;
    state.currentSession = null;
    return;
  }
  state.currentSession = session;
  state.cwd = session.cwd || '';
}

function upsertSession(session) {
  if (!session?.id) {
    return;
  }
  const [normalized] = normalizeSessions({ items: [session] });
  if (!normalized) {
    return;
  }
  const index = state.sessions.findIndex((item) => item.id === normalized.id);
  const next = mergeSessionSummary(index >= 0 ? state.sessions[index] : null, normalized);
  if (index >= 0) {
    state.sessions[index] = next;
  } else {
    state.sessions.unshift(next);
  }
  if (state.sessionId === next.id) {
    state.currentSession = next;
  }
}

function mergeSessionSummary(previous, next) {
  if (!previous) {
    return next;
  }
  const previousUpdatedAt = previous.updatedAt || 0;
  const nextUpdatedAt = next.updatedAt || 0;
  return {
    ...previous,
    ...next,
    cwd: next.cwd || previous.cwd,
    projectName: next.projectName || previous.projectName,
    title: next.title || previous.title,
    preview: next.preview || previous.preview,
    firstUserInput: next.firstUserInput || previous.firstUserInput,
    lastUserInput: next.lastUserInput || previous.lastUserInput,
    lastInputAt: next.lastInputAt || previous.lastInputAt,
    updatedAt: Math.max(previousUpdatedAt, nextUpdatedAt) || null,
  };
}

function saveCurrentTimeline() {
  if (!state.sessionId) {
    return;
  }
  const timeline = cloneTimelineEntries(state.timeline);
  if (!timeline.length && !state.batches.size && !state.approvals.size) {
    state.timelineCache.delete(state.sessionId);
    persistTimelineCache();
    return;
  }
  state.timelineCache.set(state.sessionId, {
    savedAt: Date.now(),
    timeline,
    batches: cloneCacheMap(state.batches),
    approvals: cloneCacheMap(state.approvals),
  });
  persistTimelineCache();
}

function restoreTimelineForSession(session) {
  resetSessionHistoryWindow();
  const fullHistory = fullHydratedTimelineFromSession(session);
  const cached = state.timelineCache.get(session.id);
  if (cached) {
    state.timeline = cached.timeline.map((item) => ({ ...item }));
    state.batches = new Map(cached.batches);
    state.approvals = new Map(cached.approvals);
    if (fullHistory.length) {
      const currentStart = visibleStartIndexForTimeline(fullHistory, state.timeline);
      setSessionHistoryWindow(fullHistory, currentStart);
    }
    return;
  }
  state.timeline = selectVisibleHydratedTimelineItems(fullHistory);
  setSessionHistoryWindow(fullHistory, visibleHydratedStartIndex(fullHistory));
  state.batches = new Map();
  state.approvals = new Map();
}

function loadTimelineCache() {
  const cache = new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMELINE_CACHE_KEY) || '{"entries":[]}');
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : Array.isArray(parsed)
        ? parsed
        : [];
    for (const entry of entries) {
      const cacheEntry = deserializeTimelineCacheEntry(entry);
      if (cacheEntry) {
        cache.set(cacheEntry.sessionId, cacheEntry.value);
      }
    }
  } catch (_error) {
    localStorage.removeItem(TIMELINE_CACHE_KEY);
  }
  return cache;
}

function persistTimelineCache() {
  const entries = [...state.timelineCache.entries()]
    .map(([sessionId, value]) => serializeTimelineCacheEntry(sessionId, value))
    .filter(Boolean)
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_TIMELINE_CACHE_SESSIONS);
  state.timelineCache = new Map(entries.map((entry) => {
    const cacheEntry = deserializeTimelineCacheEntry(entry);
    return [entry.sessionId, cacheEntry.value];
  }));
  try {
    localStorage.setItem(TIMELINE_CACHE_KEY, JSON.stringify({ entries }));
  } catch (error) {
    console.warn('[codex-web] timeline cache persist failed', error);
  }
}

function serializeTimelineCacheEntry(sessionId, value) {
  if (!sessionId || !value) {
    return null;
  }
  return {
    sessionId,
    savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
    timeline: cloneTimelineEntries(value.timeline || []),
    batches: [...cloneCacheMap(value.batches).entries()],
    approvals: [...cloneCacheMap(value.approvals).entries()],
  };
}

function deserializeTimelineCacheEntry(entry) {
  if (!entry || typeof entry.sessionId !== 'string' || !entry.sessionId) {
    return null;
  }
  const batches = Array.isArray(entry.batches)
    ? entry.batches.filter(isCacheMapPair)
    : [];
  const approvals = Array.isArray(entry.approvals)
    ? entry.approvals.filter(isCacheMapPair)
    : [];
  return {
    sessionId: entry.sessionId,
    value: {
      savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0,
      timeline: cloneTimelineEntries(Array.isArray(entry.timeline) ? entry.timeline : []),
      batches: new Map(batches),
      approvals: new Map(approvals),
    },
  };
}

function isCacheMapPair(pair) {
  return Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string';
}

function cloneCacheMap(map) {
  const entries = map instanceof Map
    ? [...map.entries()]
    : Array.isArray(map)
      ? map.filter(isCacheMapPair)
      : [];
  return new Map(entries.slice(-MAX_TIMELINE_CACHE_MAP_ITEMS).map(([key, value]) => [
    key,
    sanitizeCacheValue(value),
  ]));
}

function sanitizeCacheValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_TIMELINE_SUMMARY_TEXT
      ? value.slice(0, MAX_TIMELINE_SUMMARY_TEXT)
      : value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_TIMELINE_SUMMARY_DEPTH) {
      return [];
    }
    return value.slice(0, MAX_TIMELINE_SUMMARY_ARRAY_ITEMS)
      .map((item) => sanitizeCacheValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_TIMELINE_SUMMARY_DEPTH) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_TIMELINE_SUMMARY_OBJECT_KEYS)
        .map(([key, item]) => [key, sanitizeCacheValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function cloneTimelineEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .slice(-MAX_TIMELINE_CACHE_ITEMS)
    .map(cloneTimelineItem)
    .filter(Boolean);
}

function cloneTimelineItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const clone = { ...item };
  if (typeof clone.text === 'string' && clone.text.length > MAX_TIMELINE_ITEM_TEXT) {
    clone.text = `${clone.text.slice(0, MAX_TIMELINE_ITEM_TEXT)}...`;
  }
  return clone;
}

function hydrateTimelineFromSession(session) {
  return selectVisibleHydratedTimelineItems(fullHydratedTimelineFromSession(session));
}

function fullHydratedTimelineFromSession(session) {
  const items = [];
  const turns = Array.isArray(session.thread?.turns) ? session.thread.turns : [];
  for (const turn of turns) {
    for (const item of turn.items || []) {
      const role = timelineRoleForThreadItem(item);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      items.push({
        id: `history_${turn.id}_${items.length}`,
        kind: 'message',
        role,
        label: role === 'user' ? 'You' : 'Assistant',
        meta: 'history',
        text,
      });
    }
  }
  if (!items.length) {
    const preview = firstInputForSession(session);
    return preview ? [{
      id: `history_preview_${session.id}`,
      kind: 'message',
      role: 'user',
      label: 'You',
      meta: 'preview',
      text: preview,
    }] : [];
  }
  return items;
}

function selectVisibleHydratedTimelineItems(items) {
  return items.slice(visibleHydratedStartIndex(items));
}

function currentVisibleHydratedTimelineItems(items) {
  if (!state.sessionHistoryItems.length) {
    return selectVisibleHydratedTimelineItems(items);
  }
  return state.sessionHistoryItems.slice(state.sessionHistoryStartIndex);
}

function visibleHydratedStartIndex(items) {
  const completeExchangeStarts = findCompleteExchangeStarts(items);
  if (completeExchangeStarts.length < MIN_HYDRATED_COMPLETE_EXCHANGES) {
    return 0;
  }
  return completeExchangeStarts[completeExchangeStarts.length - MIN_HYDRATED_COMPLETE_EXCHANGES];
}

function setSessionHistoryWindow(items, startIndex) {
  state.sessionHistoryItems = (Array.isArray(items) ? items : []).map((item) => ({ ...item }));
  state.sessionHistoryStartIndex = Math.max(0, Math.min(
    Number.isFinite(startIndex) ? Math.floor(startIndex) : 0,
    state.sessionHistoryItems.length,
  ));
}

function visibleStartIndexForTimeline(historyItems, timelineItems) {
  const historySignature = timelineMessageSignature(historyItems);
  const timelineSignature = timelineMessageSignature(timelineItems);
  if (!historySignature || !timelineSignature) {
    return visibleHydratedStartIndex(historyItems);
  }
  if (historySignature === timelineSignature) {
    return 0;
  }
  for (let index = 0; index < historyItems.length; index += 1) {
    if (timelineMessageSignature(historyItems.slice(index)) === timelineSignature) {
      return index;
    }
  }
  return visibleHydratedStartIndex(historyItems);
}

function showMoreSessionHistory() {
  if (state.view !== 'chat' || !state.sessionId) {
    return false;
  }
  let historyItems = state.sessionHistoryItems;
  if (!historyItems.length && state.currentSession) {
    historyItems = fullHydratedTimelineFromSession(state.currentSession);
    setSessionHistoryWindow(historyItems, visibleStartIndexForTimeline(historyItems, state.timeline));
  }
  if (!state.sessionHistoryItems.length || state.sessionHistoryStartIndex <= 0) {
    return false;
  }
  const previousStarts = findCompleteExchangeStarts(state.sessionHistoryItems)
    .filter((index) => index < state.sessionHistoryStartIndex);
  const nextStart = previousStarts.length
    ? previousStarts[previousStarts.length - 1]
    : 0;
  if (nextStart === state.sessionHistoryStartIndex) {
    return false;
  }
  const oldScrollHeight = document.querySelector('#timeline')?.scrollHeight || 0;
  state.sessionHistoryStartIndex = nextStart;
  state.timeline = state.sessionHistoryItems.slice(nextStart).map((item) => ({ ...item }));
  state.batches = new Map();
  state.approvals = new Map();
  saveCurrentTimeline();
  render();
  restoreExpandedTimelineScroll(oldScrollHeight);
  return true;
}

function restoreExpandedTimelineScroll(previousScrollHeight) {
  requestAnimationFrame(() => {
    const timeline = document.querySelector('#timeline');
    if (!timeline || !previousScrollHeight) {
      return;
    }
    timeline.scrollTop = Math.max(0, timeline.scrollHeight - previousScrollHeight);
  });
}

function findCompleteExchangeStarts(items) {
  const starts = [];
  let userIndex = -1;
  let hasAssistantAnswer = false;
  for (let index = 0; index < items.length; index += 1) {
    const role = items[index]?.role;
    if (role === 'user') {
      if (userIndex >= 0 && hasAssistantAnswer) {
        starts.push(userIndex);
      }
      userIndex = index;
      hasAssistantAnswer = false;
      continue;
    }
    if (role === 'assistant' && userIndex >= 0) {
      hasAssistantAnswer = true;
    }
  }
  if (userIndex >= 0 && hasAssistantAnswer) {
    starts.push(userIndex);
  }
  return starts;
}

function normalizeMessageRole(role) {
  const value = typeof role === 'string' ? role.toLowerCase() : '';
  if (value === 'user' || value === 'assistant') {
    return value;
  }
  return null;
}

function timelineRoleForThreadItem(item) {
  const role = normalizeMessageRole(item.role);
  if (role) {
    return role;
  }
  const type = String(item.type || '').replace(/[^a-z]/giu, '').toLowerCase();
  if (type.includes('assistant') || type.includes('agent')) {
    return 'assistant';
  }
  if (type.includes('user')) {
    return 'user';
  }
  return null;
}

function sortedSessions() {
  const sessions = filteredSessions();
  return sessions.sort((left, right) => lastInputAtForSession(right) - lastInputAtForSession(left));
}

function filteredSessions() {
  if (state.sortMode === 'favorites') {
    return state.sessions.filter(isFavoriteSession);
  }
  return [...state.sessions];
}

function uniqueSessionPaths() {
  const paths = [];
  const seen = new Set();
  const sessions = [...state.sessions].sort((left, right) => lastInputAtForSession(right) - lastInputAtForSession(left));
  for (const session of sessions) {
    const cwd = session.cwd || '';
    if (!cwd || seen.has(cwd)) {
      continue;
    }
    seen.add(cwd);
    paths.push(cwd);
  }
  return paths;
}

function projectNameForSession(session, fallbackCwd = '') {
  return session?.projectName || projectNameFromCwd(session?.cwd || fallbackCwd) || 'New Session';
}

function isFavoriteSession(session) {
  return session?.favorite === true || session?.settings?.metadata?.favorite === true;
}

function projectNameFromCwd(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/u).filter(Boolean);
  if (!parts.length) {
    return '';
  }
  return parts.slice(-2).join('/');
}

function firstInputForSession(session) {
  return session?.firstUserInput || session?.preview || session?.title || '';
}

function previewInputForSession(session) {
  return session?.lastUserInput || firstInputForSession(session);
}

function lastInputAtForSession(session) {
  return session?.lastInputAt || session?.updatedAt || 0;
}

function applyPermissionPreset(preset) {
  state.permissionPreset = preset;
  if (preset === 'read-only') {
    state.approvalPolicy = 'never';
    state.sandboxMode = 'read-only';
    return;
  }
  if (preset === 'full-access') {
    state.approvalPolicy = 'never';
    state.sandboxMode = 'danger-full-access';
    return;
  }
  state.approvalPolicy = 'on-request';
  state.sandboxMode = 'workspace-write';
}

function applyDefaultSettings() {
  state.model = DEFAULT_MODEL;
  state.reasoningEffort = DEFAULT_REASONING_EFFORT;
  state.collaborationMode = DEFAULT_COLLABORATION_MODE;
  applyPermissionPreset(DEFAULT_PERMISSION_PRESET);
}

function applySessionSettings(session) {
  const settings = session?.settings;
  if (!settings || typeof settings !== 'object') {
    applyDefaultSettings();
    return;
  }
  state.model = typeof settings.model === 'string' && settings.model
    ? settings.model
    : DEFAULT_MODEL;
  state.reasoningEffort = typeof settings.reasoningEffort === 'string' && settings.reasoningEffort
    ? settings.reasoningEffort
    : DEFAULT_REASONING_EFFORT;
  state.collaborationMode = typeof settings.collaborationMode === 'string' && settings.collaborationMode
    ? settings.collaborationMode
    : DEFAULT_COLLABORATION_MODE;
  const preset = typeof settings.accessPreset === 'string' && settings.accessPreset
    ? settings.accessPreset
    : permissionPresetFromSettings(settings);
  state.permissionPreset = preset;
  state.approvalPolicy = typeof settings.approvalPolicy === 'string' && settings.approvalPolicy
    ? settings.approvalPolicy
    : approvalPolicyForPreset(preset);
  state.sandboxMode = typeof settings.sandboxMode === 'string' && settings.sandboxMode
    ? settings.sandboxMode
    : sandboxModeForPreset(preset);
}

function permissionPresetFromSettings(settings) {
  if (settings?.sandboxMode === 'read-only') {
    return 'read-only';
  }
  if (settings?.sandboxMode === 'danger-full-access' || settings?.approvalPolicy === 'never') {
    return 'full-access';
  }
  return 'default';
}

function approvalPolicyForPreset(preset) {
  return preset === 'default' ? 'on-request' : 'never';
}

function sandboxModeForPreset(preset) {
  if (preset === 'read-only') {
    return 'read-only';
  }
  if (preset === 'full-access') {
    return 'danger-full-access';
  }
  return 'workspace-write';
}

async function updateSessionSettings(patch = {}) {
  const settings = {
    ...collectSettings(),
    ...patch,
  };
  if (!state.sessionId) {
    return null;
  }
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/settings`, {
      method: 'PATCH',
      body: settings,
    });
    if (payload?.session) {
      upsertSession(payload.session);
      if (state.currentSession?.id === payload.session.id) {
        state.currentSession = state.sessions.find((session) => session.id === payload.session.id) || payload.session;
      }
    }
    state.error = '';
    return payload?.session || null;
  } catch (error) {
    if (handleMissingSession(error, '')) {
      return null;
    }
    handleApiError(error);
    return null;
  }
}

function appendMessage(entry) {
  state.timeline.push(entry);
}

function appendOrReplace(entry, matcher) {
  const index = state.timeline.findIndex(matcher);
  if (index >= 0) {
    state.timeline[index] = entry;
  } else {
    state.timeline.push(entry);
  }
}

function collectSettings() {
  return {
    model: state.model || DEFAULT_MODEL,
    reasoningEffort: state.reasoningEffort || DEFAULT_REASONING_EFFORT,
    collaborationMode: state.collaborationMode || DEFAULT_COLLABORATION_MODE,
    accessPreset: state.permissionPreset || DEFAULT_PERMISSION_PRESET,
    approvalPolicy: state.approvalPolicy || DEFAULT_APPROVAL_POLICY,
    sandboxMode: state.sandboxMode || DEFAULT_SANDBOX_MODE,
    personality: 'pragmatic',
  };
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('[codex-web] service worker registration failed', error);
    });
  });
}

function isStandalonePwa() {
  return window.navigator?.standalone === true
    || navigator.standalone === true
    || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

function setupPwaPullToRefresh() {
  if (!isStandalonePwa()) {
    return;
  }
  if (!window.CodexPullToRefresh || typeof window.CodexPullToRefresh.init !== 'function') {
    return;
  }
  pullToRefreshCleanup = window.CodexPullToRefresh.init({
    root: document.querySelector('#app'),
    getScrollContainer: getActiveScrollContainer,
    threshold: 120,
    onRefresh: (pull) => {
      return handlePwaPullRefresh(pull);
    },
  });
}

function handlePwaPullRefresh(pull = {}) {
  if (state.view === 'chat') {
    if (isTimelinePullTarget(pull.target)) {
      if (showMoreSessionHistory()) {
        return Promise.resolve();
      }
      return Promise.resolve();
    }
    if (isChatTitlePullTarget(pull.target)) {
      return refreshCurrentView();
    }
    return Promise.resolve();
  }
  return refreshCurrentView();
}

function isTimelinePullTarget(target) {
  return Boolean(target?.closest?.('.timeline'));
}

function isChatTitlePullTarget(target) {
  return Boolean(target?.closest?.('.chat-topbar, .project-title'));
}

function getActiveScrollContainer(pull = {}) {
  if (state.view === 'chat' && isChatTitlePullTarget(pull.target)) {
    return null;
  }
  return document.querySelector('.timeline')
    || document.querySelector('.session-list')
    || document.querySelector('.new-session-page')
    || document.scrollingElement;
}

function setupEdgeSwipeBackNavigation() {
  document.addEventListener('touchstart', onEdgeSwipeStart, { passive: true });
  document.addEventListener('touchmove', onEdgeSwipeMove, { passive: true });
  document.addEventListener('touchend', onEdgeSwipeEnd, { passive: true });
  document.addEventListener('touchcancel', resetEdgeSwipeNavigation, { passive: true });
}

function onEdgeSwipeStart(event) {
  if (state.view !== 'chat') {
    return;
  }
  if (!event.touches || event.touches.length !== 1) {
    return;
  }
  const touch = event.touches[0];
  if (touch.clientX > EDGE_SWIPE_START_PX) {
    return;
  }
  edgeSwipeStart = {
    x: touch.clientX,
    y: touch.clientY,
    shouldReturn: false,
  };
}

function onEdgeSwipeMove(event) {
  if (!edgeSwipeStart || !event.touches || event.touches.length !== 1) {
    return;
  }
  const touch = event.touches[0];
  const deltaX = touch.clientX - edgeSwipeStart.x;
  const deltaY = Math.abs(touch.clientY - edgeSwipeStart.y);
  if (deltaX < 0 || deltaY > EDGE_SWIPE_MAX_VERTICAL_PX) {
    resetEdgeSwipeNavigation();
    return;
  }
  edgeSwipeStart.shouldReturn = deltaX >= EDGE_SWIPE_TRIGGER_PX;
}

function onEdgeSwipeEnd() {
  const shouldReturn = edgeSwipeStart?.shouldReturn;
  resetEdgeSwipeNavigation();
  if (shouldReturn && state.view === 'chat') {
    showSessionList();
  }
}

function resetEdgeSwipeNavigation() {
  edgeSwipeStart = null;
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    if (state.pendingTurn) {
      state.streamWasBackgrounded = true;
    }
    return;
  }
  if (document.visibilityState === 'visible') {
    void recoverActiveTurnAfterForeground();
  }
}

function onPageResume() {
  if (document.visibilityState === 'hidden') {
    return;
  }
  void recoverActiveTurnAfterForeground();
}

function isTurnStreamHealthy() {
  if (!state.pendingTurn || !state.turnId) {
    return true;
  }
  if (!state.streamAbortController || state.streamWasBackgrounded) {
    return false;
  }
  return Date.now() - (state.lastTurnEventAt || 0) < STREAM_STALE_MS;
}

async function recoverActiveTurnAfterForeground() {
  if (!state.authSession || !state.sessionId) {
    return;
  }
  const shouldReconnect = state.pendingTurn && state.turnId && !isTurnStreamHealthy();
  await refreshCurrentSessionMetadata({ hydrateTimeline: true });
  if (shouldReconnect && state.pendingTurn && state.turnId) {
    streamTurnEvents(state.turnId, { forceReconnect: true });
  }
}

function stopStream() {
  if (state.streamAbortController) {
    state.streamAbortController.abort();
    state.streamAbortController = null;
  }
}

function isNetworkStreamError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /load failed|network|fetch|terminated|abort|connection|offline/i.test(message);
}

async function apiFetch(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.skipAuth ? {} : state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function buildApiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
  }
  const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  return error;
}

function handleApiError(error, options = {}) {
  const payload = error?.payload || null;
  const code = payload?.error;
  const message = payload?.message || error?.message || 'Request failed';
  if (code === 'setup_required') {
    state.setupRequired = true;
    state.setupMessage = message;
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    stopStream();
    render();
    return;
  }
  if (error?.status === 401 || options.auth) {
    localStorage.removeItem(TOKEN_KEY);
    state.token = '';
    state.setupRequired = false;
    setLoggedOut(options.login ? message : 'Session expired');
    return;
  }
  state.error = message;
  if (options.login) {
    state.loginError = message;
    state.status = 'Login required';
    state.statusTone = 'danger';
  } else {
    state.status = 'Request failed';
    state.statusTone = 'danger';
  }
  render();
}

function pickModel(models, current) {
  if (current) {
    return current;
  }
  const first = models.find((model) => model?.id || model?.name);
  return first?.id || first?.name || '';
}

function inferDeviceName() {
  return navigator.userAgent.includes('iPhone')
    ? 'iPhone Safari'
    : navigator.userAgent.includes('Android')
      ? 'Android Browser'
      : 'Phone browser';
}

function scrollTimelineToBottom() {
  requestAnimationFrame(() => {
    const timeline = document.querySelector('#timeline');
    if (timeline) {
      timeline.scrollTop = timeline.scrollHeight;
    }
  });
}

function startCase(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatSummaryValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatShortDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatShortDateTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shorten(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function renderMarkdown(value) {
  const text = String(value || '').replace(/\r\n?/gu, '\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let quoteLines = [];
  let codeLines = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) {
      return;
    }
    blocks.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join('')}</blockquote>`);
    quoteLines = [];
  };
  const flushCode = () => {
    blocks.push(`<pre><code>${escapeHtml(`${codeLines.join('\n')}\n`)}</code></pre>`);
    codeLines = [];
  };
  const flushTextBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of text.split('\n')) {
    if (/^```/u.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushTextBlocks();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushTextBlocks();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushTextBlocks();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/u);
    if (listItem) {
      flushParagraph();
      flushQuote();
      listItems.push(listItem[1]);
      continue;
    }
    const quote = line.match(/^>\s?(.+)$/u);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  if (inCode) {
    flushCode();
  } else {
    flushTextBlocks();
  }
  return blocks.join('');
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/gu, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
