const TOKEN_KEY = 'codexWebToken';
const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  authSession: null,
  models: [],
  sessions: [],
  currentSession: null,
  sessionId: null,
  cwd: '',
  turnId: null,
  pendingTurn: false,
  setupRequired: false,
  setupMessage: '',
  loginError: '',
  error: '',
  status: 'Checking auth',
  statusTone: 'warn',
  prompt: '',
  model: '',
  reasoningEffort: 'medium',
  collaborationMode: 'default',
  timeline: [],
  batches: new Map(),
  approvals: new Map(),
  streamAbortController: null,
};

const app = document.querySelector('#app');

bootstrap();

async function bootstrap() {
  render();
  if (!state.token) {
    setLoggedOut();
    return;
  }
  await restoreAuth();
}

async function restoreAuth() {
  try {
    state.status = 'Restoring session';
    render();
    const [{ session }, modelsPayload, sessionsPayload] = await Promise.all([
      apiFetch('/api/auth/me'),
      apiFetch('/api/models').catch(() => ({ items: [] })),
      apiFetch('/api/sessions').catch(() => ({ items: [] })),
    ]);
    state.authSession = session;
    state.models = Array.isArray(modelsPayload.items) ? modelsPayload.items : [];
    state.sessions = normalizeSessions(sessionsPayload);
    state.model = pickModel(state.models, state.model);
    syncCurrentSessionFromList();
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    render();
  } catch (error) {
    handleApiError(error, { auth: true });
  }
}

function setLoggedOut(message = '') {
  state.authSession = null;
  state.sessions = [];
  state.sessionId = null;
  state.currentSession = null;
  state.cwd = '';
  state.turnId = null;
  state.pendingTurn = false;
  state.timeline = [];
  state.batches = new Map();
  state.approvals = new Map();
  state.status = 'Login required';
  state.statusTone = 'warn';
  state.error = '';
  state.loginError = message;
  stopStream();
  render();
}

function render() {
  app.innerHTML = '';
  if (state.setupRequired) {
    app.appendChild(renderSetup());
    bindGlobalEvents();
    return;
  }
  if (!state.authSession) {
    app.appendChild(renderLogin());
    bindGlobalEvents();
    return;
  }
  app.appendChild(renderMain());
  bindGlobalEvents();
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
        <div class="field">
          <label for="deviceName">Device name</label>
          <input id="deviceName" name="deviceName" type="text" autocomplete="organization" placeholder="Phone browser">
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
  const shell = document.createElement('div');
  shell.className = 'shell';
  const workspace = currentWorkspaceLabel();
  const sessionMeta = state.sessionId
    ? shorten(state.sessionId, 42)
    : 'Session starts on first send';
  shell.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-main">
          <div class="brand">Codex Web</div>
          <div class="workspace"><strong>${escapeHtml(shorten(workspace, 48))}</strong>${escapeHtml(sessionMeta)}</div>
        </div>
        <div class="topbar-meta">
          <span class="status-pill" data-tone="${escapeHtml(state.statusTone)}"><span class="status-dot"></span>${escapeHtml(state.status)}</span>
          <button class="ghost" type="button" id="logout-button">Log out</button>
        </div>
        <div class="session-strip">
          <div class="session-picker">
            <label for="session-select">Session</label>
            <select id="session-select" name="sessionId" ${state.pendingTurn ? 'disabled' : ''}>${renderSessionOptions()}</select>
          </div>
          <button class="ghost compact-button" type="button" id="new-session-button" ${state.pendingTurn ? 'disabled' : ''}>New</button>
        </div>
      </header>
      <main class="timeline" id="timeline">${renderTimeline()}</main>
      <div class="composer-wrap">
        <form class="composer" id="composer-form">
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
              <label for="cwd-input">${state.sessionId ? 'Session CWD' : 'New CWD'}</label>
              <input id="cwd-input" type="text" value="${escapeAttribute(state.cwd)}" placeholder="Server default" ${state.sessionId ? 'disabled' : ''}>
            </div>
          </div>
          <textarea id="prompt-input" name="prompt" placeholder="Send a turn to Codex" ${state.pendingTurn ? 'disabled' : ''}>${escapeHtml(state.prompt)}</textarea>
          <div class="composer-actions">
            <div class="composer-note">${escapeHtml(state.error || sessionComposerNote())}</div>
            <div class="actions" style="flex: 0 0 auto; min-width: 152px;">
              <button class="${state.pendingTurn ? 'danger' : 'primary'}" type="${state.pendingTurn ? 'button' : 'submit'}" id="${state.pendingTurn ? 'stop-button' : 'send-button'}">
                ${state.pendingTurn ? 'Stop' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
  return shell;
}

function renderTimeline() {
  if (!state.timeline.length) {
    return '<div class="empty-state">No turns yet.</div>';
  }
  return state.timeline.map((item) => renderTimelineItem(item)).join('');
}

function renderTimelineItem(item) {
  if (item.kind === 'message') {
    return `
      <article class="card message-card ${escapeHtml(item.role)}">
        <div class="card-header">
          <span class="card-title">${escapeHtml(item.label)}</span>
          <span class="card-kind">${escapeHtml(item.meta || '')}</span>
        </div>
        <p class="message-text">${escapeHtml(item.text)}</p>
      </article>
    `;
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

function renderSummary(summary) {
  const entries = Object.entries(summary || {}).filter(([, value]) => {
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
  });
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
  }
  return options.map((option) => {
    const value = option.id || '';
    const selected = value === current ? ' selected' : '';
    return `<option value="${escapeAttribute(value)}"${selected}>${escapeHtml(option.label)}</option>`;
  }).join('');
}

function renderSessionOptions() {
  const options = [
    `<option value=""${state.sessionId ? '' : ' selected'}>New session</option>`,
  ];
  for (const session of state.sessions) {
    const selected = session.id === state.sessionId ? ' selected' : '';
    options.push(`<option value="${escapeAttribute(session.id)}"${selected}>${escapeHtml(sessionOptionLabel(session))}</option>`);
  }
  return options.join('');
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

  const sessionSelect = document.querySelector('#session-select');
  if (sessionSelect) {
    sessionSelect.addEventListener('change', (event) => {
      void selectSession(event.target.value);
    });
  }

  const newSessionButton = document.querySelector('#new-session-button');
  if (newSessionButton) {
    newSessionButton.addEventListener('click', () => {
      startNewSession({ preserveCwd: true });
    });
  }

  const promptInput = document.querySelector('#prompt-input');
  if (promptInput) {
    promptInput.addEventListener('input', (event) => {
      state.prompt = event.target.value;
    });
  }

  const cwdInput = document.querySelector('#cwd-input');
  if (cwdInput) {
    cwdInput.addEventListener('input', (event) => {
      state.cwd = event.target.value;
    });
  }

  const modelSelect = document.querySelector('#model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (event) => {
      state.model = event.target.value;
    });
  }

  const reasoningSelect = document.querySelector('#reasoning-select');
  if (reasoningSelect) {
    reasoningSelect.addEventListener('change', (event) => {
      state.reasoningEffort = event.target.value;
    });
  }

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => {
      state.collaborationMode = button.getAttribute('data-mode') || 'default';
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

async function onLoginSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');
  const deviceName = String(form.get('deviceName') || '').trim() || inferDeviceName();
  state.loginError = '';
  state.status = 'Logging in';
  state.statusTone = 'warn';
  render();
  try {
    const payload = await apiFetch('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: { password, deviceName },
    });
    state.token = payload.token;
    localStorage.setItem(TOKEN_KEY, payload.token);
    state.setupRequired = false;
    state.setupMessage = '';
    await restoreAuth();
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
  state.token = '';
  setLoggedOut();
}

async function selectSession(sessionId) {
  if (state.pendingTurn) {
    render();
    return;
  }
  const nextSession = state.sessions.find((session) => session.id === sessionId) || null;
  if (!nextSession) {
    startNewSession({ preserveCwd: true });
    return;
  }
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
  state.sessionId = refreshedSession.id;
  state.currentSession = refreshedSession;
  state.cwd = refreshedSession.cwd || '';
  resetTurnState();
  state.error = '';
  state.status = 'Ready';
  state.statusTone = 'success';
  render();
}

function startNewSession(options = {}) {
  if (state.pendingTurn) {
    render();
    return;
  }
  stopStream();
  const nextCwd = options.preserveCwd ? state.cwd : '';
  state.sessionId = null;
  state.currentSession = null;
  state.cwd = nextCwd;
  resetTurnState();
  state.error = '';
  state.status = 'Ready';
  state.statusTone = 'success';
  render();
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
    const settings = collectSettings();
    const turn = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: {
        text: promptToSend,
        settings,
      },
    });
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

async function streamTurnEvents(turnId) {
  stopStream();
  const controller = new AbortController();
  state.streamAbortController = controller;
  let assistantEntry = null;
  let buffer = '';
  let eventName = 'message';
  let eventId = '';
  let dataLines = [];

  try {
    const response = await fetch(`/api/turns/${encodeURIComponent(turnId)}/events`, {
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
      upsertStatusCard(`turn_${event.turnId}`, 'Turn started', event.turnId);
      state.status = 'Turn running';
      state.statusTone = 'warn';
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
      upsertBatch(event.batchId, {
        id: `batch_${event.batchId}`,
        kind: 'batch',
        batchId: event.batchId,
        batchKind: event.kind,
        title: event.title || 'Batch',
        status: 'started',
        summary: {},
      });
      break;
    case 'batch.updated':
      upsertBatch(event.batchId, {
        summary: event.summary || {},
      });
      break;
    case 'batch.completed':
      upsertBatch(event.batchId, {
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
      appendOrReplace(approval, (item) => item.id === approval.id);
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
      }
      state.status = 'Approval resolved';
      state.statusTone = 'warn';
      break;
    }
    case 'turn.completed':
      state.pendingTurn = false;
      state.status = event.status === 'completed' ? 'Ready' : `Turn ${event.status}`;
      state.statusTone = event.status === 'completed' ? 'success' : 'warn';
      state.turnId = null;
      stopStream();
      upsertStatusCard(`turn_${event.turnId}`, 'Turn completed', event.status);
      break;
    case 'turn.failed':
      state.pendingTurn = false;
      state.status = 'Turn failed';
      state.statusTone = 'danger';
      state.turnId = null;
      stopStream();
      upsertStatusCard(`turn_${event.turnId}`, 'Turn failed', event.message);
      break;
  }
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

function upsertStatusCard(id, title, text) {
  appendOrReplace({
    id,
    kind: 'status',
    title,
    meta: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text,
  }, (item) => item.id === id);
}

function resetTurnState() {
  state.turnId = null;
  state.pendingTurn = false;
  state.timeline = [];
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
  state.batches = new Map();
  state.approvals = new Map();
  if (promptToRestore) {
    state.prompt = promptToRestore;
  }
  state.status = 'Ready';
  state.statusTone = 'warn';
  state.error = 'Selected session was not found. Start a new session.';
  render();
  return true;
}

function isMissingSessionError(error) {
  const code = error?.payload?.error;
  const message = error?.payload?.message || error?.message || '';
  return error?.status === 404 && code === 'session_not_found'
    || /thread not found|session not found|unknown session|unknown thread/i.test(message);
}

function normalizeSessions(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((session) => session && typeof session.id === 'string' && session.id)
    .map((session) => ({
      ...session,
      cwd: typeof session.cwd === 'string' ? session.cwd : '',
      title: typeof session.title === 'string' ? session.title : '',
      preview: typeof session.preview === 'string' ? session.preview : '',
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : null,
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
  if (index >= 0) {
    state.sessions[index] = normalized;
  } else {
    state.sessions.unshift(normalized);
  }
  state.currentSession = normalized;
}

function currentWorkspaceLabel() {
  if (state.currentSession) {
    return state.currentSession.cwd || state.currentSession.title || 'Selected session';
  }
  return state.cwd.trim() || 'New session';
}

function sessionComposerNote() {
  if (state.sessionId) {
    return 'Selected session CWD is fixed. New uses the New button.';
  }
  return 'New session starts on Send with the New CWD above.';
}

function sessionOptionLabel(session) {
  const primary = session.title || session.cwd || session.preview || 'Untitled session';
  const secondary = session.updatedAt ? formatShortDate(session.updatedAt) : shorten(session.id, 10);
  return `${shorten(primary, 34)} - ${secondary}`;
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
    model: state.model || null,
    reasoningEffort: state.reasoningEffort || null,
    collaborationMode: state.collaborationMode || 'default',
    personality: 'pragmatic',
  };
}

function stopStream() {
  if (state.streamAbortController) {
    state.streamAbortController.abort();
    state.streamAbortController = null;
  }
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
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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

function shorten(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
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
