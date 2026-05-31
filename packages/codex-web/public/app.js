const APP_BUILD_ID = '__CODEX_WEB_BUILD_ID__';
const TOKEN_KEY = 'codexWebToken';
const TIMELINE_CACHE_KEY = 'codexWebTimelineCache';
const QUEUED_MESSAGES_KEY = 'codexWebQueuedMessages';
const THEME_KEY = 'codexWebTheme';
const SITE_TITLE_KEY = 'codexWebSiteTitle';
const DEFAULT_THREAD_SETTINGS_KEY = 'codexWebDefaultThreadSettings';
const MESSAGE_FONT_SIZE_KEY = 'codexWebMessageFontSize';
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
const DEFAULT_THEME = 'dark';
const DEFAULT_SITE_TITLE = 'Codex Web';
const DEFAULT_MESSAGE_FONT_SIZE = 'medium';
const PROMPT_TEXTAREA_MAX_HEIGHT = 116;
const DESKTOP_PROMPT_TEXTAREA_MAX_HEIGHT = 220;
const PROMPT_EXPAND_LINE_THRESHOLD = 4;
const STREAM_STALE_MS = 30_000;
const FIRST_TURN_RECOVERY_DELAY_MS = 10_000;
const DESKTOP_WORKSPACE_MIN_WIDTH = 820;
const EDGE_SWIPE_START_PX = 24;
const EDGE_SWIPE_TRIGGER_PX = 72;
const EDGE_SWIPE_MAX_VERTICAL_PX = 48;
const TIMELINE_FOLLOW_LATEST_TOLERANCE_PX = 24;
const NON_RUNTIME_STATUS_LABELS = new Set([
  'Checking auth',
  'Loading',
  'Restoring session',
  'Syncing sessions',
  'Logging in',
  'Login required',
  'Refreshing',
  'Starting session',
  'Loading session',
  'Starting turn',
  'Waiting for first response',
  'Request failed',
  'Stream failed',
  'Reloading runtime',
  'Runtime reloaded',
  'Approval sent',
  'Approval resolved',
  'Interrupt requested',
  'Session archived',
  'Session favorited',
  'Favorite removed',
  'Creating share link',
  'Share link copied',
  'Share link ready',
  'Uploading attachment',
  'Attachment uploaded',
  'Upload failed',
]);

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  authSession: null,
  models: [],
  projects: [],
  projectsLoaded: false,
  newProjectId: '',
  admin: {
    loading: false,
    loaded: false,
    settings: null,
    projects: [],
    users: [],
    roles: [],
    sessions: [],
    page: 'projects',
    filterUserId: '',
    filterProjectId: '',
    editingProjectId: '',
    editingRoleId: '',
  },
  sessions: [],
  sessionsByScope: {
    favorites: [],
    all: [],
  },
  sessionsLoadedByScope: {
    favorites: false,
    all: false,
  },
  sessionsLoading: false,
  sessionsLoadingScope: null,
  sessionsRequestId: 0,
  reports: [],
  reportsLoading: false,
  reportsLoaded: false,
  reportsRequestId: 0,
  reportProject: '',
  currentReport: null,
  currentReportContent: '',
  currentReportLoading: false,
  reportReturnView: 'reports',
  reportsReturnView: 'sessions',
  currentSession: null,
  sessionId: null,
  draftSessionActive: false,
  view: 'sessions',
  selectedProjectKey: '',
  selectedProjectId: '',
  selectedProjectLabel: '',
  mobileSidebarOpen: false,
  desktopSettingsOpen: false,
  desktopOverlay: null,
  theme: normalizeTheme(localStorage.getItem(THEME_KEY)),
  siteTitle: normalizeSiteTitle(localStorage.getItem(SITE_TITLE_KEY)),
  messageFontSize: normalizeMessageFontSize(localStorage.getItem(MESSAGE_FONT_SIZE_KEY)),
  defaultThreadSettings: loadDefaultThreadSettings(),
  sortMode: 'time',
  sessionsScope: 'all',
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
  promptDrafts: new Map(),
  composerAttachments: [],
  queuedMessages: loadQueuedMessages(),
  queuedMessageSending: false,
  queuedInterruptRequestedTurnId: null,
  queuedInterruptEligibleTurnId: null,
  composerCanExpand: false,
  composerExpanded: false,
  timelineShouldFollowLatest: true,
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
  shareDialog: null,
};

const app = document.querySelector('#app');
let composerResizeObserver = null;
let composerOffsetRun = 0;
let pullToRefreshCleanup = null;
let edgeSwipeStart = null;
let allSessionsPreloadPromise = null;
let promptFocusRestoreTimer = null;
let promptFocusLayoutTimer = null;
let sessionListRestoreScrollTop = null;
let timelineScrollTrackingAttached = false;
let chatTimelineReturnSnapshot = null;
let chatTimelineForegroundSnapshot = null;
let chatTimelineViewportSnapshot = null;
let nextTimelineRestoreSnapshot = null;
let sharedSessionLoadPromise = null;

bootstrap();
applyTheme(state.theme, { persist: false });
applySiteTitle(state.siteTitle, { persist: false });
applyMessageFontSize(state.messageFontSize, { persist: false });
registerServiceWorker();
setupPwaPullToRefresh();
setupEdgeSwipeBackNavigation();
setupAppVersionRefresh();
setupMobileOrientationLock();
document.addEventListener('visibilitychange', onVisibilityChange);
document.addEventListener('click', handleSessionSettingsOutsideClick);
window.addEventListener('resize', () => {
  handleLayoutResize();
  render();
});
window.addEventListener('pageshow', onPageResume);
window.addEventListener('focus', onPageResume);

function bootstrap() {
  if (isShareRoute()) {
    render();
    void loadSharedSessionFromLocation();
    return;
  }
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

function isShareRoute() {
  return /^\/share\/[^/]+$/u.test(window.location?.pathname || '');
}

function shareTokenFromLocation() {
  const match = String(window.location?.pathname || '').match(/^\/share\/([^/]+)$/u);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function loadSharedSessionFromLocation() {
  if (sharedSessionLoadPromise) {
    return sharedSessionLoadPromise;
  }
  sharedSessionLoadPromise = loadSharedSessionFromLocationOnce().catch((error) => {
    sharedSessionLoadPromise = null;
    throw error;
  });
  return sharedSessionLoadPromise;
}

async function loadSharedSessionFromLocationOnce() {
  const token = shareTokenFromLocation();
  if (!token) {
    setLoggedOut('Shared session not found');
    return null;
  }
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
  state.authSession = {
    id: 'share',
    createdAt: '',
    lastSeenAt: '',
    principal: {
      mode: 'share',
      isAdmin: false,
    },
  };
  state.status = 'Loading session';
  state.statusTone = 'warn';
  state.view = 'chat';
  render();
  try {
    const payload = await apiFetch(`/api/share/${encodeURIComponent(token)}/session`, { skipAuth: true });
    const session = {
      ...(payload?.session || {}),
      mode: payload?.mode || 'share',
      readOnly: true,
    };
    state.sessionId = session.id;
    state.currentSession = session;
    state.cwd = '';
    state.timelineCache = new Map();
    applySessionSettings(session);
    restoreTimelineForSession(session);
    syncRuntimeStatusFromSession(session);
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    render();
    scrollTimelineToBottom();
    return session;
  } catch (error) {
    state.authSession = null;
    handleApiError(error, { auth: true });
    return null;
  }
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
      refreshProjectsList({ renderAfter: false }).catch(() => []),
      refreshSessionsList({ renderAfter: false, scope: 'all' }).catch(() => null),
      refreshReportsList({ renderAfter: false }).catch(() => null),
    ]);
    state.authSession = session;
    state.models = Array.isArray(modelsPayload.items) ? modelsPayload.items : [];
    state.model = pickModel(state.models, state.model || DEFAULT_MODEL);
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
  state.sessionsByScope = {
    favorites: [],
    all: [],
  };
  state.sessionsLoadedByScope = {
    favorites: false,
    all: false,
  };
  state.sessionsLoading = false;
  state.sessionsLoadingScope = null;
  state.sessionsRequestId += 1;
  allSessionsPreloadPromise = null;
  state.reports = [];
  state.projects = [];
  state.projectsLoaded = false;
  state.newProjectId = '';
  resetAdminState();
  state.admin = {
    loading: false,
    loaded: false,
    settings: null,
    projects: [],
    users: [],
    roles: [],
    sessions: [],
    filterUserId: '',
  };
  state.reportsLoading = false;
  state.reportsLoaded = false;
  state.reportsRequestId += 1;
  state.reportProject = '';
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.reportReturnView = 'reports';
  state.reportsReturnView = 'sessions';
  state.sessionId = null;
  state.currentSession = null;
  state.draftSessionActive = false;
  state.view = 'sessions';
  state.selectedProjectKey = '';
  state.selectedProjectId = '';
  state.selectedProjectLabel = '';
  state.mobileSidebarOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.shareDialog = null;
  state.sortMode = 'time';
  state.sessionsScope = 'all';
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
  state.prompt = '';
  state.promptDrafts = new Map();
  state.composerAttachments = [];
  applyDefaultSettings();
  stopStream();
  render();
}

function render() {
  const shouldRestoreLatestTimeline = state.timelineShouldFollowLatest;
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
  const timeline = document.querySelector('#timeline');
  if (timeline) {
    syncComposerOffset();
    timelineScrollTrackingAttached = false;
    attachTimelineScrollTracking({ updateInitial: !shouldRestoreLatestTimeline });
    if (shouldRestoreLatestTimeline) {
      scrollTimelineToBottom();
    }
  } else {
    resetComposerOffset();
    timelineScrollTrackingAttached = false;
  }
  if (state.view === 'sessions') {
    restoreSessionListScroll();
  }
}

function resetSessionHistoryWindow() {
  state.sessionHistoryItems = [];
  state.sessionHistoryStartIndex = 0;
  state.timelineShouldFollowLatest = true;
}

function currentPromptDraftKey() {
  return state.sessionId || (state.draftSessionActive ? `draft:${state.cwd || 'default'}` : '');
}

function savePromptDraftForCurrentSession() {
  const key = currentPromptDraftKey();
  if (!key) {
    return;
  }
  const prompt = String(state.prompt || '');
  if (prompt) {
    state.promptDrafts.set(key, prompt);
  } else {
    state.promptDrafts.delete(key);
  }
}

function restorePromptDraftForSession(sessionId) {
  state.prompt = state.promptDrafts.get(sessionId) || '';
}

function clearPromptDraftForCurrentSession() {
  const key = currentPromptDraftKey();
  if (key) {
    state.promptDrafts.delete(key);
  }
  state.prompt = '';
}

function migrateDraftPromptToSession(sessionId) {
  if (!sessionId) {
    return;
  }
  const draftKey = `draft:${state.cwd || 'default'}`;
  if (state.promptDrafts.has(draftKey) && !state.promptDrafts.has(sessionId)) {
    state.promptDrafts.set(sessionId, state.promptDrafts.get(draftKey) || '');
  }
  state.promptDrafts.delete(draftKey);
}

function currentQueuedSessionId() {
  return state.sessionId || '';
}

function queuedMessagesForSession(sessionId) {
  if (!sessionId) {
    return [];
  }
  const messages = state.queuedMessages.get(sessionId);
  return Array.isArray(messages) ? messages : [];
}

function queuedMessagesForCurrentSession() {
  return queuedMessagesForSession(currentQueuedSessionId());
}

function pendingQueuedMessagesForSession(sessionId) {
  return queuedMessagesForSession(sessionId).filter((message) => message?.sending !== true);
}

function pendingQueuedMessagesForCurrentSession() {
  return pendingQueuedMessagesForSession(currentQueuedSessionId());
}

function enqueueQueuedMessage(sessionId, text) {
  const normalizedText = String(text || '').trim();
  if (!sessionId || !normalizedText) {
    return null;
  }
  const message = {
    id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: normalizedText,
    createdAt: new Date().toISOString(),
  };
  state.queuedMessages.set(sessionId, [...queuedMessagesForSession(sessionId), message]);
  persistQueuedMessages();
  return message;
}

function setQueuedMessageSending(sessionId, messageId, sending, { renderAfter = false } = {}) {
  if (!sessionId || !messageId) {
    return false;
  }
  const messages = queuedMessagesForSession(sessionId);
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    changed = true;
    return {
      ...message,
      sending: Boolean(sending),
    };
  });
  if (!changed) {
    return false;
  }
  state.queuedMessages.set(sessionId, nextMessages);
  persistQueuedMessages();
  if (renderAfter) {
    render();
  }
  return true;
}

function removeQueuedMessage(sessionId, messageId) {
  if (!sessionId || !messageId) {
    return;
  }
  const nextMessages = queuedMessagesForSession(sessionId).filter((message) => message.id !== messageId);
  if (nextMessages.length) {
    state.queuedMessages.set(sessionId, nextMessages);
  } else {
    state.queuedMessages.delete(sessionId);
  }
  persistQueuedMessages();
  render();
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
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        ${state.loginError ? `<p class="meta" style="color: var(--danger);">${escapeHtml(state.loginError)}</p>` : ''}
        <div class="actions">
          <button class="primary primary-action" type="submit">Log in</button>
        </div>
      </form>
    </div>
  `;
  return shell;
}

function renderMain() {
  if (isDesktopWorkspaceView()) {
    return renderDesktopWorkspace();
  }
  if (state.view === 'settings') {
    return renderAppSettings();
  }
  if (state.view === 'admin') {
    return renderAdminConsole();
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

function renderDesktopWorkspace() {
  ensureDesktopActiveSession();
  const shell = document.createElement('div');
  shell.className = 'shell desktop-shell';
  shell.innerHTML = `
    <div class="desktop-workspace">
      ${renderDesktopProjectRail()}
      ${renderDesktopSessionPane()}
      <div class="desktop-workspace-pane-stack">
        ${renderDesktopChatPane()}
        ${state.desktopSettingsOpen ? renderDesktopSettingsPanel() : ''}
        ${state.desktopOverlay === 'reports' ? renderDesktopReportsOverlay() : ''}
      </div>
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return shell;
}

function renderDesktopProjectRail() {
  return `
    <aside class="desktop-project-rail">
      <header class="project-rail-header">
        <div class="project-rail-brand">${escapeHtml(state.siteTitle)}</div>
        <div class="project-rail-meta">${escapeHtml(currentProjectScopeTitle())}</div>
      </header>
      <nav class="project-rail-list" aria-label="Projects">
        ${renderWorkspaceProjectList()}
      </nav>
      <div class="project-rail-footer">
        ${renderWorkspaceRailActions()}
      </div>
    </aside>
  `;
}

function renderDesktopSessionPane() {
  return `
    <section class="desktop-session-pane">
      ${renderSessionListHeader({ desktop: true })}
      <main class="session-list desktop-session-list">${renderSessionCards()}</main>
    </section>
  `;
}

function renderDesktopChatPane() {
  if (state.view === 'new') {
    return `
      <section class="desktop-chat-pane desktop-new-pane">
        ${renderNewSessionContent({ desktop: true })}
      </section>
    `;
  }
  if (!state.currentSession && !state.sessionId && !state.cwd && !state.draftSessionActive) {
    return `
      <section class="desktop-chat-pane desktop-empty-pane">
        <div class="desktop-empty-state">
          <h2>No active session</h2>
          <p class="meta">Select a session in the middle pane or start a new one.</p>
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

function ensureDesktopActiveSession() {
  if (!isDesktopLayout() || state.view === 'new' || state.sessionId || state.currentSession || state.draftSessionActive) {
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

function isDesktopLayout() {
  const hasDesktopPointer = typeof window?.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false;
  return hasDesktopPointer
    && typeof window?.innerWidth === 'number'
    && window.innerWidth >= DESKTOP_WORKSPACE_MIN_WIDTH;
}

function isDesktopWorkspaceView() {
  return isDesktopLayout() && ['sessions', 'chat', 'new'].includes(state.view);
}

function handleLayoutResize() {
  if (isDesktopLayout()) {
    state.mobileSidebarOpen = false;
    return;
  }
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  if (state.sessionId) {
    state.view = 'chat';
    return;
  }
  state.view = 'sessions';
}

function renderSessionList() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    ${renderMobileProjectDrawer()}
    <div class="screen page-screen">
      ${renderSessionListHeader()}
      <main class="session-list">${renderSessionCards()}</main>
    </div>
    ${renderArchiveConfirmModal()}
  `;
  return shell;
}

function renderSessionListHeader({ desktop = false } = {}) {
  const sortToggle = renderSessionSortToggle({ mobile: !desktop });
  if (!desktop) {
    return `
      <header class="topbar page-topbar mobile-session-topbar">
        <div class="topbar-main">
          <button class="ghost page-back-button mobile-sidebar-toggle-button" type="button" id="mobile-sidebar-toggle-button" aria-label="Projects">≡</button>
          ${sortToggle}
        </div>
      </header>
  `;
  }
  return `
      <header class="topbar page-topbar${desktop ? ' desktop-session-pane-topbar' : ''}">
        <div class="topbar-main">
          <div class="page-title">Sessions</div>
          <div class="topbar-actions">
            <button class="reports-action compact-button" type="button" id="open-reports-button">Reports</button>
            <button class="ghost compact-button" type="button" id="open-new-session-button">New</button>
          </div>
        </div>
        <div class="list-actions">
          ${sortToggle}
        </div>
      </header>
  `;
}

function renderSessionSortToggle({ mobile = false } = {}) {
  return `
          <div class="toggle sort-toggle${mobile ? ' mobile-session-sort-toggle' : ''}">
            <button type="button" data-sort-mode="favorites" aria-pressed="${String(state.sortMode === 'favorites')}">Favorites</button>
            <button type="button" data-sort-mode="time" aria-pressed="${String(state.sortMode === 'time')}">Recents</button>
          </div>
        `;
}

function renderReportsPage() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen">
      ${renderPageNav('Reports', { backId: 'back-to-list-button' })}
      <main class="report-list">${state.reportProject ? renderReportCards() : renderReportProjects()}</main>
    </div>
  `;
  return shell;
}

function renderDesktopReportsOverlay() {
  return `
    <section class="desktop-overlay">
      <div class="desktop-overlay-card">
        ${renderPageNav('Reports', { backId: 'desktop-reports-close-button' })}
        <main class="report-list">${state.reportProject ? renderReportCards() : renderReportProjects()}</main>
      </div>
    </section>
  `;
}

function renderReportProjects() {
  const projects = reportProjects();
  if (!projects.length) {
    if (state.reportsLoading) {
      return '<div class="empty-state">Loading reports...</div>';
    }
    return '<div class="empty-state">No reports yet.</div>';
  }
  return projects.map((project) => `
    <article class="report-card report-project-card">
      <button class="report-card-open" type="button" data-report-project="${escapeAttribute(project.name)}">
        <span class="report-card-main">
          <span class="report-title">${escapeHtml(project.name)}</span>
          <span class="report-path">${escapeHtml(`${project.count} ${project.count === 1 ? 'report' : 'reports'}`)}</span>
        </span>
        <span class="report-card-meta">
          <span>${escapeHtml(project.favoriteCount ? `${project.favoriteCount} favorite` : 'reports')}</span>
          <span>${escapeHtml(formatShortDateTime(project.updatedAt))}</span>
        </span>
      </button>
    </article>
  `).join('');
}

function renderReportCards() {
  const reports = filteredReports();
  if (!reports.length) {
    if (state.reportsLoading) {
      return '<div class="empty-state">Loading reports...</div>';
    }
    return '<div class="empty-state">No reports yet.</div>';
  }
  return reports.map((report) => `
      <article class="report-card">
        <button class="report-card-open" type="button" data-report-id="${escapeAttribute(report.id)}">
          <span class="report-card-main">
            <span class="report-title">${escapeHtml(report.title)}</span>
            <span class="report-path">${escapeHtml(shorten(report.id, 82))}</span>
          </span>
          <span class="report-card-meta">
            <span>${escapeHtml(report.kind || 'report')}</span>
            <span>${escapeHtml(formatShortDateTime(report.updatedAt))}</span>
          </span>
        </button>
        <button class="ghost compact-button report-favorite" type="button" data-report-favorite-id="${escapeAttribute(report.id)}" aria-pressed="${String(report.favorite === true)}">${report.favorite ? 'Unfavorite' : 'Favorite'}</button>
      </article>
    `).join('');
}

function renderReportViewer() {
  const report = state.currentReport;
  const shell = document.createElement('div');
  shell.className = 'shell';
  if (!report) {
    shell.innerHTML = `
      <div class="screen page-screen">
        ${renderPageNav('Report', { backId: 'back-to-reports-button' })}
        <main class="report-viewer"><div class="empty-state">Report not loaded.</div></main>
      </div>
    `;
    return shell;
  }
  shell.innerHTML = `
    <div class="screen page-screen">
      ${renderPageNav(report.title || 'Report', { backId: 'back-to-reports-button' })}
      <main class="report-viewer">${state.currentReportLoading ? renderReportLoading() : renderReportDocument(report, state.currentReportContent)}</main>
    </div>
  `;
  return shell;
}

function renderReportLoading() {
  return '<div class="empty-state report-loading">Loading report...</div>';
}

function renderReportDocument(report, content) {
  if (report?.kind === 'html') {
    return `<iframe class="report-frame" sandbox="" srcdoc="${escapeAttribute(content || '')}"></iframe>`;
  }
  return `<div class="report-document markdown-body">${renderMarkdown(content || '')}</div>`;
}

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

function renderAppSettingsSections() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Website title</div>
          <div class="control-group">
            <label for="site-title-input">Browser title</label>
            <input id="site-title-input" name="siteTitle" type="text" value="${escapeAttribute(state.siteTitle)}" placeholder="${escapeAttribute(DEFAULT_SITE_TITLE)}">
          </div>
        </section>
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
        ${renderAdminSettingsSection({ title: 'Admin', showLoadingNote: true })}
        <section class="settings-section">
          <button class="danger compact-button full-width-button" type="button" id="settings-logout-button">Log out</button>
        </section>
  `;
}

function renderAdminSettingsSection({ title = 'System', showLoadingNote = false } = {}) {
  if (!isAdminPrincipal()) {
    return '';
  }
  const adminSettingsLoaded = state.admin.settings !== null;
  return `
        <section class="settings-section${title === 'System' ? ' admin-summary-section' : ''}">
          <div class="settings-section-title">${escapeHtml(title)}</div>
          <label class="settings-action-row admin-toggle-row">
            <span class="meta">Multi-user mode</span>
            <input id="admin-multi-user-toggle" type="checkbox"${state.admin.settings?.multiUserEnabled === true ? ' checked' : ''}${adminSettingsLoaded ? '' : ' disabled'}>
          </label>
          ${showLoadingNote && !adminSettingsLoaded ? '<div class="meta">Loading admin settings...</div>' : ''}
        </section>
  `;
}

function renderAdminConsole() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen page-screen admin-console-screen">
      ${renderPageNav('Admin Console')}
      <main class="admin-console-page">
        ${renderAdminSections()}
      </main>
    </div>
  `;
  return shell;
}

function renderAdminSections() {
  if (state.admin.loading && !state.admin.loaded) {
    return '<div class="empty-state">Loading admin console...</div>';
  }
  return `
        ${renderAdminSettingsSection()}
        <div class="admin-layout">
          ${renderAdminSidebar()}
          <section class="admin-content">
            ${renderAdminContent()}
          </section>
        </div>
  `;
}

function renderAdminSidebar() {
  const page = currentAdminPage();
  const pages = [
    ['projects', 'Project Management'],
    ['roles', 'Role Management'],
    ['users', 'User Management'],
    ['sessions', 'Session Audit'],
  ];
  return `
    <nav class="admin-sidebar" aria-label="Admin sections">
      ${pages.map(([id, label]) => `
        <button class="admin-sidebar-button" type="button" data-admin-page="${escapeAttribute(id)}" aria-pressed="${String(page === id)}">${escapeHtml(label)}</button>
      `).join('')}
    </nav>
  `;
}

function renderAdminContent() {
  switch (currentAdminPage()) {
    case 'roles':
      return renderAdminRolePage();
    case 'users':
      return renderAdminUserPage();
    case 'sessions':
      return renderAdminSessionAuditPage();
    case 'projects':
    default:
      return renderAdminProjectPage();
  }
}

function renderAdminProjectPage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Project Management</div>
          ${renderAdminProjectForm()}
          <div class="admin-list">${renderAdminProjects()}</div>
        </section>
  `;
}

function renderAdminRolePage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Role Management</div>
          ${renderAdminRoleForm()}
          <div class="admin-list">${renderAdminRoles()}</div>
        </section>
  `;
}

function renderAdminUserPage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">User Management</div>
          ${renderAdminUserForm()}
          <div class="admin-list">${renderAdminUsers()}</div>
        </section>
  `;
}

function renderAdminSessionAuditPage() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Session Audit</div>
          <div class="admin-filter-row">
            <label class="field" for="admin-session-user-filter">
              <span>User</span>
              <select id="admin-session-user-filter" name="adminUserFilter">
                <option value="">All users</option>
                ${state.admin.users.map((user) => `
                  <option value="${escapeAttribute(user.id)}"${state.admin.filterUserId === user.id ? ' selected' : ''}>${escapeHtml(user.username || user.id)}</option>
                `).join('')}
              </select>
            </label>
            <label class="field" for="admin-session-project-filter">
              <span>Project</span>
              <select id="admin-session-project-filter" name="adminProjectFilter">
                <option value="">All projects</option>
                ${adminAuditProjects().map((project) => `
                  <option value="${escapeAttribute(project.id)}"${state.admin.filterProjectId === project.id ? ' selected' : ''}>${escapeHtml(projectVisibleName(project, project.id))}</option>
                `).join('')}
              </select>
            </label>
          </div>
          <div class="admin-list">${renderAdminSessions()}</div>
        </section>
  `;
}

function renderLegacyAdminSections() {
  return `
        <section class="settings-section">
          <div class="settings-section-title">Sessions</div>
          <div class="field">
            <label for="admin-session-user-filter">User</label>
            <select id="admin-session-user-filter" name="adminUserFilter">
              <option value="">All users</option>
              ${state.admin.users.map((user) => `
                <option value="${escapeAttribute(user.id)}"${state.admin.filterUserId === user.id ? ' selected' : ''}>${escapeHtml(user.username || user.id)}</option>
              `).join('')}
            </select>
          </div>
          <div class="admin-list">${renderAdminSessions()}</div>
        </section>
  `;
}

function renderAdminProjectForm() {
  const project = adminEditingProject();
  return `
    <form class="admin-form" id="admin-project-form">
      <div class="admin-form-grid">
        <label class="field">
          <span>Display Name</span>
          <input name="displayName" autocomplete="off" placeholder="auto from CWD" value="${escapeAttribute(project?.displayName || '')}">
        </label>
        <label class="field">
          <span>CWD</span>
          <input name="cwd" autocomplete="off" placeholder="/Users/name/repo" value="${escapeAttribute(project?.cwd || '')}">
        </label>
      </div>
      <label class="admin-check-row">
        <input name="enabled" type="checkbox"${project?.enabled === false ? '' : ' checked'}>
        <span>Enabled</span>
      </label>
      <div class="admin-form-actions">
        <button class="primary compact-button" type="submit">Save Project</button>
        ${project ? '<button class="ghost compact-button" type="button" id="admin-project-edit-cancel">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function renderAdminRoleForm() {
  const role = adminEditingRole();
  return `
    <form class="admin-form" id="admin-role-form">
      <div class="admin-form-grid">
        <label class="field">
          <span>Role ID</span>
          <input name="id" autocomplete="off" placeholder="role_writer" value="${escapeAttribute(role?.id || '')}">
        </label>
        <label class="field">
          <span>Name</span>
          <input name="name" autocomplete="off" placeholder="Writer" value="${escapeAttribute(role?.name || '')}">
        </label>
      </div>
      <label class="admin-check-row">
        <input name="isAdmin" type="checkbox"${role?.isAdmin === true ? ' checked' : ''}>
        <span>Admin role</span>
      </label>
      ${renderAdminProjectCheckboxes(adminRoleProjectIds(role))}
      <div class="admin-form-actions">
        <button class="primary compact-button" type="submit">Save Role</button>
        ${role ? '<button class="ghost compact-button" type="button" id="admin-role-edit-cancel">Cancel</button>' : ''}
      </div>
    </form>
  `;
}

function renderAdminUserForm() {
  return `
    <form class="admin-form" id="admin-user-form">
      <div class="admin-form-grid">
        <label class="field">
          <span>User ID</span>
          <input name="id" autocomplete="off" placeholder="user_writer">
        </label>
        <label class="field">
          <span>Username</span>
          <input name="username" autocomplete="username" placeholder="writer">
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" autocomplete="new-password" placeholder="At least 8 chars">
        </label>
      </div>
      <label class="admin-check-row">
        <input name="enabled" type="checkbox" checked>
        <span>Enabled</span>
      </label>
      <label class="field">
        <span>Role</span>
        ${renderAdminRoleSelect({ id: 'admin-user-role-select', name: 'roleId' })}
      </label>
      <button class="primary compact-button full-width-button" type="submit">Save User</button>
    </form>
  `;
}

function renderAdminRoleSelect({ id = 'admin-user-role-select', name = 'roleId', value = '' } = {}) {
  if (!state.admin.roles.length) {
    return `<select id="${escapeAttribute(id)}" name="${escapeAttribute(name)}"><option value="">No roles available</option></select>`;
  }
  const selectedValue = String(value || '');
  return `
    <select id="${escapeAttribute(id)}" name="${escapeAttribute(name)}">
      <option value=""${selectedValue ? '' : ' selected'}>No role</option>
      ${state.admin.roles.map((role) => `
        <option value="${escapeAttribute(role.id)}"${role.id === selectedValue ? ' selected' : ''}>${escapeHtml(role.name || role.id)}</option>
      `).join('')}
    </select>
  `;
}

function renderAdminProjectCheckboxes(selectedProjectIds = [], { name = 'projectIds', legend = 'Projects' } = {}) {
  if (!state.admin.projects.length) {
    return '<div class="meta">No projects available.</div>';
  }
  const selected = new Set(selectedProjectIds);
  return `
    <fieldset class="admin-fieldset">
      <legend>${escapeHtml(legend)}</legend>
      ${state.admin.projects.map((project) => `
        <label class="admin-check-row">
          <input name="${escapeAttribute(name)}" type="checkbox" value="${escapeAttribute(project.id)}"${selected.has(project.id) ? ' checked' : ''}>
          <span>${escapeHtml(adminProjectVisibleName(project))}</span>
        </label>
      `).join('')}
    </fieldset>
  `;
}

function renderAdminProjects() {
  if (!state.admin.projects.length) {
    return '<div class="meta">No projects configured.</div>';
  }
  return `
    <table class="admin-table">
      <thead>
        <tr>
          <th>CWD</th>
          <th>Display Name</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${state.admin.projects.map((project) => `
          <tr>
            <td>${escapeHtml(project.cwd || project.id || '')}</td>
            <td>${escapeHtml(adminProjectVisibleName(project))}</td>
            <td><button class="ghost compact-button" type="button" data-admin-edit-project="${escapeAttribute(project.id || '')}">Edit</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderAdminUsers() {
  if (!state.admin.users.length) {
    return '<div class="meta">No users configured.</div>';
  }
  return state.admin.users.map((user) => {
    const roleId = adminUserRoleId(user);
    return `
      <article class="admin-row admin-user-row">
        <div>
          <span class="admin-row-main">${escapeHtml(user.username || user.id)}</span>
          <span class="admin-row-meta">${escapeHtml(adminUserMeta(user))}</span>
        </div>
        <form class="admin-user-access-form" data-admin-user-id="${escapeAttribute(user.id || '')}">
          ${renderAdminRoleSelect({ id: `admin-user-role-${user.id || 'unknown'}`, name: 'userRoleId', value: roleId })}
          <label class="admin-check-row">
            <input name="enabled" type="checkbox"${user?.enabled === false ? '' : ' checked'}>
            <span>Enabled</span>
          </label>
          <div class="admin-user-action-row">
            <button class="ghost compact-button" type="submit">Save</button>
            <button class="ghost compact-button" type="button" data-admin-toggle-user-id="${escapeAttribute(user.id || '')}" data-admin-toggle-user-enabled="${user?.enabled === false ? 'true' : 'false'}">${user?.enabled === false ? 'Enable' : 'Disable'}</button>
            <button class="danger compact-button" type="button" data-admin-delete-user-id="${escapeAttribute(user.id || '')}">Delete</button>
          </div>
        </form>
      </article>
    `;
  }).join('');
}

function renderAdminRoles() {
  if (!state.admin.roles.length) {
    return '<div class="meta">No roles configured.</div>';
  }
  return state.admin.roles.map((role) => `
    <article class="admin-row">
      <span class="admin-row-main">${escapeHtml(role.name || role.id)}</span>
      <span class="admin-row-meta">${role.isAdmin ? 'admin' : escapeHtml(role.id || '')}</span>
      <button class="ghost compact-button" type="button" data-admin-edit-role="${escapeAttribute(role.id || '')}">Edit</button>
    </article>
  `).join('');
}

function renderAdminSessions() {
  if (!state.admin.sessions.length) {
    return '<div class="meta">No sessions found.</div>';
  }
  return state.admin.sessions.map((session) => {
    const owner = adminUserName(session.ownerUserId || session.userId);
    return `
      <article class="admin-row admin-session-row">
        <button class="admin-session-open" type="button" data-admin-session-id="${escapeAttribute(session.id)}">
          <span class="admin-row-main">${escapeHtml(adminProjectNameById(session.projectId, session.projectDisplayName))}</span>
          <span class="admin-row-meta">${escapeHtml(`${owner} · ${session.id} · Observer Mode`)}</span>
        </button>
      </article>
    `;
  }).join('');
}

function renderNewSession() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    ${renderMobileProjectDrawer()}
    <div class="screen page-screen">
      ${renderNewSessionContent()}
    </div>
  `;
  return shell;
}

function renderNewSessionContent({ desktop = false } = {}) {
  const sessionTargetPicker = renderNewSessionTargetPicker();
  const startDisabled = isMultiUserMode() && !currentNewProjectId();
  return `
    ${desktop
      ? `
        <header class="topbar chat-topbar desktop-chat-topbar">
          <div class="chat-nav">
            <div class="chat-nav-spacer" aria-hidden="true"></div>
            <div class="chat-title-stack">
              <div class="project-title">New Session</div>
              <div class="goal-status" data-status="unknown">${escapeHtml(currentProjectScopeTitle())}</div>
            </div>
            <div class="chat-nav-spacer" aria-hidden="true"></div>
          </div>
        </header>
      `
      : `
        <header class="topbar page-topbar">
          <div class="topbar-main">
            <button class="ghost page-back-button mobile-sidebar-toggle-button" type="button" id="mobile-sidebar-toggle-button" aria-label="Projects">≡</button>
            <div class="page-title">New Session</div>
            <button class="ghost compact-button" type="button" id="back-to-list-button">Sessions</button>
          </div>
        </header>
      `}
    <main class="new-session-page${desktop ? ' desktop-new-session-page' : ''}">
      <form class="panel stack" id="new-session-form">
        ${sessionTargetPicker}
        <div class="actions">
          ${desktop ? '<button class="ghost compact-button" type="button" id="back-to-list-button">Sessions</button>' : ''}
          <button class="${desktop ? 'primary compact-button' : 'primary primary-action'}" type="submit"${startDisabled ? ' disabled' : ''}>Start</button>
        </div>
      </form>
    </main>
  `;
}

function renderNewSessionTargetPicker() {
  if (isMultiUserMode()) {
    return renderMultiUserNewSessionProjectPicker();
  }
  return renderNewSessionPathPicker();
}

function renderMultiUserNewSessionProjectPicker() {
  if (!state.projectsLoaded) {
    return `
      <div class="field">
        <label>Project</label>
        <div class="meta">Loading projects...</div>
      </div>
    `;
  }
  const projects = availableProjects();
  if (!projects.length) {
    return `
      <div class="field">
        <label for="new-project-select">Project</label>
        <select id="new-project-select" name="projectId" disabled>
          <option value="">No projects available</option>
        </select>
        <div class="meta">Ask an admin to assign a project before starting a session.</div>
      </div>
    `;
  }
  const currentProjectId = state.newProjectId || projects[0]?.id || '';
  return `
        <div class="field">
          <label for="new-project-select">Project</label>
          <select id="new-project-select" name="projectId">
            ${projects.map((project) => `
              <option value="${escapeAttribute(project.id)}"${project.id === currentProjectId ? ' selected' : ''}>${escapeHtml(projectVisibleName(project, project.id))}</option>
            `).join('')}
          </select>
        </div>
  `;
}

function renderNewSessionPathPicker() {
  return `
        <div class="field">
          <label for="new-cwd-input">Project path</label>
          <textarea id="new-cwd-input" name="cwd" rows="3" placeholder="Use server default">${escapeHtml(state.newCwd || state.cwd)}</textarea>
        </div>
        ${renderPathChoices()}
  `;
}

function renderChat() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `
    <div class="screen">
      ${renderChatContent()}
    </div>
  `;
  return shell;
}

function renderChatContent({ desktop = false } = {}) {
  const sessionReportsProject = reportProjectForSession(state.currentSession);
  const composerClassName = composerStateClassName();
  const readOnly = isReadOnlySession(state.currentSession);
  return `
      <header class="topbar chat-topbar${desktop ? ' desktop-chat-topbar' : ''}">
        <div class="chat-nav">
          ${desktop ? '<div class="chat-nav-spacer" aria-hidden="true"></div>' : '<button class="ghost chat-back-button" type="button" id="back-to-list-button" aria-label="Sessions">&lt;</button>'}
          <div class="chat-title-stack">
            <div class="project-title">${escapeHtml(projectNameForSession(state.currentSession, state.cwd))}</div>
            ${renderGoalStatus()}
          </div>
          ${renderChatHeaderActions({ readOnly, sessionReportsProject })}
        </div>
      </header>
      <main class="timeline" id="timeline">${renderTimeline()}</main>
      ${readOnly ? renderReadOnlyComposerNotice(state.currentSession) : renderComposer(composerClassName, { desktop })}
      ${renderShareDialog()}
  `;
}

function renderChatHeaderActions({ readOnly, sessionReportsProject }) {
  const canOpenSettings = !readOnly;
  if (!canOpenSettings && !sessionReportsProject) {
    return '<div class="chat-nav-spacer" aria-hidden="true"></div>';
  }
  return `
          <div class="chat-header-actions">
            ${canOpenSettings ? `<button class="ghost icon-button settings-toggle-button" type="button" id="settings-toggle" aria-label="Session menu" title="Session menu" aria-expanded="${String(state.settingsOpen)}">...</button>` : ''}
            ${sessionReportsProject ? `<button class="ghost compact-button session-report-button" type="button" data-session-reports-project="${escapeAttribute(sessionReportsProject)}">Reports</button>` : ''}
          </div>
  `;
}

function canShareCurrentSession() {
  return Boolean(state.sessionId && !state.draftSessionActive && !isReadOnlySession(state.currentSession));
}

function renderShareDialog() {
  if (!state.shareDialog?.url) {
    return '';
  }
  return `
      <div class="modal-backdrop share-modal-backdrop">
        <section class="confirm-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
          <div>
            <h2 id="share-dialog-title">Share link</h2>
            <p class="meta">${escapeHtml(state.shareDialog.copied ? 'Copied to clipboard.' : 'Copy this read-only session link.')}</p>
          </div>
          <input id="share-link-input" class="share-link-input" type="text" readonly value="${escapeAttribute(state.shareDialog.url)}">
          <div class="actions">
            <button class="ghost compact-button" type="button" id="copy-share-link-button">Copy</button>
            <button class="primary compact-button" type="button" id="close-share-dialog-button">Done</button>
          </div>
        </section>
      </div>
  `;
}

function renderComposer(composerClassName, { desktop = false } = {}) {
  return `
      <div class="composer-wrap ${composerClassName}">
        ${state.composerExpanded ? '' : renderComposerStatus()}
        ${renderQueuedMessages()}
        <form class="composer ${composerClassName}" id="composer-form">
          ${state.settingsOpen && !state.composerExpanded ? renderSettingsDrawer() : ''}
          ${state.error && !state.composerExpanded ? `<div class="composer-error">${escapeHtml(shorten(state.error, 96))}</div>` : ''}
          ${renderAttachmentTray()}
          <input class="visually-hidden" id="attachment-input" type="file" multiple aria-label="Upload files">
          <div class="compact-composer-row">
            ${renderComposerLeadingControls()}
            ${renderMessageEditor({ desktop })}
          </div>
        </form>
      </div>
  `;
}

function renderQueuedMessages() {
  const queued = pendingQueuedMessagesForCurrentSession();
  if (!queued.length) {
    return '';
  }
  return `
        <div class="queued-messages" aria-label="Queued messages">
          ${queued.map((message) => `
            <div class="queued-message-row">
              <span class="queued-message-text">${escapeHtml(message.text)}</span>
              <button class="ghost queued-message-delete" type="button" data-queued-message-id="${escapeAttribute(message.id)}" aria-label="Delete queued message">Delete</button>
            </div>
          `).join('')}
        </div>
  `;
}

async function sendNextQueuedMessage(sessionId = state.sessionId) {
  if (!sessionId || state.queuedMessageSending || state.pendingTurn || isReadOnlySession(state.currentSession)) {
    return false;
  }
  const [message] = pendingQueuedMessagesForSession(sessionId);
  if (!message) {
    return false;
  }
  state.queuedMessageSending = true;
  setQueuedMessageSending(sessionId, message.id, true, { renderAfter: true });
  try {
    await sendComposerMessage(message.text, {
      queuedMessageId: message.id,
      sessionId,
      includeComposerAttachments: false,
    });
    return true;
  } finally {
    state.queuedMessageSending = false;
  }
}

function renderReadOnlyComposerNotice(session) {
  const mode = session?.mode === 'share' ? 'Shared link' : 'Observer mode';
  return `
      <div class="composer-wrap read-only-composer-wrap">
        <div class="read-only-banner">
          <strong>${escapeHtml(mode)}</strong>
          <span>Read only</span>
        </div>
      </div>
  `;
}

function renderGoalStatus() {
  const goal = state.currentSession?.goal;
  const objective = String(goal?.objective || '').trim();
  if (!objective) {
    return '';
  }
  const { status, label } = goalStatusDisplay(goal.status);
  return `
    <div class="goal-status" data-status="${escapeAttribute(status)}">
      <span>${escapeHtml(label)}</span>
      <span class="goal-objective">${escapeHtml(objective)}</span>
    </div>
  `;
}

function goalStatusDisplay(status) {
  const normalized = normalizeGoalStatus(status);
  if (normalized === 'paused') {
    return { status: 'paused', label: 'Goal paused' };
  }
  if (normalized === 'done') {
    return { status: 'done', label: 'Goal done' };
  }
  if (normalized === 'blocked') {
    return { status: 'blocked', label: 'Goal blocked' };
  }
  if (normalized === 'active') {
    return { status: 'active', label: 'Goal active' };
  }
  return { status: 'unknown', label: `Goal ${String(status || '').trim() || 'set'}` };
}

function normalizeGoalStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s_-]+/gu, '');
  if (!normalized || normalized === 'active' || normalized === 'running' || normalized === 'inprogress') {
    return 'active';
  }
  if (normalized === 'pause' || normalized === 'paused') {
    return 'paused';
  }
  if (['done', 'complete', 'completed', 'success', 'succeeded', 'finished'].includes(normalized)) {
    return 'done';
  }
  if (['blocked', 'failed', 'cancelled', 'canceled'].includes(normalized)) {
    return 'blocked';
  }
  return 'unknown';
}

function renderPageNav(title, options = {}) {
  const backId = options.backId || 'back-to-list-button';
  return `
    <header class="topbar page-topbar">
      <div class="page-nav">
        <button class="ghost page-back-button" type="button" id="${escapeAttribute(backId)}" aria-label="Back">&lt;</button>
        <div class="page-title">${escapeHtml(title)}</div>
        <div class="page-nav-spacer" aria-hidden="true"></div>
      </div>
    </header>
  `;
}

function composerStateClassName() {
  if (state.composerExpanded) {
    return 'is-expanded';
  }
  if (state.composerCanExpand) {
    return 'is-expandable';
  }
  return '';
}

function renderComposerLeadingControls() {
  let expandButton = '';
  if (!isDesktopLayout()) {
    expandButton = `<button class="ghost icon-button" type="button" id="composer-expand-button" aria-label="${state.composerExpanded ? 'Collapse message editor' : 'Expand message editor'}" aria-expanded="${String(state.composerExpanded)}"${state.composerCanExpand || state.composerExpanded ? '' : ' hidden'}>${state.composerExpanded ? 'v' : '^'}</button>`;
  }
  const attachDisabled = state.pendingTurn || hasUploadingComposerAttachments() ? ' disabled' : '';
  return `
    <div class="composer-leading-controls">
      ${expandButton}
      <button class="ghost icon-button attach-button" type="button" id="attach-button" aria-label="Attach files" title="Attach files"${attachDisabled}>+</button>
    </div>
  `;
}

function renderMessageEditor({ desktop = false } = {}) {
  const composerClassName = composerStateClassName();
  const sendDisabled = hasUploadingComposerAttachments() ? ' disabled' : '';
  const actionButtons = desktop
    ? `<div class="composer-action-buttons">
        <button class="ghost compact-refresh" type="button" id="composer-refresh-button" aria-label="Refresh session">Refresh</button>
        <button class="primary compact-send" type="submit" id="send-button"${sendDisabled}>Send</button>
      </div>`
    : `<button class="primary compact-send" type="submit" id="send-button"${sendDisabled}>Send</button>`;
  return `
    <div class="message-editor-shell ${composerClassName}">
      <textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">${escapeHtml(state.prompt)}</textarea>
      ${actionButtons}
    </div>
  `;
}

function renderAttachmentTray() {
  const attachments = Array.isArray(state.composerAttachments) ? state.composerAttachments : [];
  if (!attachments.length) {
    return '';
  }
  return `
          <div class="attachment-tray" aria-label="Attachments">
            ${attachments.map(renderAttachmentChip).join('')}
          </div>
  `;
}

function renderAttachmentChip(attachment) {
  const status = String(attachment?.status || 'ready');
  const fileName = String(attachment?.fileName || attachment?.uploaded?.fileName || 'upload');
  const sizeLabel = formatAttachmentSize(attachment?.sizeBytes || attachment?.uploaded?.sizeBytes || 0);
  const statusLabel = attachmentStatusLabel(attachment);
  const statusClass = status === 'failed' ? ' is-failed' : status === 'uploading' ? ' is-uploading' : '';
  return `
            <div class="attachment-chip${statusClass}" data-attachment-id="${escapeAttribute(attachment.id || '')}">
              <span class="attachment-main">
                <span class="attachment-name">${escapeHtml(fileName)}</span>
                <span class="attachment-meta">${escapeHtml(sizeLabel)}</span>
              </span>
              <span class="attachment-status">${escapeHtml(statusLabel)}</span>
              <button class="ghost attachment-remove" type="button" data-attachment-remove-id="${escapeAttribute(attachment.id || '')}" aria-label="Remove ${escapeAttribute(fileName)}">x</button>
            </div>
  `;
}

function attachmentStatusLabel(attachment) {
  const status = String(attachment?.status || 'ready');
  if (status === 'uploading') {
    return 'Uploading';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  const storage = String(attachment?.uploaded?.storage || '').trim();
  return storage === 'state' ? 'Saved' : 'Ready';
}

function formatAttachmentSize(sizeBytes) {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function hasUploadingComposerAttachments() {
  return (Array.isArray(state.composerAttachments) ? state.composerAttachments : [])
    .some((attachment) => attachment?.status === 'uploading');
}

function hasFailedComposerAttachments() {
  return (Array.isArray(state.composerAttachments) ? state.composerAttachments : [])
    .some((attachment) => attachment?.status === 'failed');
}

function readyComposerAttachments() {
  return (Array.isArray(state.composerAttachments) ? state.composerAttachments : [])
    .filter((attachment) => attachment?.status === 'ready' && attachment.uploaded)
    .map((attachment) => attachment.uploaded);
}

function normalizeTimelineMessageDisplay(role, text, attachments) {
  const rawText = typeof text === 'string' ? text.trim() : '';
  const parsed = role === 'user'
    ? parseAttachmentPromptText(rawText)
    : { text: rawText, attachments: [] };
  return {
    text: parsed.text,
    attachments: mergeTimelineAttachments(
      normalizeTimelineAttachments(attachments),
      parsed.attachments,
    ),
  };
}

function parseAttachmentPromptText(text) {
  const rawText = typeof text === 'string' ? text.trim() : '';
  const footer = 'Use the local file paths above when you inspect these attachments.';
  const footerIndex = rawText.lastIndexOf(`\n${footer}`);
  if (footerIndex < 0) {
    return { text: rawText, attachments: [] };
  }
  const beforeFooter = rawText.slice(0, footerIndex).trimEnd();
  const marker = '\n\nAttachments:\n';
  let markerIndex = beforeFooter.lastIndexOf(marker);
  let blockStart = markerIndex >= 0 ? markerIndex + marker.length : -1;
  if (markerIndex < 0 && beforeFooter.startsWith('Attachments:\n')) {
    markerIndex = 0;
    blockStart = 'Attachments:\n'.length;
  }
  if (markerIndex < 0 || blockStart < 0) {
    return { text: rawText, attachments: [] };
  }
  const parsedAttachments = parseAttachmentPromptBlock(beforeFooter.slice(blockStart));
  if (!parsedAttachments.length) {
    return { text: rawText, attachments: [] };
  }
  const displayText = beforeFooter.slice(0, markerIndex).trim();
  return {
    text: displayText === 'User sent attachments without additional text.' ? '' : displayText,
    attachments: parsedAttachments,
  };
}

function parseAttachmentPromptBlock(blockText) {
  const attachments = [];
  let current = null;
  const pushCurrent = () => {
    if (!current?.localPath) {
      return;
    }
    attachments.push({
      kind: current.kind === 'image' ? 'image' : 'file',
      localPath: current.localPath,
      fileName: current.fileName || fileNameFromPath(current.localPath),
      mimeType: current.mimeType || null,
    });
  };
  for (const line of String(blockText || '').split('\n')) {
    const itemMatch = line.match(/^\d+\.\s+(.+?)\s*$/u);
    if (itemMatch) {
      pushCurrent();
      const label = String(itemMatch[1] || '').toLowerCase();
      current = {
        kind: label.includes('image') ? 'image' : 'file',
        localPath: '',
        fileName: '',
        mimeType: '',
      };
      continue;
    }
    const fieldMatch = line.match(/^\s+(path|filename|mime):\s*(.*?)\s*$/u);
    if (!fieldMatch || !current) {
      continue;
    }
    const value = String(fieldMatch[2] || '').trim();
    if (fieldMatch[1] === 'path') {
      current.localPath = value;
    } else if (fieldMatch[1] === 'filename') {
      current.fileName = value;
    } else if (fieldMatch[1] === 'mime') {
      current.mimeType = value;
    }
  }
  pushCurrent();
  return attachments;
}

function normalizeTimelineAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => normalizeTimelineAttachment(attachment))
    .filter(Boolean);
}

function normalizeTimelineAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }
  const localPath = typeof attachment.localPath === 'string' ? attachment.localPath.trim() : '';
  const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : '';
  const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
  if (!localPath && !fileName) {
    return null;
  }
  return {
    kind: attachment.kind === 'image' ? 'image' : 'file',
    localPath,
    fileName: fileName || fileNameFromPath(localPath) || 'upload',
    mimeType: mimeType || null,
    sizeBytes: Number.isFinite(attachment.sizeBytes) ? Number(attachment.sizeBytes) : null,
  };
}

function mergeTimelineAttachments(...attachmentGroups) {
  const merged = [];
  const seen = new Set();
  for (const attachment of attachmentGroups.flatMap((group) => normalizeTimelineAttachments(group))) {
    const key = attachment.localPath || `${attachment.kind}:${attachment.fileName}:${attachment.mimeType || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function fileNameFromPath(filePath) {
  const parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
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
    <article class="session-card${state.sessionId === session.id ? ' is-active' : ''}">
      <button class="session-card-open" type="button" data-session-id="${escapeAttribute(session.id)}">
        <span class="session-card-main">
          <span class="session-project">${escapeHtml(projectNameForSession(session))}</span>
          <span class="session-preview">${escapeHtml(shorten(previewInputForSession(session), 96) || 'No prompt preview')}</span>
        </span>
        <span class="session-card-meta">
          <span>${escapeHtml(cwdLeafName(session.cwd || '') || 'No cwd')}</span>
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
          <button class="ghost compact-button" type="button" id="archive-cancel-button">Cancel</button>
          <button class="danger compact-button" type="button" data-session-archive-confirm-id="${escapeAttribute(session.id)}">Archive</button>
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
      ${renderStopTurnControl()}
      ${renderShareSettingsControl()}
      <div class="settings-action-row">
        <span class="meta">Runtime</span>
        <button class="ghost compact-button" type="button" id="runtime-reload-button">Reload</button>
      </div>
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

function renderShareSettingsControl() {
  if (!canShareCurrentSession()) {
    return '';
  }
  return `
      <div class="settings-action-row">
        <span class="meta">Share</span>
        <button class="ghost compact-button" type="button" id="share-session-button">Share</button>
      </div>
  `;
}

function renderStopTurnControl() {
  if (!state.pendingTurn || !state.turnId) {
    return '';
  }
  return `
    <div class="settings-stop-row">
      <span class="meta">Current turn is running.</span>
      <button class="danger compact-button" type="button" id="stop-button">Stop</button>
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
  return `<div class="composer-status" data-tone="${escapeAttribute(composerStatusTone())}"><span>${escapeHtml(composerStatusLabel())}</span></div>`;
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
  if (state.status === 'Turn stopped') {
    return 'Stopped';
  }
  return state.status || 'Idle';
}

function composerStatusTone() {
  if (state.pendingTurn && state.status !== 'Stream paused') {
    return 'work';
  }
  return state.statusTone;
}

function renderTimelineItem(item) {
  if (item.kind === 'message') {
    const usesMarkdown = item.role === 'assistant' || item.role === 'system';
    const display = normalizeTimelineMessageDisplay(item.role, item.text, item.attachments);
    const body = usesMarkdown
      ? `<div class="message-text markdown-body">${renderMarkdown(display.text)}</div>`
      : display.text
        ? `<p class="message-text">${escapeHtml(display.text)}</p>`
        : '';
    const attachments = renderMessageAttachments(display.attachments);
    return `
      <article class="card message-card ${escapeHtml(item.role)}${item.severity === 'error' ? ' error-message' : ''}">
        <div class="card-header">
          <span class="card-title">${escapeHtml(item.label)}</span>
          <span class="card-kind">${escapeHtml(item.meta || '')}</span>
        </div>
        ${item.severity === 'error' ? '<span class="error-badge">Error</span>' : ''}
        ${body}
        ${attachments}
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

function renderMessageAttachments(attachments) {
  const normalized = normalizeTimelineAttachments(attachments);
  if (!normalized.length) {
    return '';
  }
  return `
        <div class="message-attachments" aria-label="Message attachments">
          ${normalized.map(renderMessageAttachment).join('')}
        </div>
  `;
}

function renderMessageAttachment(attachment) {
  const kindLabel = attachment.kind === 'image' ? 'Image' : 'File';
  const fileName = attachment.fileName || fileNameFromPath(attachment.localPath) || 'upload';
  const meta = [
    typeof attachment.sizeBytes === 'number' && attachment.sizeBytes > 0 ? formatAttachmentSize(attachment.sizeBytes) : '',
    attachment.mimeType || '',
  ].filter(Boolean).join(' · ');
  return `
            <span class="message-attachment ${attachment.kind === 'image' ? 'is-image' : 'is-file'}">
              <span class="message-attachment-kind">${escapeHtml(kindLabel)}</span>
              <span class="message-attachment-name">${escapeHtml(fileName)}</span>
              ${meta ? `<span class="message-attachment-meta">${escapeHtml(meta)}</span>` : ''}
            </span>
  `;
}

function renderWorkItem(item) {
  const summary = summarizeWorkItem(item);
  const details = workDetailsForItem(item);
  const hasError = workItemHasError(item);
  return `
    <details class="card work-card${hasError ? ' work-error' : ''}" open>
      <summary>
        <span class="work-title">Work</span>
        <span class="work-counts">${escapeHtml(formatWorkCounts(summary))}</span>
        ${hasError ? '<span class="error-badge">Error</span>' : `<span class="card-kind">${escapeHtml(item.status || 'running')}</span>`}
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

function workItemHasError(item) {
  return item?.status === 'error'
    || item?.status === 'failed'
    || (item.batches || []).some(workBatchHasError)
    || (item.approvals || []).some((approval) => approval.summary?.error);
}

function workBatchHasError(batch) {
  const status = String(batch?.status || '').toLowerCase();
  const exitCode = Number(batch?.summary?.exitCode);
  return Boolean(batch?.summary?.error)
    || status === 'failed'
    || status === 'error'
    || (Number.isFinite(exitCode) && exitCode !== 0);
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
      fileChanges: workFileChanges(batch),
    })),
    ...(item.approvals || []).map((approval) => ({
      kind: 'approval',
      title: approval.summary?.command || approval.summary?.reason || approval.approvalKind || 'Approval requested',
      status: approval.resolved ? approval.summary?.decision || 'resolved' : 'requested',
      summary: approval.summary || {},
      fileChanges: [],
    })),
  ];
}

function renderWorkDetail(detail) {
  const body = renderWorkDetailBody(detail);
  return `
    <details class="work-detail" data-work-kind="${escapeAttribute(detail.kind)}">
      <summary>
        <span class="work-event-kind">${escapeHtml(workKindLabel(detail.kind))}</span>
        <span class="work-event-title">${escapeHtml(detail.title)}</span>
        <span class="work-event-status">${escapeHtml(detail.status || '')}</span>
      </summary>
      <div class="work-detail-body">
        ${body || '<p class="meta">No additional details.</p>'}
      </div>
    </details>
  `;
}

function renderWorkDetailBody(detail) {
  const summary = detail.summary || {};
  const rows = renderWorkSummaryRows(summary);
  const files = renderWorkFileChanges(detail.fileChanges || []);
  const output = renderWorkTextBlock('Output', summary.output);
  const diff = renderWorkTextBlock('Diff', summary.diff || summary.patch);
  return [rows, files, output, diff].filter(Boolean).join('');
}

function renderWorkSummaryRows(summary) {
  const excludedKeys = ['fileChanges', 'output', 'diff', 'patch', 'raw'];
  const entries = Object.entries(summary || {})
    .filter(([key, value]) => !excludedKeys.includes(key) && hasSummaryValue(value));
  if (!entries.length) {
    return '';
  }
  return `<div class="work-summary">${entries.map(([key, value]) => `
    <div class="work-row"><strong>${escapeHtml(startCase(key))}</strong><span>${escapeHtml(shorten(formatSummaryValue(value), 800))}</span></div>
  `).join('')}</div>`;
}

function renderWorkFileChanges(changes) {
  if (!Array.isArray(changes) || !changes.length) {
    return '';
  }
  return `<div class="work-files">${changes.map((change) => {
    const path = change?.path || change?.file || change?.target || change?.source || '';
    const action = change?.action || change?.type || change?.status || '';
    const stats = formatWorkChangeStats(change);
    return `
      <div class="work-file-change">
        <span class="work-file-path">${escapeHtml(path)}</span>
        ${action ? `<span class="work-file-action">${escapeHtml(action)}</span>` : ''}
        ${stats ? `<span class="work-file-stats">${escapeHtml(stats)}</span>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function renderWorkTextBlock(label, value) {
  if (!hasSummaryValue(value)) {
    return '';
  }
  return `
    <div class="work-text-block">
      <strong>${escapeHtml(label)}</strong>
      <pre class="work-output">${escapeHtml(String(value))}</pre>
    </div>
  `;
}

function formatWorkChangeStats(change) {
  const additions = Number(change?.additions ?? change?.added ?? NaN);
  const deletions = Number(change?.deletions ?? change?.deleted ?? NaN);
  const hasAdditions = Number.isFinite(additions);
  const hasDeletions = Number.isFinite(deletions);
  if (!hasAdditions && !hasDeletions) {
    return '';
  }
  return `+${hasAdditions ? additions : 0} / -${hasDeletions ? deletions : 0}`;
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
  return workFileChanges(batch)
    .map((change) => change?.path || change?.file || change?.target || change?.source)
    .filter(Boolean)
    .map(String);
}

function workFileChanges(batch) {
  const changes = batch.summary?.fileChanges;
  if (Array.isArray(changes)) {
    return changes;
  }
  const path = batch.summary?.path || batch.summary?.file;
  return path ? [{ path }] : [];
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

function renderModelOptions(currentValue = state.model) {
  const current = currentValue || '';
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

  for (const button of document.querySelectorAll('[data-queued-message-id]')) {
    button.addEventListener('click', () => {
      removeQueuedMessage(currentQueuedSessionId(), button.getAttribute('data-queued-message-id') || '');
    });
  }

  const logoutButton = document.querySelector('#logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', onLogout);
  }

  const settingsLogoutButton = document.querySelector('#settings-logout-button');
  if (settingsLogoutButton) {
    settingsLogoutButton.addEventListener('click', onLogout);
  }

  const openAppSettingsButton = document.querySelector('#open-app-settings-button');
  if (openAppSettingsButton) {
    openAppSettingsButton.addEventListener('click', () => {
      openAppSettingsPage();
    });
  }

  const openNewSessionButton = document.querySelector('#open-new-session-button');
  if (openNewSessionButton) {
    openNewSessionButton.addEventListener('click', () => {
      openNewSessionPage();
    });
  }

  const openAdminConsoleButton = document.querySelector('#open-admin-console-button');
  if (openAdminConsoleButton) {
    openAdminConsoleButton.addEventListener('click', () => {
      void openAdminConsole();
    });
  }

  const stopButton = document.querySelector('#stop-button');
  if (stopButton) {
    stopButton.addEventListener('click', onStopTurn);
  }

  const runtimeReloadButton = document.querySelector('#runtime-reload-button');
  if (runtimeReloadButton) {
    runtimeReloadButton.addEventListener('click', () => {
      void reloadRuntime();
    });
  }

  const composerRefreshButton = document.querySelector('#composer-refresh-button');
  if (composerRefreshButton) {
    composerRefreshButton.addEventListener('click', () => {
      void handleComposerRefresh();
    });
  }

  const attachButton = document.querySelector('#attach-button');
  const attachmentInput = document.querySelector('#attachment-input');
  if (attachButton && attachmentInput) {
    attachButton.addEventListener('click', () => {
      attachmentInput.click?.();
    });
    attachmentInput.addEventListener('change', (event) => {
      void handleAttachmentInputChange(event);
    });
  }

  for (const button of document.querySelectorAll('[data-attachment-remove-id]')) {
    button.addEventListener('click', () => {
      removeComposerAttachment(button.getAttribute('data-attachment-remove-id') || '');
    });
  }

  const railShowSessionsButton = document.querySelector('#rail-show-sessions-button');
  if (railShowSessionsButton) {
    railShowSessionsButton.addEventListener('click', () => {
      showSessionList();
    });
  }

  const mobileSidebarToggleButton = document.querySelector('#mobile-sidebar-toggle-button');
  if (mobileSidebarToggleButton) {
    mobileSidebarToggleButton.addEventListener('click', () => {
      state.mobileSidebarOpen = true;
      render();
    });
  }

  const mobileProjectDrawerBackdrop = document.querySelector('#mobile-drawer-backdrop');
  if (mobileProjectDrawerBackdrop) {
    mobileProjectDrawerBackdrop.addEventListener('click', (event) => {
      if (event.target !== mobileProjectDrawerBackdrop) {
        return;
      }
      state.mobileSidebarOpen = false;
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-project-scope-key]')) {
    button.addEventListener('click', () => {
      void selectProjectScope(button.getAttribute('data-project-scope-key') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-project-favorite-id]')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleProjectFavorite(button.getAttribute('data-project-favorite-id') || '');
    });
  }

  const desktopEmptyNewSessionButton = document.querySelector('#desktop-empty-new-session-button');
  if (desktopEmptyNewSessionButton) {
    desktopEmptyNewSessionButton.addEventListener('click', () => {
      openNewSessionPage();
    });
  }

  const desktopSettingsCloseButton = document.querySelector('#desktop-settings-close-button');
  if (desktopSettingsCloseButton) {
    desktopSettingsCloseButton.addEventListener('click', () => {
      state.desktopSettingsOpen = false;
      render();
    });
  }

  const openReportsButton = document.querySelector('#open-reports-button');
  if (openReportsButton) {
    openReportsButton.addEventListener('click', () => {
      void openReportsPage();
    });
  }

  const desktopReportsCloseButton = document.querySelector('#desktop-reports-close-button');
  if (desktopReportsCloseButton) {
    desktopReportsCloseButton.addEventListener('click', () => {
      closeReportsPage();
    });
  }

  const shareSessionButton = document.querySelector('#share-session-button');
  if (shareSessionButton) {
    shareSessionButton.addEventListener('click', () => {
      void shareCurrentSession();
    });
  }

  const copyShareLinkButton = document.querySelector('#copy-share-link-button');
  if (copyShareLinkButton) {
    copyShareLinkButton.addEventListener('click', () => {
      void copyShareLink(state.shareDialog?.url || '');
    });
  }

  const closeShareDialogButton = document.querySelector('#close-share-dialog-button');
  if (closeShareDialogButton) {
    closeShareDialogButton.addEventListener('click', () => {
      state.shareDialog = null;
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-report-project]')) {
    button.addEventListener('click', () => {
      state.reportProject = button.getAttribute('data-report-project') || '';
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-report-id]')) {
    button.addEventListener('click', () => {
      void openReportById(button.getAttribute('data-report-id') || '', { returnView: 'reports' });
    });
  }

  for (const button of document.querySelectorAll('[data-session-reports-project]')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void openReportsPage({ project: button.getAttribute('data-session-reports-project') || '', returnView: 'chat' });
    });
  }

  for (const button of document.querySelectorAll('[data-report-favorite-id]')) {
    button.addEventListener('click', () => {
      void toggleReportFavorite(button.getAttribute('data-report-favorite-id') || '');
    });
  }

  for (const link of document.querySelectorAll('[data-report-path]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void openReportByPath(link.getAttribute('data-report-path') || '', { returnView: 'chat' });
    });
  }

  const backToReportsButton = document.querySelector('#back-to-reports-button');
  if (backToReportsButton) {
    backToReportsButton.addEventListener('click', () => {
      closeReportViewer();
    });
  }

  const backToListButton = document.querySelector('#back-to-list-button');
  if (backToListButton) {
    backToListButton.addEventListener('click', () => {
      if (state.view === 'reports') {
        handleReportsBackNavigation();
      } else {
        showSessionList();
      }
    });
  }

  for (const button of document.querySelectorAll('[data-session-id]')) {
    button.addEventListener('click', () => {
      rememberSessionListScroll();
      void selectSession(button.getAttribute('data-session-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-sort-mode]')) {
    button.addEventListener('click', () => {
      void setSessionSortMode(button.getAttribute('data-sort-mode') || 'favorites');
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

  const newProjectSelect = document.querySelector('#new-project-select');
  if (newProjectSelect) {
    newProjectSelect.addEventListener('change', (event) => {
      state.newProjectId = event.target.value;
    });
  }

  const adminMultiUserToggle = document.querySelector('#admin-multi-user-toggle');
  if (adminMultiUserToggle) {
    adminMultiUserToggle.addEventListener('change', (event) => {
      void updateAdminSettings({ multiUserEnabled: event.target.checked });
    });
  }

  const adminSessionUserFilter = document.querySelector('#admin-session-user-filter');
  if (adminSessionUserFilter) {
    adminSessionUserFilter.addEventListener('change', (event) => {
      void refreshAdminSessions({ userId: event.target.value, renderAfter: true });
    });
  }

  const adminSessionProjectFilter = document.querySelector('#admin-session-project-filter');
  if (adminSessionProjectFilter) {
    adminSessionProjectFilter.addEventListener('change', (event) => {
      void refreshAdminSessions({ projectId: event.target.value, renderAfter: true });
    });
  }

  for (const button of document.querySelectorAll('[data-admin-page]')) {
    button.addEventListener('click', () => {
      state.admin.page = normalizeAdminPage(button.getAttribute('data-admin-page') || '');
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-admin-edit-project]')) {
    button.addEventListener('click', () => {
      state.admin.editingProjectId = button.getAttribute('data-admin-edit-project') || '';
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-admin-edit-role]')) {
    button.addEventListener('click', () => {
      state.admin.editingRoleId = button.getAttribute('data-admin-edit-role') || '';
      render();
    });
  }

  const adminProjectEditCancel = document.querySelector('#admin-project-edit-cancel');
  if (adminProjectEditCancel) {
    adminProjectEditCancel.addEventListener('click', () => {
      state.admin.editingProjectId = '';
      render();
    });
  }

  const adminRoleEditCancel = document.querySelector('#admin-role-edit-cancel');
  if (adminRoleEditCancel) {
    adminRoleEditCancel.addEventListener('click', () => {
      state.admin.editingRoleId = '';
      render();
    });
  }

  const adminProjectForm = document.querySelector('#admin-project-form');
  if (adminProjectForm) {
    adminProjectForm.addEventListener('submit', (event) => {
      void onAdminProjectSubmit(event);
    });
  }

  const adminRoleForm = document.querySelector('#admin-role-form');
  if (adminRoleForm) {
    adminRoleForm.addEventListener('submit', (event) => {
      void onAdminRoleSubmit(event);
    });
  }

  const adminUserForm = document.querySelector('#admin-user-form');
  if (adminUserForm) {
    adminUserForm.addEventListener('submit', (event) => {
      void onAdminUserSubmit(event);
    });
  }

  for (const form of document.querySelectorAll('.admin-user-access-form')) {
    form.addEventListener('submit', (event) => {
      void onAdminUserAccessSubmit(event);
    });
  }

  for (const button of document.querySelectorAll('[data-admin-toggle-user-id]')) {
    button.addEventListener('click', () => {
      void toggleAdminUserEnabled(
        button.getAttribute('data-admin-toggle-user-id') || '',
        button.getAttribute('data-admin-toggle-user-enabled') === 'true',
      );
    });
  }

  for (const button of document.querySelectorAll('[data-admin-delete-user-id]')) {
    button.addEventListener('click', () => {
      void deleteAdminUser(button.getAttribute('data-admin-delete-user-id') || '');
    });
  }

  for (const button of document.querySelectorAll('[data-admin-session-id]')) {
    button.addEventListener('click', () => {
      void openAdminObservedSession(button.getAttribute('data-admin-session-id') || '');
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
    promptInput.addEventListener('touchstart', syncPromptFocusLayout, { passive: true });
    promptInput.addEventListener('focus', syncPromptFocusLayout);
    promptInput.addEventListener('keydown', handlePromptKeydown);
    promptInput.addEventListener('input', (event) => {
      state.prompt = event.target.value;
      savePromptDraftForCurrentSession();
      syncPromptInputLayout(event.target);
    });
    updateComposerExpansionState(promptInput);
    autoGrowPromptInput(promptInput);
  }

  const settingsToggle = document.querySelector('#settings-toggle');
  if (settingsToggle) {
    settingsToggle.addEventListener('click', toggleSettingsDrawer);
  }

  const composerExpandButton = document.querySelector('#composer-expand-button');
  if (composerExpandButton) {
    composerExpandButton.addEventListener('click', toggleComposerExpanded);
  }

  for (const button of document.querySelectorAll('[data-message-font-size]')) {
    button.addEventListener('click', () => {
      setMessageFontSize(button.getAttribute('data-message-font-size') || DEFAULT_MESSAGE_FONT_SIZE);
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

  const defaultModelSelect = document.querySelector('#default-model-select');
  if (defaultModelSelect) {
    defaultModelSelect.addEventListener('change', (event) => {
      applyDefaultThreadSettings({ model: event.target.value });
      render();
    });
  }

  const defaultReasoningSelect = document.querySelector('#default-reasoning-select');
  if (defaultReasoningSelect) {
    defaultReasoningSelect.addEventListener('change', (event) => {
      applyDefaultThreadSettings({ reasoningEffort: event.target.value });
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-app-theme]')) {
    button.addEventListener('click', () => {
      applyTheme(button.getAttribute('data-app-theme') || DEFAULT_THEME);
      render();
    });
  }

  const siteTitleInput = document.querySelector('#site-title-input');
  if (siteTitleInput) {
    siteTitleInput.addEventListener('input', (event) => {
      applySiteTitle(event.target.value);
    });
  }

  for (const button of document.querySelectorAll('[data-default-mode]')) {
    button.addEventListener('click', () => {
      applyDefaultThreadSettings({ collaborationMode: button.getAttribute('data-default-mode') || DEFAULT_COLLABORATION_MODE });
      render();
    });
  }

  for (const button of document.querySelectorAll('[data-default-permission-preset]')) {
    button.addEventListener('click', () => {
      applyDefaultThreadSettings({ accessPreset: button.getAttribute('data-default-permission-preset') || DEFAULT_PERMISSION_PRESET });
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

function toggleSettingsDrawer() {
  state.settingsOpen = !state.settingsOpen;
  withTimelineScrollPreserved(() => render());
}

function handleSessionSettingsOutsideClick(event) {
  if (!state.settingsOpen) {
    return;
  }
  const target = event?.target;
  if (target?.closest?.('#settings-toggle, .settings-drawer')) {
    return;
  }
  state.settingsOpen = false;
  withTimelineScrollPreserved(() => render());
}

function toggleComposerExpanded() {
  if (!state.composerCanExpand && !state.composerExpanded) {
    return;
  }
  state.composerExpanded = !state.composerExpanded;
  state.settingsOpen = false;
  withTimelineBottomOffsetPreserved(() => {
    syncComposerPresentation();
    const promptInput = document.querySelector('#prompt-input');
    if (promptInput) {
      autoGrowPromptInput(promptInput);
    }
    syncComposerOffset();
  });
}

function updateComposerExpansionState(textarea) {
  if (!textarea) {
    return;
  }
  const styles = window.getComputedStyle?.(textarea);
  const lineHeight = Number.parseFloat(styles?.lineHeight || textarea.style?.lineHeight || '') || 22;
  const paddingTop = Number.parseFloat(styles?.paddingTop || '0') || 0;
  const paddingBottom = Number.parseFloat(styles?.paddingBottom || '0') || 0;
  const contentHeight = Math.max(0, textarea.scrollHeight - paddingTop - paddingBottom);
  const visibleLineCount = Math.ceil(contentHeight / Math.max(1, lineHeight));
  const canExpand = visibleLineCount >= PROMPT_EXPAND_LINE_THRESHOLD;
  if (canExpand === state.composerCanExpand) {
    return;
  }
  state.composerCanExpand = canExpand;
  if (!canExpand) {
    state.composerExpanded = false;
  }
  withTimelineBottomOffsetPreserved(() => {
    syncComposerPresentation();
    autoGrowPromptInput(textarea);
    syncComposerOffset();
  });
}

function syncComposerPresentation() {
  const composerForm = document.querySelector('#composer-form');
  const composerWrap = document.querySelector('.composer-wrap');
  const messageEditor = document.querySelector('.message-editor-shell');
  const composerClassName = composerStateClassName();
  const classTargets = [composerWrap, composerForm, messageEditor];
  for (const target of classTargets) {
    if (!target?.classList) {
      continue;
    }
    target.classList.remove('is-expandable', 'is-expanded');
    if (composerClassName) {
      target.classList.add(composerClassName);
    }
  }
  const settingsToggle = document.querySelector('#settings-toggle');
  if (settingsToggle) {
    settingsToggle.setAttribute('aria-expanded', String(state.settingsOpen));
  }
  const composerExpandButton = document.querySelector('#composer-expand-button');
  if (composerExpandButton) {
    const showExpandButton = state.composerCanExpand || state.composerExpanded;
    composerExpandButton.hidden = !showExpandButton;
    composerExpandButton.setAttribute('aria-expanded', String(state.composerExpanded));
    composerExpandButton.setAttribute('aria-label', state.composerExpanded ? 'Collapse message editor' : 'Expand message editor');
    composerExpandButton.textContent = state.composerExpanded ? 'v' : '^';
  }
}

function refreshChatDynamicUi() {
  if (state.view !== 'chat') {
    return false;
  }
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    render();
    return false;
  }
  timeline.innerHTML = renderTimeline();
  bindTimelineActionEvents();
  syncComposerStatusDisplay();
  syncComposerErrorDisplay();
  syncComposerOffset();
  return true;
}

function syncComposerStatusDisplay() {
  const composerWrap = document.querySelector('.composer-wrap');
  if (!composerWrap) {
    return;
  }
  const current = composerWrap.querySelector?.('.composer-status');
  if (state.composerExpanded) {
    current?.remove?.();
    return;
  }
  const statusHtml = renderComposerStatus();
  if (current) {
    current.outerHTML = statusHtml;
    return;
  }
  const composerForm = document.querySelector('#composer-form');
  if (composerForm && composerWrap.insertBefore) {
    composerWrap.insertBefore(htmlToElement(statusHtml), composerForm);
  }
}

function syncComposerErrorDisplay() {
  const composerForm = document.querySelector('#composer-form');
  if (!composerForm) {
    return;
  }
  const current = composerForm.querySelector?.('.composer-error');
  if (!state.error || state.composerExpanded) {
    current?.remove?.();
    return;
  }
  const errorHtml = `<div class="composer-error">${escapeHtml(shorten(state.error, 96))}</div>`;
  if (current) {
    current.outerHTML = errorHtml;
    return;
  }
  const row = composerForm.querySelector?.('.compact-composer-row');
  if (row && composerForm.insertBefore) {
    composerForm.insertBefore(htmlToElement(errorHtml), row);
  }
}

async function handleAttachmentInputChange(event) {
  const files = Array.from(event?.target?.files || []);
  if (event?.target) {
    event.target.value = '';
  }
  if (!files.length) {
    return;
  }
  if (state.pendingTurn) {
    state.error = 'Wait for the current turn to finish before attaching files.';
    state.status = 'Turn running';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  await uploadComposerAttachments(files);
}

async function uploadComposerAttachments(files) {
  const pendingAttachments = files.map(createPendingComposerAttachment);
  state.composerAttachments.push(...pendingAttachments);
  state.error = '';
  state.status = 'Uploading attachment';
  state.statusTone = 'warn';
  renderChatAtLatestIfFollowing(() => {});

  try {
    const sessionId = await ensureSession();
    const payload = await uploadSessionAttachments(sessionId, files);
    const uploadedItems = Array.isArray(payload?.items) ? payload.items : [];
    pendingAttachments.forEach((attachment, index) => {
      const uploaded = uploadedItems[index];
      if (!uploaded?.localPath) {
        updateComposerAttachment(attachment.id, {
          status: 'failed',
          error: 'Upload response did not include a readable file path.',
        });
        return;
      }
      updateComposerAttachment(attachment.id, {
        status: 'ready',
        uploaded: normalizeUploadedAttachment(uploaded, attachment),
      });
    });
    if (hasFailedComposerAttachments()) {
      state.status = 'Upload failed';
      state.statusTone = 'danger';
      state.error = 'Upload response did not include a readable file path.';
    } else {
      state.status = 'Attachment uploaded';
      state.statusTone = 'success';
      state.error = '';
    }
  } catch (error) {
    const message = error?.payload?.message || error?.message || 'Upload failed';
    for (const attachment of pendingAttachments) {
      updateComposerAttachment(attachment.id, {
        status: 'failed',
        error: message,
      });
    }
    state.status = 'Upload failed';
    state.statusTone = 'danger';
    state.error = message;
  }
  renderChatAtLatestIfFollowing(() => {});
}

function createPendingComposerAttachment(file) {
  return {
    id: `local_att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    status: 'uploading',
    fileName: String(file?.name || 'upload'),
    sizeBytes: Number.isFinite(file?.size) ? Number(file.size) : 0,
    mimeType: String(file?.type || ''),
  };
}

function updateComposerAttachment(attachmentId, patch) {
  const index = state.composerAttachments.findIndex((attachment) => attachment.id === attachmentId);
  if (index < 0) {
    return false;
  }
  state.composerAttachments[index] = {
    ...state.composerAttachments[index],
    ...patch,
  };
  return true;
}

function removeComposerAttachment(attachmentId) {
  const next = state.composerAttachments.filter((attachment) => attachment.id !== attachmentId);
  if (next.length === state.composerAttachments.length) {
    return;
  }
  state.composerAttachments = next;
  if (!hasFailedComposerAttachments() && state.error === 'Remove failed uploads before sending.') {
    state.error = '';
  }
  renderChatAtLatestIfFollowing(() => {});
}

async function uploadSessionAttachments(sessionId, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file, file?.name || 'upload');
  }
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: formData,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.json();
}

function normalizeUploadedAttachment(uploaded, fallback) {
  return {
    id: String(uploaded.id || fallback.id),
    kind: uploaded.kind === 'image' ? 'image' : 'file',
    fileName: String(uploaded.fileName || fallback.fileName || 'upload'),
    mimeType: typeof uploaded.mimeType === 'string' ? uploaded.mimeType : fallback.mimeType || null,
    sizeBytes: Number.isFinite(uploaded.sizeBytes) ? Number(uploaded.sizeBytes) : fallback.sizeBytes || 0,
    storage: uploaded.storage === 'state' ? 'state' : 'project',
    localPath: String(uploaded.localPath || ''),
    displayPath: typeof uploaded.displayPath === 'string' ? uploaded.displayPath : undefined,
  };
}

function htmlToElement(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  return template.content.firstElementChild;
}

function bindTimelineActionEvents() {
  for (const button of document.querySelectorAll('[data-approval-action]')) {
    button.addEventListener('click', () => {
      void resolveApproval(
        button.getAttribute('data-approval-id'),
        button.getAttribute('data-approval-action'),
      );
    });
  }

  for (const link of document.querySelectorAll('[data-report-path]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void openReportByPath(link.getAttribute('data-report-path') || '', { returnView: 'chat' });
    });
  }
}

function rememberSessionListScroll() {
  const sessionList = document.querySelector('.session-list');
  if (!sessionList) {
    return;
  }
  sessionListRestoreScrollTop = sessionList.scrollTop || 0;
}

function restoreSessionListScroll() {
  if (sessionListRestoreScrollTop === null) {
    return;
  }
  requestAnimationFrame(() => {
    const sessionList = document.querySelector('.session-list');
    if (!sessionList) {
      return;
    }
    sessionList.scrollTop = sessionListRestoreScrollTop;
    sessionListRestoreScrollTop = null;
  });
}

function captureTimelineViewport() {
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    return {
      bottomOffset: 0,
      shouldFollowLatest: state.timelineShouldFollowLatest,
      hadPromptFocus: false,
    };
  }
  const bottomOffset = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  const shouldFollowLatest = bottomOffset <= TIMELINE_FOLLOW_LATEST_TOLERANCE_PX;
  state.timelineShouldFollowLatest = shouldFollowLatest;
  return {
    bottomOffset,
    shouldFollowLatest,
    hadPromptFocus: document.activeElement === document.querySelector('#prompt-input'),
  };
}

function restoreTimelineViewport(snapshot) {
  if (!snapshot) {
    return;
  }
  requestAnimationFrame(() => {
    const timeline = document.querySelector('#timeline');
    if (!timeline) {
      return;
    }
    if (snapshot.shouldFollowLatest) {
      timeline.scrollTop = timeline.scrollHeight;
    } else {
      timeline.scrollTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight - Number(snapshot.bottomOffset || 0));
    }
    state.timelineShouldFollowLatest = snapshot.shouldFollowLatest !== false;
    rememberCurrentTimelineViewport();
    if (snapshot.hadPromptFocus) {
      document.querySelector('#prompt-input')?.focus?.();
    }
  });
}

function renderChatWithTimelineRestored(callback) {
  const snapshot = nextTimelineRestoreSnapshot || captureTimelineViewport();
  nextTimelineRestoreSnapshot = null;
  callback();
  render();
  restoreTimelineViewport(snapshot);
}

function latestTimelineViewportSnapshot() {
  return {
    bottomOffset: 0,
    shouldFollowLatest: true,
    hadPromptFocus: document.activeElement === document.querySelector('#prompt-input'),
  };
}

function renderChatAtLatest(callback) {
  const snapshot = latestTimelineViewportSnapshot();
  state.timelineShouldFollowLatest = true;
  callback();
  render();
  restoreTimelineViewport(snapshot);
}

function renderChatAtLatestIfFollowing(callback) {
  const snapshot = captureTimelineViewport();
  const shouldFollowLatest = isDesktopWorkspaceView() || snapshot.shouldFollowLatest;
  callback();
  render();
  restoreTimelineViewport({
    ...snapshot,
    bottomOffset: shouldFollowLatest ? 0 : snapshot.bottomOffset,
    shouldFollowLatest,
  });
}

function captureReportViewerViewport() {
  const reportViewer = document.querySelector('.report-viewer');
  if (!reportViewer) {
    return null;
  }
  return {
    scrollTop: reportViewer.scrollTop || 0,
  };
}

function restoreReportViewerViewport(snapshot) {
  if (!snapshot) {
    return;
  }
  requestAnimationFrame(() => {
    const reportViewer = document.querySelector('.report-viewer');
    if (reportViewer) {
      reportViewer.scrollTop = Math.max(0, Number(snapshot.scrollTop || 0));
    }
  });
}

function renderReportWithScrollPreserved(callback) {
  const snapshot = captureReportViewerViewport();
  callback();
  render();
  restoreReportViewerViewport(snapshot);
}

function withTimelineScrollPreserved(callback) {
  const timeline = document.querySelector('#timeline');
  const previousScrollTop = timeline?.scrollTop ?? null;
  const previousScrollHeight = timeline?.scrollHeight ?? null;
  callback();
  requestAnimationFrame(() => {
    const nextTimeline = document.querySelector('#timeline');
    if (!nextTimeline || previousScrollTop === null || previousScrollHeight === null) {
      return;
    }
    const heightDelta = nextTimeline.scrollHeight - previousScrollHeight;
    nextTimeline.scrollTop = Math.max(0, previousScrollTop + heightDelta);
  });
}

function withTimelineBottomOffsetPreserved(callback) {
  const timeline = document.querySelector('#timeline');
  const previousScrollHeight = timeline?.scrollHeight ?? null;
  const previousClientHeight = timeline?.clientHeight ?? null;
  const previousScrollTop = timeline?.scrollTop ?? null;
  const previousBottomOffset = previousScrollHeight !== null && previousClientHeight !== null && previousScrollTop !== null
    ? Math.max(0, previousScrollHeight - previousClientHeight - previousScrollTop)
    : null;
  callback();
  if (previousBottomOffset === null) {
    return;
  }
  scheduleTimelineViewportRestore(previousBottomOffset);
}

function scheduleTimelineViewportRestore(bottomOffset) {
  requestAnimationFrame(() => {
    const timeline = document.querySelector('#timeline');
    if (!timeline) {
      return;
    }
    timeline.scrollTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight - Number(bottomOffset || 0));
  });
}

function protectPromptFocusScroll() {
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    return;
  }
  const bottomOffset = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  scheduleTimelineViewportRestore(bottomOffset);
  if (promptFocusRestoreTimer) {
    clearTimeout(promptFocusRestoreTimer);
  }
  promptFocusRestoreTimer = setTimeout(() => {
    scheduleTimelineViewportRestore(bottomOffset);
    promptFocusRestoreTimer = null;
  }, 160);
}

function syncPromptFocusLayout(eventOrTextarea) {
  const textarea = eventOrTextarea?.target ?? eventOrTextarea;
  protectPromptFocusScroll();
  syncPromptInputLayout(textarea);
  requestAnimationFrame(() => {
    syncPromptInputLayout(textarea);
  });
  if (promptFocusLayoutTimer) {
    clearTimeout(promptFocusLayoutTimer);
  }
  promptFocusLayoutTimer = setTimeout(() => {
    syncPromptInputLayout(textarea);
    promptFocusLayoutTimer = null;
  }, 180);
}

function syncPromptInputLayout(textarea) {
  if (!textarea) {
    return;
  }
  updateComposerExpansionState(textarea);
  autoGrowPromptInput(textarea);
  syncComposerOffset();
}

function handlePromptKeydown(event) {
  return;
}

function autoGrowPromptInput(textarea) {
  if (!textarea?.style) {
    return;
  }
  if (state.composerExpanded) {
    textarea.style.height = '';
    return;
  }
  textarea.style.height = 'auto';
  const maxHeight = isDesktopLayout() ? DESKTOP_PROMPT_TEXTAREA_MAX_HEIGHT : PROMPT_TEXTAREA_MAX_HEIGHT;
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${Math.max(38, nextHeight)}px`;
}

function attachTimelineScrollTracking({ updateInitial = true } = {}) {
  const timeline = document.querySelector('#timeline');
  if (!timeline || timelineScrollTrackingAttached) {
    return;
  }
  timeline.addEventListener('scroll', updateTimelineFollowState, { passive: true });
  timeline.addEventListener('wheel', handleTimelineWheel, { passive: false });
  timelineScrollTrackingAttached = true;
  if (updateInitial) {
    updateTimelineFollowState();
  }
}

function handleTimelineWheel(event) {
  if (!isDesktopWorkspaceView() || !state.sessionId || Number(event?.deltaY || 0) >= 0) {
    return;
  }
  const timeline = document.querySelector('#timeline');
  if (!timeline || timeline.scrollTop > 0) {
    return;
  }
  if (showMoreSessionHistory()) {
    event?.preventDefault?.();
  }
}

function updateTimelineFollowState() {
  const timeline = document.querySelector('#timeline');
  if (!timeline) {
    return;
  }
  const bottomOffset = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  state.timelineShouldFollowLatest = bottomOffset <= TIMELINE_FOLLOW_LATEST_TOLERANCE_PX;
  rememberCurrentTimelineViewport();
}

function scrollTimelineToBottomIfFollowingLatest() {
  if (!state.timelineShouldFollowLatest) {
    return;
  }
  scrollTimelineToBottom();
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username') || '');
  const password = String(form.get('password') || '');
  state.loginError = '';
  state.status = 'Logging in';
  state.statusTone = 'warn';
  render();
  try {
    const payload = await apiFetch('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: { username, password },
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
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  stopStream();
  rememberSessionListScroll();
  state.view = 'sessions';
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.reportReturnView = 'reports';
  state.archiveConfirmSessionId = null;
  state.mobileSidebarOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  if (!isDesktopLayout()) {
    state.sessionId = null;
    state.currentSession = null;
    state.draftSessionActive = false;
    state.turnId = null;
    state.pendingTurn = false;
    state.composerExpanded = false;
    state.composerAttachments = [];
    resetTurnState();
    resetSessionHistoryWindow();
  }
  state.error = '';
  render();
}

async function openReportsPage({ project = '', returnView = 'sessions' } = {}) {
  savePromptDraftForCurrentSession();
  const normalizedProject = String(project || '').trim();
  const normalizedReturnView = returnView === 'chat' && state.sessionId ? 'chat' : 'sessions';
  state.mobileSidebarOpen = false;
  if (isDesktopLayout()) {
    state.view = 'sessions';
    state.desktopOverlay = 'reports';
    state.desktopSettingsOpen = false;
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
  if (normalizedReturnView === 'chat') {
    chatTimelineReturnSnapshot = captureTimelineViewport();
  }
  if (normalizedReturnView !== 'chat') {
    saveCurrentTimeline();
    stopStream();
  }
  state.view = 'reports';
  state.archiveConfirmSessionId = null;
  if (normalizedReturnView !== 'chat') {
    state.sessionId = null;
    state.currentSession = null;
    state.draftSessionActive = false;
    resetTurnState();
  }
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.reportReturnView = 'reports';
  state.reportsReturnView = normalizedReturnView;
  state.reportProject = normalizedProject;
  state.error = '';
  if (!state.reportsLoaded) {
    await refreshReportsList({ renderAfter: true });
    return;
  }
  render();
}

function closeReportsPage() {
  state.mobileSidebarOpen = false;
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
  if (state.reportsReturnView === 'chat' && state.sessionId) {
    const snapshot = chatTimelineReturnSnapshot || captureTimelineViewport();
    state.currentReport = null;
    state.currentReportContent = '';
    state.currentReportLoading = false;
    state.reportProject = '';
    state.view = 'chat';
    render();
    restoreTimelineViewport(snapshot);
    chatTimelineReturnSnapshot = null;
    return;
  }
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.reportProject = '';
  showSessionList();
}

function handleReportsBackNavigation() {
  if (state.reportProject && state.reportsReturnView !== 'chat') {
    state.reportProject = '';
    render();
    return;
  }
  closeReportsPage();
}

function openAppSettingsPage() {
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  state.archiveConfirmSessionId = null;
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.mobileSidebarOpen = false;
  state.error = '';
  if (isDesktopLayout()) {
    state.view = 'sessions';
    state.desktopSettingsOpen = true;
    state.desktopOverlay = null;
    render();
    if (isAdminPrincipal() && state.admin.settings === null) {
      void refreshAdminSettings({ renderAfter: true });
    }
    return;
  }
  stopStream();
  state.view = 'settings';
  state.sessionId = null;
  state.currentSession = null;
  resetTurnState();
  render();
  if (isAdminPrincipal() && state.admin.settings === null) {
    void refreshAdminSettings({ renderAfter: true });
  }
}

async function openAdminConsole() {
  if (!isAdminPrincipal()) {
    return;
  }
  saveCurrentTimeline();
  stopStream();
  state.mobileSidebarOpen = false;
  state.view = 'admin';
  state.sessionId = null;
  state.currentSession = null;
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  resetTurnState();
  state.error = '';
  render();
  await refreshAdminConsole({ renderAfter: true });
}

function openNewSessionPage() {
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  if (!state.projectsLoaded) {
    void refreshProjectsList({ renderAfter: true });
  }
  initializeNewProjectSelection();
  seedNewSessionTargetFromSelection();
  state.mobileSidebarOpen = false;
  if (isDesktopLayout()) {
    applyDefaultSettings();
    state.view = 'new';
    state.desktopSettingsOpen = false;
    state.desktopOverlay = null;
    state.archiveConfirmSessionId = null;
    state.currentReport = null;
    state.currentReportContent = '';
    state.currentReportLoading = false;
    state.composerAttachments = [];
    state.error = '';
    render();
    return;
  }
  stopStream();
  applyDefaultSettings();
  state.view = 'new';
  state.archiveConfirmSessionId = null;
  state.sessionId = null;
  state.currentSession = null;
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.composerAttachments = [];
  resetTurnState();
  state.error = '';
  render();
}

function onNewSessionSubmit(event) {
  event.preventDefault();
  savePromptDraftForCurrentSession();
  const form = new FormData(event.currentTarget);
  const selectedProjectId = String(form.get('projectId') || state.newProjectId || '').trim();
  if (isMultiUserMode() && !selectedProjectId) {
    state.error = 'No projects are available for this account.';
    render();
    return;
  }
  saveCurrentTimeline();
  stopStream();
  applyDefaultSettings();
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.archiveConfirmSessionId = null;
  state.mobileSidebarOpen = false;
  state.sessionId = null;
  state.currentSession = null;
  state.draftSessionActive = true;
  state.newProjectId = selectedProjectId || state.newProjectId;
  if (selectedProjectId) {
    applySelectedProjectById(selectedProjectId);
  } else if (state.newCwd.trim()) {
    applySelectedLegacyProjectFromCwd(state.newCwd.trim());
  }
  state.cwd = selectedProjectId ? '' : state.newCwd.trim();
  state.prompt = '';
  state.composerAttachments = [];
  state.composerExpanded = false;
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
  savePromptDraftForCurrentSession();
  saveCurrentTimeline();
  stopStream();
  resetSessionHistoryWindow();
  state.sessionId = nextSession.id;
  state.currentSession = nextSession;
  state.draftSessionActive = false;
  state.archiveConfirmSessionId = null;
  state.cwd = nextSession.cwd || '';
  restorePromptDraftForSession(nextSession.id);
  applySessionSettings(nextSession);
  restoreTimelineForSession(nextSession);
  const restoredRuntimeStatus = syncRuntimeStatusFromSession(nextSession, { source: 'stale' });
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  state.mobileSidebarOpen = false;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  state.composerExpanded = false;
  state.settingsOpen = false;
  state.composerAttachments = [];
  state.error = '';
  state.status = restoredRuntimeStatus.changed && restoredRuntimeStatus.activeTurnId ? 'Turn running' : 'Loading session';
  state.statusTone = 'warn';
  state.timelineShouldFollowLatest = true;
  render();
  scrollTimelineToBottom();
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
  if (state.sessionId !== sessionId) {
    renderSessionListAfterBackgroundUpdate();
    return;
  }
  const refreshedSession = state.sessions.find((session) => session.id === sessionId) || nextSession;
  state.currentSession = refreshedSession;
  state.cwd = refreshedSession.cwd || '';
  restorePromptDraftForSession(refreshedSession.id);
  applySessionSettings(refreshedSession);
  restoreTimelineForSession(refreshedSession);
  const refreshedRuntimeStatus = syncRuntimeStatusFromSession(refreshedSession);
  state.error = '';
  state.view = isDesktopLayout() ? 'sessions' : 'chat';
  if (!refreshedRuntimeStatus.changed) {
    state.status = 'Ready';
    state.statusTone = 'success';
  }
  state.timelineShouldFollowLatest = true;
  render();
  scrollTimelineToBottom();
  if (refreshedRuntimeStatus.activeTurnId && state.turnId) {
    streamTurnEvents(state.turnId, { forceReconnect: true });
  }
}

function renderSessionListAfterBackgroundUpdate() {
  if (state.view !== 'sessions' && !isDesktopWorkspaceView()) {
    return;
  }
  rememberSessionListScroll();
  render();
}

async function onComposerSubmit(event) {
  event.preventDefault();
  const text = state.prompt.trim();
  if (!text) {
    return;
  }
  if (hasUploadingComposerAttachments()) {
    state.error = 'Wait for uploads to finish before sending.';
    state.status = 'Uploading attachment';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  if (hasFailedComposerAttachments()) {
    state.error = 'Remove failed uploads before sending.';
    state.status = 'Upload failed';
    state.statusTone = 'danger';
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  if (state.pendingTurn && state.sessionId && !isSlashCommandText(text)) {
    if (readyComposerAttachments().length) {
      state.error = 'Attachments cannot be queued while a turn is running.';
      state.status = 'Turn running';
      state.statusTone = 'warn';
      renderChatAtLatestIfFollowing(() => {});
      return;
    }
    enqueueQueuedMessage(state.sessionId, text);
    state.queuedInterruptRequestedTurnId = state.turnId || null;
    clearPromptDraftForCurrentSession();
    state.status = 'Turn running';
    state.statusTone = 'warn';
    renderChatAtLatestIfFollowing(() => {});
    void maybeInterruptRunningTurnForQueuedMessage();
    return;
  }
  await sendComposerMessage(text);
}

function isSlashCommandText(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === '/help' || normalized === '/goal' || normalized.startsWith('/goal ');
}

async function sendComposerMessage(text, { queuedMessageId = '', sessionId: preferredSessionId = '', includeComposerAttachments = true } = {}) {
  state.error = '';
  state.pendingTurn = true;
  state.lastTurnEventSequence = null;
  state.lastTurnEventAt = Date.now();
  state.streamWasBackgrounded = false;
  state.status = 'Starting turn';
  state.statusTone = 'warn';
  const attachments = includeComposerAttachments ? readyComposerAttachments() : [];
  const optimisticUserEntry = {
    id: `local_user_${Date.now()}`,
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'pending',
    text,
    ...(attachments.length ? { attachments } : {}),
  };
  appendMessage(optimisticUserEntry);
  const promptToSend = text;
  clearPromptDraftForCurrentSession();
  renderChatAtLatest(() => {});

  const wasNewSession = !state.sessionId;
  let submittedSessionId = '';
  try {
    const sessionId = preferredSessionId || await ensureSession();
    submittedSessionId = sessionId;
    clearPromptDraftForCurrentSession();
    optimisticallyUpdateSessionInput(promptToSend);
    saveCurrentTimeline();
    const settings = collectSettings();
    const turn = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: {
        text: promptToSend,
        settings,
        ...(attachments.length
          ? {
              attachmentIds: attachments.map((attachment) => attachment.id),
              attachments,
            }
          : {}),
      },
    });
    if (attachments.length) {
      state.composerAttachments = [];
    }
    if (queuedMessageId) {
      removeQueuedMessage(sessionId, queuedMessageId);
    }
    if (turn?.type === 'command') {
      handleCommandResult(turn);
      return;
    }
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
    renderChatAtLatest(() => {});
    void streamTurnEvents(turn.turnId);
  } catch (error) {
    const failedQueuedSessionId = submittedSessionId || preferredSessionId || state.sessionId;
    if (queuedMessageId && failedQueuedSessionId) {
      setQueuedMessageSending(failedQueuedSessionId, queuedMessageId, false);
    }
    if (handleMissingSession(error, promptToSend)) {
      return;
    }
    if (handleTurnConflict(error, {
      promptText: promptToSend,
      optimisticEntryId: optimisticUserEntry.id,
      queuedMessageId,
      sessionId: submittedSessionId || preferredSessionId || state.sessionId,
    })) {
      return;
    }
    if (scheduleFirstTurnRecovery({
      error,
      promptText: promptToSend,
      sessionId: submittedSessionId || state.sessionId,
      wasNewSession,
    })) {
      return;
    }
    state.pendingTurn = false;
    surfaceTimelineError(state.turnId || `request_${Date.now()}`, error?.payload?.message || error?.message || 'Request failed');
    handleApiError(error, { suppressComposerError: true });
  }
}

function handleTurnConflict(error, {
  promptText,
  optimisticEntryId,
  queuedMessageId = '',
  sessionId = '',
} = {}) {
  if (error?.status !== 409 || error?.payload?.error !== 'turn_conflict') {
    return false;
  }
  removeTimelineEntryById(optimisticEntryId);
  const activeTurnId = String(error?.payload?.activeTurnId || '').trim();
  if (queuedMessageId && sessionId) {
    const stillQueued = queuedMessagesForSession(sessionId).some((message) => message.id === queuedMessageId);
    if (stillQueued) {
      setQueuedMessageSending(sessionId, queuedMessageId, false);
    } else {
      enqueueQueuedMessage(sessionId, promptText);
    }
    state.prompt = '';
  } else {
    state.prompt = promptText || state.prompt;
    savePromptDraftForCurrentSession();
  }
  state.pendingTurn = Boolean(activeTurnId);
  state.turnId = activeTurnId || state.turnId;
  state.status = activeTurnId ? 'Turn running' : 'Request blocked';
  state.statusTone = 'warn';
  state.error = '';
  renderChatAtLatestIfFollowing(() => {});
  if (activeTurnId) {
    void streamTurnEvents(activeTurnId, { forceReconnect: true });
  }
  return true;
}

function handleCommandResult(result) {
  stopStream();
  state.pendingTurn = false;
  state.turnId = null;
  state.lastTurnEventSequence = null;
  state.streamWasBackgrounded = false;
  state.lastTurnEventAt = 0;
  state.status = 'Ready';
  state.statusTone = 'success';
  state.error = '';
  if (result?.session && commandResultSessionHasTimeline(result)) {
    upsertSession(result.session);
    if (state.sessionId === result.session.id) {
      state.currentSession = state.sessions.find((session) => session.id === result.session.id) || result.session;
      state.cwd = result.session.cwd || state.cwd;
      hydrateCurrentTimelineFromSession(result.session);
    }
    saveCurrentTimeline();
    renderChatAtLatestIfFollowing(() => {});
    return;
  }
  const command = result?.command || {};
  const message = String(command.message || 'Command completed.');
  appendMessage({
    id: `command_${command.name || 'slash'}_${Date.now()}`,
    kind: 'message',
    role: 'system',
    label: command.name ? `/${command.name}` : 'Command',
    meta: command.action || 'completed',
    text: message,
  });
  saveCurrentTimeline();
  renderChatAtLatestIfFollowing(() => {});
}

function commandResultSessionHasTimeline(result) {
  const items = normalizeSessionTimeline(result?.session?.timeline);
  if (!items.length) {
    return false;
  }
  const commandName = String(result?.command?.name || '');
  const commandMessage = String(result?.command?.message || '').trim();
  return items.some((item) => item.role === 'system'
    && (!commandName || item.label === `/${commandName}`)
    && (!commandMessage || item.text === commandMessage));
}

async function ensureSession() {
  if (state.sessionId) {
    return state.sessionId;
  }
  state.status = 'Starting session';
  render();
  const projectId = currentNewProjectId();
  if (isMultiUserMode() && !projectId) {
    const error = new Error('No projects are available for this account.');
    error.status = 400;
    error.payload = {
      error: 'project_required',
      message: 'No projects are available for this account.',
    };
    throw error;
  }
  const body = isMultiUserMode()
    ? {
        projectId,
        settings: collectSettings(),
      }
    : {
        cwd: state.cwd.trim() || null,
        settings: collectSettings(),
      };
  const payload = await apiFetch('/api/sessions', {
    method: 'POST',
    body,
  });
  state.currentSession = payload.session;
  state.sessionId = payload.session.id;
  migrateDraftPromptToSession(payload.session.id);
  state.draftSessionActive = false;
  state.cwd = payload.session.cwd || state.cwd;
  upsertSession(payload.session);
  return state.sessionId;
}

function isAdminPrincipal() {
  return state.authSession?.principal?.isAdmin === true;
}

function isMultiUserMode() {
  return state.authSession?.principal?.mode === 'multi';
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
      state.draftSessionActive = false;
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

async function shareCurrentSession() {
  const sessionId = state.sessionId || state.currentSession?.id || '';
  if (!sessionId || state.draftSessionActive || isReadOnlySession(state.currentSession)) {
    return null;
  }
  try {
    state.status = 'Creating share link';
    state.statusTone = 'warn';
    render();
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/share`, {
      method: 'POST',
    });
    const shareUrl = absoluteShareUrl(payload?.shareUrl || '');
    if (!shareUrl) {
      throw new Error('Share link was not returned.');
    }
    const copied = await copyShareLink(shareUrl, { renderAfter: false });
    state.shareDialog = { url: shareUrl, copied };
    state.status = copied ? 'Share link copied' : 'Share link ready';
    state.statusTone = 'success';
    state.error = '';
    render();
    return shareUrl;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

async function copyShareLink(url, { renderAfter = true } = {}) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalizedUrl);
      return finalizeShareCopySuccess(normalizedUrl, { renderAfter });
    }
  } catch (_error) {
  }
  if (legacyCopyShareLink(normalizedUrl)) {
    return finalizeShareCopySuccess(normalizedUrl, { renderAfter });
  }
  state.status = 'Share link ready';
  state.statusTone = 'success';
  if (renderAfter) {
    render();
  }
  return false;
}

function legacyCopyShareLink(url) {
  const input = document.querySelector('#share-link-input');
  if (!input || typeof document.execCommand !== 'function') {
    return false;
  }
  try {
    input.focus?.();
    input.select?.();
    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(0, String(input.value || url).length);
    }
    return document.execCommand('copy') === true;
  } catch (_error) {
    return false;
  }
}

function finalizeShareCopySuccess(url, { renderAfter = true } = {}) {
  if (state.shareDialog?.url === url) {
    state.shareDialog = { ...state.shareDialog, copied: true };
  }
  state.status = 'Share link copied';
  state.statusTone = 'success';
  state.error = '';
  if (renderAfter) {
    render();
  }
  return true;
}

function absoluteShareUrl(shareUrl) {
  const value = String(shareUrl || '').trim();
  if (!value) {
    return '';
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    return value;
  }
  const origin = String(window.location?.origin || '').replace(/\/+$/u, '');
  if (origin && value.startsWith('/')) {
    return `${origin}${value}`;
  }
  if (origin) {
    return `${origin}/${value.replace(/^\/+/u, '')}`;
  }
  try {
    return new URL(value, window.location.origin || window.location.href).toString();
  } catch (_error) {
    return value;
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
  let sawTerminalEvent = false;
  let shouldReconcileQueuedCompletion = false;

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
    shouldReconcileQueuedCompletion = !sawTerminalEvent
      && !controller.signal.aborted
      && pendingQueuedMessagesForCurrentSession().length > 0;
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
    surfaceTimelineError(turnId, error?.payload?.message || error?.message || 'Stream failed');
    handleApiError(error, { suppressComposerError: true });
  } finally {
    if (state.streamAbortController === controller) {
      state.streamAbortController = null;
    }
    refreshChatDynamicUi();
  }

  if (shouldReconcileQueuedCompletion) {
    await reconcileQueuedCompletion(turnId);
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
      if (payload?.type === 'turn.completed' || payload?.type === 'turn.failed') {
        sawTerminalEvent = true;
      }
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
      const message = error instanceof Error ? error.message : String(error);
      surfaceTimelineError(turnId, message);
    }
    resetFrame();
  }

  function resetFrame() {
    eventName = 'message';
    eventId = '';
    dataLines = [];
  }
}

async function reconcileQueuedCompletion(turnId) {
  const sessionId = state.sessionId;
  if (!sessionId || state.turnId !== turnId) {
    return;
  }
  await refreshCurrentSessionMetadata({ hydrateTimeline: true });
  if (state.sessionId !== sessionId) {
    return;
  }
  if (!state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
    void sendNextQueuedMessage(sessionId);
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

async function reloadRuntime() {
  try {
    state.status = 'Reloading runtime';
    state.statusTone = 'warn';
    render();
    await apiFetch('/api/runtime/reload', { method: 'POST' });
    state.status = 'Runtime reloaded';
    state.statusTone = 'success';
    state.error = '';
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
      if (state.turnId !== event.turnId) {
        state.queuedInterruptRequestedTurnId = null;
        state.queuedInterruptEligibleTurnId = null;
      }
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
      state.queuedInterruptEligibleTurnId = event.turnId;
      upsertWorkBatch(event.turnId, event.batchId, {
        id: `batch_${event.batchId}`,
        batchId: event.batchId,
        batchKind: event.kind,
        title: event.title || 'Batch',
        status: 'started',
        summary: event.raw ? { raw: event.raw } : {},
      });
      break;
    case 'batch.updated':
      upsertWorkBatch(event.turnId, event.batchId, {
        summary: {
          ...(event.summary || {}),
          ...(event.raw ? { raw: event.raw } : {}),
        },
      });
      break;
    case 'batch.completed':
      upsertWorkBatch(event.turnId, event.batchId, {
        status: event.status || 'completed',
        summary: event.raw ? { raw: event.raw } : {},
      });
      void maybeInterruptRunningTurnForQueuedMessage();
      break;
    case 'approval.requested': {
      state.queuedInterruptEligibleTurnId = event.turnId;
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
        appendOrReplace(approval, (item) => item.id === approval.id);
      }
      state.status = 'Approval resolved';
      state.statusTone = 'warn';
      void maybeInterruptRunningTurnForQueuedMessage();
      break;
    }
    case 'turn.completed':
      state.pendingTurn = false;
      state.streamWasBackgrounded = false;
      state.queuedInterruptRequestedTurnId = null;
      state.queuedInterruptEligibleTurnId = null;
      {
        const completedSessionId = state.sessionId;
        const hasQueuedMessage = pendingQueuedMessagesForSession(completedSessionId).length > 0;
        if (hasQueuedMessage) {
          state.status = 'Starting turn';
          state.statusTone = 'warn';
          state.turnId = null;
          stopStream();
          void refreshCurrentSessionMetadata();
          void sendNextQueuedMessage(completedSessionId);
          break;
        }
      }
      {
        const runtimeStatus = runtimeStatusForTurnStatus(event.status);
        state.status = runtimeStatus.status;
        state.statusTone = runtimeStatus.tone;
      }
      state.turnId = null;
      stopStream();
      void refreshCurrentSessionMetadata();
      break;
    case 'turn.failed':
      state.pendingTurn = false;
      state.streamWasBackgrounded = false;
      state.queuedInterruptRequestedTurnId = null;
      state.queuedInterruptEligibleTurnId = null;
      state.status = 'Turn failed';
      state.statusTone = 'danger';
      state.turnId = null;
      stopStream();
      surfaceTimelineError(event.turnId, event.details || event.message || 'Turn failed');
      break;
  }
  saveCurrentTimeline();
  if (!state.pendingTurn && state.sessionId && pendingQueuedMessagesForCurrentSession().length && event.type !== 'turn.completed') {
    void sendNextQueuedMessage(state.sessionId);
  }
  refreshChatDynamicUi();
  scrollTimelineToBottomIfFollowingLatest();
  return assistantEntry;
}

function upsertWorkBatch(turnId, batchId, patch) {
  const current = state.batches.get(batchId)
    || {
      id: `batch_${batchId}`,
      kind: 'batch',
      turnId,
      batchId,
      batchKind: 'unknown',
      title: 'Batch',
      status: '',
      summary: {},
    };
  const next = {
    ...current,
    ...patch,
    turnId: current.turnId || turnId,
    summary: { ...current.summary, ...(patch.summary || {}) },
  };
  state.batches.set(batchId, next);
}

function upsertWorkApproval(_turnId, approval) {
  appendOrReplace(approval, (item) => item.id === approval.id);
}

function hasPendingWorkForTurn(turnId = state.turnId) {
  if (!turnId) {
    return false;
  }
  for (const batch of state.batches.values()) {
    if (batch?.turnId !== turnId) {
      continue;
    }
    const normalizedStatus = String(batch?.status || '').trim().toLowerCase();
    if (!normalizedStatus || normalizedStatus === 'started' || normalizedStatus === 'running' || normalizedStatus === 'pending') {
      return true;
    }
  }
  for (const approval of state.approvals.values()) {
    if (approval?.resolved !== false) {
      continue;
    }
    return true;
  }
  return false;
}

async function maybeInterruptRunningTurnForQueuedMessage() {
  const sessionId = state.sessionId;
  const turnId = state.turnId;
  if (!sessionId || !turnId || !state.pendingTurn) {
    return;
  }
  if (!pendingQueuedMessagesForSession(sessionId).length) {
    return;
  }
  if (state.queuedInterruptEligibleTurnId !== turnId) {
    return;
  }
  if (state.queuedInterruptRequestedTurnId && state.queuedInterruptRequestedTurnId !== turnId) {
    return;
  }
  if (hasPendingWorkForTurn(turnId)) {
    return;
  }
  state.queuedInterruptRequestedTurnId = turnId;
  try {
    await apiFetch(`/api/turns/${encodeURIComponent(turnId)}/interrupt`, { method: 'POST' });
    await refreshCurrentSessionMetadata({ hydrateTimeline: true });
    if (state.sessionId === sessionId && !state.pendingTurn && pendingQueuedMessagesForSession(sessionId).length > 0) {
      void sendNextQueuedMessage(sessionId);
    }
  } catch (error) {
    handleApiError(error);
  }
}

function setWorkStatus(turnId, status) {
  for (const batch of state.batches.values()) {
    if (batch?.turnId === turnId) {
      batch.status = status;
      state.batches.set(batch.batchId, batch);
    }
  }
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
  state.draftSessionActive = false;
  state.turnId = null;
  state.pendingTurn = false;
  state.timeline = [];
  resetSessionHistoryWindow();
  state.batches = new Map();
  state.approvals = new Map();
  if (promptToRestore) {
    state.prompt = promptToRestore;
    savePromptDraftForCurrentSession();
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

function isUnavailableSessionError(error) {
  const message = error?.payload?.message || error?.message || '';
  return /thread not loaded|no rollout found for thread id|rollout .* is empty/i.test(message);
}

function scheduleFirstTurnRecovery({
  error,
  promptText,
  sessionId,
  wasNewSession,
}) {
  if (!wasNewSession || !sessionId || !isUnavailableSessionError(error)) {
    return false;
  }
  const message = error?.payload?.message || error?.message || 'Request failed';
  state.pendingTurn = true;
  state.status = 'Waiting for first response';
  state.statusTone = 'warn';
  state.error = '';
  renderChatAtLatestIfFollowing(() => {});
  setTimeout(() => {
    void recoverFirstTurnAfterDelay({
      sessionId,
      promptText,
      message,
    });
  }, FIRST_TURN_RECOVERY_DELAY_MS);
  return true;
}

async function recoverFirstTurnAfterDelay({ sessionId, promptText, message }) {
  if (state.sessionId !== sessionId || !state.pendingTurn) {
    return;
  }
  const session = await refreshCurrentSessionMetadata({ hydrateTimeline: true });
  if (session && hasRecoveredFirstTurn(session, promptText)) {
    state.pendingTurn = false;
    state.streamWasBackgrounded = false;
    state.turnId = null;
    state.status = 'Ready';
    state.statusTone = 'success';
    state.error = '';
    renderChatAtLatest(() => {});
    return;
  }
  state.pendingTurn = false;
  state.status = 'Request failed';
  state.statusTone = 'danger';
  surfaceTimelineError(`request_${sessionId}`, message);
  renderChatAtLatest(() => {});
}

function hasRecoveredFirstTurn(session, promptText) {
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  if (turns.some((turn) => isActiveTurnStatus(turn?.status))) {
    const activeTurn = findActiveTurn(session);
    if (activeTurn?.id) {
      state.turnId = activeTurn.id;
    }
    return true;
  }
  const prompt = String(promptText || '').trim();
  for (const turn of turns) {
    if (!isTerminalTurnStatus(turn?.status)) {
      continue;
    }
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const hasPrompt = !prompt || items.some((item) => item?.role === 'user' && String(item.text || '').trim() === prompt);
    const hasAssistantAnswer = items.some((item) => item?.role === 'assistant' && String(item.text || '').trim());
    if (hasPrompt && hasAssistantAnswer) {
      return true;
    }
  }
  return false;
}

async function refreshCurrentSessionMetadata({ hydrateTimeline = false, viewportSnapshot = null } = {}) {
  if (!state.sessionId) {
    return null;
  }
  const sessionId = state.sessionId;
  const wasPendingTurn = state.pendingTurn;
  const hadQueuedMessages = pendingQueuedMessagesForSession(sessionId).length > 0;
  const snapshot = viewportSnapshot || (isDesktopWorkspaceView() ? latestTimelineViewportSnapshot() : captureTimelineViewport());
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
          syncRuntimeStatusFromSession(session);
        }
      }
      if (state.sessionId === sessionId) {
        nextTimelineRestoreSnapshot = snapshot;
      }
      if (state.sessionId === sessionId) {
        renderChatWithTimelineRestored(() => {});
        if (hydrateTimeline && state.view === 'chat') {
          scrollTimelineToBottomIfFollowingLatest();
        }
        nextTimelineRestoreSnapshot = null;
        if (hydrateTimeline && wasPendingTurn && hadQueuedMessages && !state.pendingTurn) {
          void sendNextQueuedMessage(sessionId);
        }
      } else {
        renderSessionListAfterBackgroundUpdate();
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

async function refreshSessionsList({
  renderAfter = true,
  scope = state.sortMode === 'favorites' ? 'favorites' : 'all',
  background = false,
} = {}) {
  const normalizedScope = scope === 'favorites' ? 'favorites' : 'all';
  if (background) {
    const payload = await apiFetch(normalizedScope === 'favorites' ? '/api/sessions?favorite=true' : '/api/sessions');
    const sessions = normalizeSessions(payload);
    state.sessionsByScope[normalizedScope] = sessions;
    state.sessionsLoadedByScope[normalizedScope] = true;
    return sessions;
  }
  const requestId = state.sessionsRequestId + 1;
  state.sessionsRequestId = requestId;
  state.sessionsLoading = true;
  state.sessionsLoadingScope = normalizedScope;
  state.sessionsScope = normalizedScope;
  state.sessions = normalizedScope === currentSessionScope()
    ? [...(state.sessionsByScope[normalizedScope] || [])]
    : [];
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch(normalizedScope === 'favorites' ? '/api/sessions?favorite=true' : '/api/sessions');
    const sessions = normalizeSessions(payload);
    state.sessionsByScope[normalizedScope] = sessions;
    state.sessionsLoadedByScope[normalizedScope] = true;
    if (requestId !== state.sessionsRequestId || normalizedScope !== currentSessionScope()) {
      return sessions;
    }
    state.sessions = [...sessions];
    state.sessionsScope = normalizedScope;
    syncCurrentSessionFromList();
    return state.sessions;
  } finally {
    if (requestId === state.sessionsRequestId) {
      state.sessionsLoading = false;
      state.sessionsLoadingScope = null;
    }
    if (renderAfter) {
      render();
    }
  }
}

async function refreshReportsList({ renderAfter = true } = {}) {
  const requestId = state.reportsRequestId + 1;
  state.reportsRequestId = requestId;
  state.reportsLoading = true;
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch('/api/reports');
    const reports = normalizeReports(payload);
    if (requestId !== state.reportsRequestId) {
      return reports;
    }
    state.reports = reports;
    state.reportsLoaded = true;
    return state.reports;
  } finally {
    if (requestId === state.reportsRequestId) {
      state.reportsLoading = false;
    }
    if (renderAfter) {
      render();
    }
  }
}

async function refreshProjectsList({ renderAfter = true } = {}) {
  try {
    const payload = await apiFetch('/api/projects');
    state.projects = normalizeProjects(payload);
    state.projectsLoaded = true;
    initializeNewProjectSelection();
    return state.projects;
  } finally {
    if (renderAfter) {
      render();
    }
  }
}

async function toggleProjectFavorite(projectId) {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) {
    return null;
  }
  const existing = state.projects.find((project) => project.id === normalizedId);
  if (!existing) {
    return null;
  }
  const previousFavorite = Boolean(existing.favorite);
  const nextFavorite = !previousFavorite;
  state.projects = state.projects.map((project) => (
    project.id === normalizedId ? { ...project, favorite: nextFavorite } : project
  ));
  render();
  try {
    const payload = await apiFetch(`/api/projects/${encodeURIComponent(normalizedId)}/favorite`, {
      method: 'PATCH',
      body: { favorite: nextFavorite },
    });
    const savedFavorite = typeof payload?.favorite === 'boolean' ? payload.favorite : nextFavorite;
    state.projects = state.projects.map((project) => (
      project.id === normalizedId ? { ...project, favorite: savedFavorite } : project
    ));
    return state.projects.find((project) => project.id === normalizedId) || null;
  } catch (error) {
    state.projects = state.projects.map((project) => (
      project.id === normalizedId ? { ...project, favorite: previousFavorite } : project
    ));
    handleApiError(error);
    return null;
  } finally {
    render();
  }
}

async function refreshAdminConsole({ renderAfter = true } = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  state.admin.loading = true;
  if (renderAfter) {
    render();
  }
  try {
    const [settingsPayload, projectsPayload, usersPayload, rolesPayload, sessionsPayload] = await Promise.all([
      apiFetch('/api/admin/settings'),
      apiFetch('/api/admin/projects'),
      apiFetch('/api/admin/users'),
      apiFetch('/api/admin/roles'),
      apiFetch(adminSessionsPath(state.admin.filterUserId, state.admin.filterProjectId)),
    ]);
    state.admin.settings = settingsPayload?.settings || null;
    state.admin.projects = normalizeAdminItems(projectsPayload);
    state.admin.users = normalizeAdminItems(usersPayload);
    state.admin.roles = normalizeAdminItems(rolesPayload);
    state.admin.sessions = normalizeAdminItems(sessionsPayload);
    state.admin.loaded = true;
    state.error = '';
    return state.admin;
  } catch (error) {
    handleApiError(error);
    return null;
  } finally {
    state.admin.loading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function refreshAdminSettings({ renderAfter = true } = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  try {
    const payload = await apiFetch('/api/admin/settings');
    state.admin.settings = payload?.settings || null;
    state.error = '';
    return state.admin.settings;
  } catch (error) {
    handleApiError(error);
    return null;
  } finally {
    if (renderAfter) {
      render();
    }
  }
}

async function refreshAdminSessions({
  userId = state.admin.filterUserId,
  projectId = state.admin.filterProjectId,
  renderAfter = true,
} = {}) {
  if (!isAdminPrincipal()) {
    return [];
  }
  state.admin.filterUserId = String(userId || '');
  state.admin.filterProjectId = String(projectId || '');
  state.admin.loading = true;
  if (renderAfter) {
    render();
  }
  try {
    const payload = await apiFetch(adminSessionsPath(state.admin.filterUserId, state.admin.filterProjectId));
    state.admin.sessions = normalizeAdminItems(payload);
    state.error = '';
    return state.admin.sessions;
  } catch (error) {
    handleApiError(error);
    return [];
  } finally {
    state.admin.loading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function updateAdminSettings(patch = {}) {
  if (!isAdminPrincipal()) {
    return null;
  }
  try {
    const payload = await apiFetch('/api/admin/settings', {
      method: 'PATCH',
      body: patch,
    });
    state.admin.settings = payload?.settings || state.admin.settings;
    state.error = '';
    render();
    return state.admin.settings;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

async function onAdminProjectSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const project = adminEditingProject();
  await saveAdminProject({
    id: String(project?.id || '').trim(),
    cwd: String(form.get('cwd') || '').trim(),
    displayName: String(form.get('displayName') || '').trim(),
    enabled: form.get('enabled') === 'on',
  });
}

async function onAdminRoleSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await saveAdminRole({
    id: String(form.get('id') || '').trim(),
    name: String(form.get('name') || '').trim(),
    isAdmin: form.get('isAdmin') === 'on',
    projectIds: form.getAll('projectIds').map((value) => String(value || '').trim()).filter(Boolean),
  });
}

async function onAdminUserSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await saveAdminUser({
    id: String(form.get('id') || '').trim(),
    username: String(form.get('username') || '').trim(),
    password: String(form.get('password') || ''),
    enabled: form.get('enabled') === 'on',
    roleId: String(form.get('roleId') || '').trim(),
  });
}

async function onAdminUserAccessSubmit(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  await saveAdminUserAccess({
    id: formElement.getAttribute('data-admin-user-id') || '',
    enabled: form.get('enabled') === 'on',
    roleId: String(form.get('userRoleId') || '').trim(),
  });
}

async function saveAdminProject(project) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const cwd = String(project.cwd || '').trim();
  const id = String(project.id || '').trim() || cwd;
  try {
    const payload = await apiFetch('/api/admin/projects', {
      method: 'POST',
      body: {
        id,
        cwd,
        displayName: String(project.displayName || '').trim(),
        enabled: project.enabled !== false,
      },
    });
    state.error = '';
    state.admin.editingProjectId = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.project || null;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

async function saveAdminRole(role) {
  if (!isAdminPrincipal()) {
    return null;
  }
  try {
    const payload = await apiFetch('/api/admin/roles', {
      method: 'POST',
      body: {
        id: String(role.id || '').trim(),
        name: String(role.name || '').trim(),
        isAdmin: role.isAdmin === true,
        projectIds: Array.isArray(role.projectIds) ? role.projectIds : [],
        projectGrants: projectGrantsFromProjectIds(role.projectIds),
      },
    });
    state.error = '';
    state.admin.editingRoleId = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.role || null;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

async function saveAdminUser(user) {
  if (!isAdminPrincipal()) {
    return null;
  }
  try {
    const roleId = String(user.roleId || '').trim();
    const body = {
      id: String(user.id || '').trim(),
      username: String(user.username || '').trim(),
      password: String(user.password || ''),
      enabled: user.enabled !== false,
      roleId,
      roleIds: roleId
        ? [roleId]
        : Array.isArray(user.roleIds) ? user.roleIds.slice(0, 1) : [],
    };
    const payload = await apiFetch('/api/admin/users', {
      method: 'POST',
      body,
    });
    state.error = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.user || null;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

async function saveAdminUserAccess(user) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const userId = String(user.id || '').trim();
  if (!userId) {
    return null;
  }
  const roleId = String(user.roleId || '').trim();
  try {
    const body = {
      enabled: user.enabled !== false,
      roleId,
      roleIds: roleId ? [roleId] : [],
    };
    const payload = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body,
    });
    state.error = '';
    await refreshAdminConsole({ renderAfter: true });
    return payload?.user || null;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

async function toggleAdminUserEnabled(userId, enabled) {
  const user = adminUserById(userId);
  if (!user) {
    return null;
  }
  return saveAdminUserAccess({
    id: user.id,
    enabled: enabled === true,
    roleId: adminUserRoleId(user),
  });
}

async function deleteAdminUser(userId) {
  if (!isAdminPrincipal()) {
    return null;
  }
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return null;
  }
  try {
    await apiFetch(`/api/admin/users/${encodeURIComponent(normalizedUserId)}`, {
      method: 'DELETE',
    });
    state.error = '';
    await refreshAdminConsole({ renderAfter: true });
    return true;
  } catch (error) {
    handleApiError(error);
    return null;
  }
}

function projectGrantsFromProjectIds(projectIds) {
  const uniqueIds = [...new Set((Array.isArray(projectIds) ? projectIds : [])
    .map((projectId) => String(projectId || '').trim())
    .filter(Boolean))];
  return uniqueIds.map((projectId) => ({
    projectId,
    canRead: true,
    canCreate: true,
    canWrite: true,
  }));
}

async function openAdminObservedSession(sessionId) {
  if (!sessionId || !isAdminPrincipal()) {
    return;
  }
  saveCurrentTimeline();
  stopStream();
  state.status = 'Loading session';
  state.statusTone = 'warn';
  state.error = '';
  render();
  try {
    const payload = await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`);
    const session = {
      ...(payload?.session || {}),
      mode: payload?.mode || payload?.session?.mode || 'observer',
      readOnly: true,
    };
    state.sessionId = session.id;
    state.currentSession = session;
    state.cwd = session.cwd || '';
    applySessionSettings(session);
    restoreTimelineForSession(session);
    syncRuntimeStatusFromSession(session);
    state.view = 'chat';
    state.status = 'Ready';
    state.statusTone = 'success';
    render();
    scrollTimelineToBottom();
  } catch (error) {
    handleApiError(error);
  }
}

async function openReportById(reportId, { returnView = state.view } = {}) {
  if (!reportId) {
    return;
  }
  const normalizedReturnView = normalizeReportReturnView(returnView);
  const reportReturnSnapshot = normalizedReturnView === 'chat' ? captureTimelineViewport() : null;
  if (reportReturnSnapshot && !chatTimelineReturnSnapshot) {
    chatTimelineReturnSnapshot = reportReturnSnapshot;
  }
  state.reportReturnView = normalizedReturnView;
  state.view = 'report';
  state.currentReport = state.reports.find((report) => report.id === reportId) || {
    id: reportId,
    title: reportTitleFromId(reportId),
    kind: reportKindFromId(reportId),
    project: reportProjectFromId(reportId),
  };
  state.currentReportContent = '';
  state.currentReportLoading = true;
  state.error = '';
  render();
  try {
    const payload = await apiFetch(`/api/reports/${encodeURIComponent(reportId)}/content`);
    state.currentReport = payload.report;
    state.currentReportContent = payload.content || '';
    state.currentReportLoading = false;
    upsertReport(payload.report);
    renderReportWithScrollPreserved(() => {});
  } catch (error) {
    state.currentReportLoading = false;
    handleApiError(error);
  }
}

function normalizeReportReturnView(returnView) {
  if (returnView === 'chat' && state.sessionId) {
    return 'chat';
  }
  if (returnView === 'reports' && state.reportsReturnView === 'chat' && state.sessionId) {
    return 'chat';
  }
  return 'reports';
}

async function openReportByPath(reportPath, { returnView = 'chat' } = {}) {
  if (!reportPath) {
    return;
  }
  const normalizedReturnView = normalizeReportReturnView(returnView);
  if (normalizedReturnView === 'chat' && !chatTimelineReturnSnapshot) {
    chatTimelineReturnSnapshot = captureTimelineViewport();
  }
  state.reportReturnView = normalizedReturnView;
  state.view = 'report';
  state.currentReport = reportFromPath(reportPath);
  state.currentReportContent = '';
  state.currentReportLoading = true;
  state.error = '';
  render();
  try {
    const payload = await apiFetch('/api/reports/resolve', {
      method: 'POST',
      body: { path: reportPath },
    });
    if (payload?.report) {
      upsertReport(payload.report);
      await openReportById(payload.report.id, { returnView: normalizedReturnView });
    }
  } catch (error) {
    state.currentReportLoading = false;
    handleApiError(error);
  }
}

async function toggleReportFavorite(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    return;
  }
  const favorite = report.favorite !== true;
  try {
    const payload = await apiFetch(`/api/reports/${encodeURIComponent(reportId)}/favorite`, {
      method: 'PATCH',
      body: { favorite },
    });
    if (payload?.report) {
      upsertReport(payload.report);
      if (state.currentReport?.id === payload.report.id) {
        state.currentReport = payload.report;
      }
    }
    state.status = favorite ? 'Report favorited' : 'Favorite removed';
    state.statusTone = 'success';
    state.error = '';
    renderReportWithScrollPreserved(() => {});
  } catch (error) {
    handleApiError(error);
  }
}

function closeReportViewer() {
  const returnView = state.reportReturnView;
  state.currentReport = null;
  state.currentReportContent = '';
  state.currentReportLoading = false;
  state.view = returnView === 'chat' && state.sessionId ? 'chat' : 'reports';
  if (state.view !== 'reports') {
    state.reportProject = '';
  }
  render();
  if (state.view === 'chat') {
    restoreTimelineViewport(chatTimelineReturnSnapshot);
    chatTimelineReturnSnapshot = null;
  }
}

async function setSessionSortMode(mode) {
  const nextMode = mode === 'time' ? 'time' : 'favorites';
  state.sortMode = nextMode;
  const scope = currentSessionScope();
  const cached = state.sessionsByScope[scope] || [];
  const isLoaded = state.sessionsLoadedByScope[scope] === true;
  state.sessions = isLoaded ? [...cached] : [];
  state.sessionsScope = scope;
  if (nextMode === 'time' && !isLoaded) {
    await refreshSessionsList({ renderAfter: true, scope: 'all' });
    return;
  }
  if (nextMode === 'favorites' && !isLoaded) {
    await refreshSessionsList({ renderAfter: true, scope: 'favorites' });
    return;
  }
  render();
}

function preloadAllSessionsInBackground() {
  if (!state.token || state.sessionsLoadedByScope.all === true || allSessionsPreloadPromise) {
    return allSessionsPreloadPromise;
  }
  allSessionsPreloadPromise = refreshSessionsList({ renderAfter: false, scope: 'all', background: true })
    .catch((error) => {
      console.warn('[codex-web] all sessions preload failed', error);
      return null;
    })
    .finally(() => {
      allSessionsPreloadPromise = null;
    });
  return allSessionsPreloadPromise;
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
      rememberSessionListScroll();
      await refreshSessionsList({
        renderAfter: false,
        scope: state.sortMode === 'favorites' ? 'favorites' : 'all',
      });
      render();
    }
    if (!state.pendingTurn && !isRuntimeStatusLabel(state.status)) {
      state.status = 'Ready';
      state.statusTone = 'success';
      render();
    }
  } catch (error) {
    handleApiError(error);
  }
}

async function handleComposerRefresh() {
  if (!state.sessionId) {
    return;
  }
  const wasPending = state.pendingTurn;
  if (!wasPending) {
    state.status = 'Refreshing';
    state.statusTone = 'warn';
    render();
  }
  state.timelineShouldFollowLatest = true;
  try {
    await refreshCurrentSessionMetadata({
      hydrateTimeline: true,
      viewportSnapshot: {
        bottomOffset: 0,
        shouldFollowLatest: true,
        hadPromptFocus: document.activeElement === document.querySelector('#prompt-input'),
      },
    });
    if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
      streamTurnEvents(state.turnId, { forceReconnect: true });
    }
    if (!state.pendingTurn && !isRuntimeStatusLabel(state.status)) {
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
  const currentDisplay = timelineMessageDisplaySignature(state.timeline);
  const hydratedDisplay = timelineMessageDisplaySignature(visibleHydrated);
  const sameMessageText = hydratedText === currentText;
  const sameMessageDisplay = sameMessageText && hydratedDisplay === currentDisplay;
  if (!hydratedText || sameMessageDisplay || (!sameMessageText && currentText.includes(hydratedText))) {
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

function timelineMessageDisplaySignature(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'message')
    .map((item) => {
      const attachments = normalizeTimelineAttachments(item.attachments)
        .map((attachment) => [
          attachment.kind || '',
          attachment.localPath || '',
          attachment.fileName || '',
          attachment.mimeType || '',
          typeof attachment.sizeBytes === 'number' ? attachment.sizeBytes : '',
        ].join(':'))
        .join('|');
      return [
        item.role || '',
        item.text || '',
        item.meta || '',
        item.severity || '',
        attachments,
      ].join('\u0000');
    })
    .join('\n');
}

function syncRuntimeStatusFromSession(session, { source = 'detail' } = {}) {
  const turns = sessionTurns(session);
  const activeTurn = findActiveTurn(session);
  if (!activeTurn?.id) {
    const latestTurn = latestRuntimeTurn(turns);
    if (!latestTurn) {
      if (source === 'detail') {
        clearRuntimeTurnState();
        return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: null });
      }
      return { changed: false, activeTurnId: null, terminalTurnId: null };
    }
    const normalizedStatus = normalizeTurnStatus(latestTurn.status);
    if (isSuccessTurnStatus(normalizedStatus)) {
      clearRuntimeTurnState();
      return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
    }
    if (isFailureTurnStatus(normalizedStatus)) {
      clearRuntimeTurnState();
      const message = surfaceRuntimeTurnErrorFromSession(session, latestTurn);
      return setRuntimeStatus('Turn failed', 'danger', { activeTurnId: null, terminalTurnId: latestTurn.id || null, errorMessage: message });
    }
    if (isInterruptedTurnStatus(normalizedStatus)) {
      clearRuntimeTurnState();
      return setRuntimeStatus('Turn stopped', 'warn', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
    }
    clearRuntimeTurnState();
    return setRuntimeStatus('Ready', 'success', { activeTurnId: null, terminalTurnId: latestTurn.id || null });
  }
  state.pendingTurn = true;
  state.turnId = activeTurn.id;
  state.streamWasBackgrounded = true;
  state.lastTurnEventAt = 0;
  return setRuntimeStatus('Turn running', 'warn', { activeTurnId: activeTurn.id, terminalTurnId: null });
}

function clearRuntimeTurnState() {
  if (state.pendingTurn || state.turnId) {
    stopStream();
  }
  state.pendingTurn = false;
  state.turnId = null;
  state.streamWasBackgrounded = false;
  state.lastTurnEventAt = 0;
}

function setRuntimeStatus(status, tone, result) {
  const previousStatus = state.status;
  const previousTone = state.statusTone;
  const canReplace = isRuntimeStatusLabel(previousStatus) || NON_RUNTIME_STATUS_LABELS.has(previousStatus);
  if (canReplace) {
    state.status = status;
    state.statusTone = tone;
  }
  return {
    changed: previousStatus !== state.status || previousTone !== state.statusTone || Boolean(result.activeTurnId || result.terminalTurnId),
    ...result,
  };
}

function isRuntimeStatusLabel(status) {
  const value = String(status || '');
  return value === 'Ready'
    || value === 'Turn running'
    || value === 'Stream paused'
    || value === 'Turn failed'
    || value === 'Turn interrupted'
    || value === 'Turn stopped'
    || /^Turn /u.test(value);
}

function runtimeStatusForTurnStatus(status) {
  if (isSuccessTurnStatus(status)) {
    return { status: 'Ready', tone: 'success' };
  }
  if (isFailureTurnStatus(status)) {
    return { status: 'Turn failed', tone: 'danger' };
  }
  if (isInterruptedTurnStatus(status)) {
    return { status: 'Turn stopped', tone: 'warn' };
  }
  return { status: `Turn ${status || 'completed'}`, tone: 'warn' };
}

function surfaceRuntimeTurnErrorFromSession(session, turn) {
  const message = runtimeTurnErrorMessage(turn);
  if (state.view === 'chat' && state.sessionId === session?.id) {
    surfaceTimelineError(turn?.id || `session_${session?.id || 'unknown'}_failed`, message);
    saveCurrentTimeline();
  }
  return message;
}

function runtimeTurnErrorMessage(turn) {
  return normalizeRuntimeErrorText(turn?.details)
    || normalizeRuntimeErrorText(turn?.error)
    || normalizeRuntimeErrorText(turn?.message)
    || runtimeTurnItemErrorMessage(turn)
    || 'Turn failed';
}

function runtimeTurnItemErrorMessage(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const marker = [
      item?.type,
      item?.phase,
      item?.status,
      item?.severity,
      item?.raw?.type,
      item?.raw?.status,
    ].map((value) => String(value || '').toLowerCase()).join(' ');
    const hasErrorMarker = /error|fail|denied|unauthorized|forbidden|rate[_\s-]*limit/u.test(marker);
    const candidate = normalizeRuntimeErrorText(item?.details)
      || normalizeRuntimeErrorText(item?.error)
      || normalizeRuntimeErrorText(item?.message)
      || normalizeRuntimeErrorText(item?.result)
      || normalizeRuntimeErrorText(item?.raw?.details)
      || normalizeRuntimeErrorText(item?.raw?.message)
      || normalizeRuntimeErrorText(item?.raw?.error);
    if (candidate && (hasErrorMarker || /unexpected status|unauthorized|forbidden|too many requests|rate limit|error|failed|failure|401|403|429/u.test(candidate.toLowerCase()))) {
      return candidate;
    }
    const text = normalizeRuntimeErrorText(item?.text);
    if (text && hasErrorMarker) {
      return text;
    }
  }
  return null;
}

function normalizeRuntimeErrorText(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value;
  return normalizeRuntimeErrorText(record.details)
    || normalizeRuntimeErrorText(record.rawMessage)
    || normalizeRuntimeErrorText(record.errorMessage)
    || normalizeRuntimeErrorText(record.message)
    || normalizeRuntimeErrorText(record.error)
    || normalizeRuntimeErrorText(record.stderr)
    || normalizeRuntimeErrorText(record.stack)
    || null;
}

function sessionTurns(session) {
  return Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
}

function latestRuntimeTurn(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.id || turn?.status) {
      return turn;
    }
  }
  return null;
}

function findActiveTurn(session) {
  const activeTurnId = String(session?.activeTurnId || '').trim();
  if (!activeTurnId) {
    return null;
  }
  const turns = sessionTurns(session);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.id === activeTurnId && isActiveTurnStatus(turn.status)) {
      return turn;
    }
  }
  return { id: activeTurnId, status: 'in_progress' };
}

function isActiveTurnStatus(status) {
  const value = normalizeTurnStatus(status);
  if (!value) {
    return false;
  }
  return !isTerminalTurnStatus(value);
}

function isTerminalTurnStatus(status) {
  return isSuccessTurnStatus(status) || isFailureTurnStatus(status) || isInterruptedTurnStatus(status);
}

function isSuccessTurnStatus(status) {
  return ['completed', 'complete', 'succeeded', 'success', 'finished'].includes(normalizeTurnStatus(status));
}

function isFailureTurnStatus(status) {
  return ['failed', 'error', 'timedout', 'timeout'].includes(normalizeTurnStatus(status));
}

function isInterruptedTurnStatus(status) {
  return ['cancelled', 'canceled', 'interrupted', 'aborted'].includes(normalizeTurnStatus(status));
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
  for (const scope of Object.keys(state.sessionsByScope)) {
    state.sessionsByScope[scope] = (state.sessionsByScope[scope] || []).filter((session) => session.id !== sessionId);
  }
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
    .map((session) => {
      const normalized = {
        ...session,
        cwd: typeof session.cwd === 'string' ? session.cwd : '',
        projectName: typeof session.projectName === 'string' ? cwdLeafName(session.projectName) : '',
        title: typeof session.title === 'string' ? session.title : '',
        preview: typeof session.preview === 'string' ? session.preview : '',
        firstUserInput: typeof session.firstUserInput === 'string' ? session.firstUserInput : '',
        lastUserInput: typeof session.lastUserInput === 'string' ? session.lastUserInput : '',
        lastInputAt: typeof session.lastInputAt === 'number' ? session.lastInputAt : null,
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : null,
        settings: session.settings && typeof session.settings === 'object' ? session.settings : null,
      };
      if (typeof session.projectId === 'string') {
        normalized.projectId = session.projectId;
      }
      if (typeof session.projectDisplayName === 'string') {
        normalized.projectDisplayName = cwdLeafName(session.projectDisplayName);
      }
      if (typeof session.ownerUserId === 'string') {
        normalized.ownerUserId = session.ownerUserId;
      }
      if (typeof session.mode === 'string') {
        normalized.mode = session.mode;
      }
      if (session.readOnly === true) {
        normalized.readOnly = true;
      }
      if (Object.prototype.hasOwnProperty.call(session, 'goal')) {
        normalized.goal = session.goal && typeof session.goal === 'object' ? session.goal : null;
      }
      return normalized;
    });
}

function normalizeProjects(payload) {
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((project) => {
      const id = typeof project?.id === 'string' ? project.id.trim() : '';
      const cwd = typeof project?.cwd === 'string' ? project.cwd.trim() : '';
      const displayName = typeof project?.displayName === 'string' && project.displayName.trim()
        ? cwdLeafName(project.displayName.trim())
        : cwdLeafName(cwd) || id;
      if (!id || !displayName) {
        return null;
      }
      return {
        ...project,
        id,
        displayName,
        favorite: project?.favorite === true,
      };
    })
    .filter(Boolean);
}

function normalizeAdminItems(payload) {
  return Array.isArray(payload?.items) ? payload.items.filter((item) => item && typeof item === 'object') : [];
}

function syncCurrentSessionFromList() {
  if (!state.sessionId) {
    return;
  }
  const session = state.sessions.find((item) => item.id === state.sessionId);
  if (!session) {
    state.sessionId = null;
    state.currentSession = null;
    state.draftSessionActive = false;
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
  upsertSessionInScope('all', next);
  if (isFavoriteSession(next)) {
    upsertSessionInScope('favorites', next);
  } else {
    removeSessionFromScope('favorites', next.id);
  }
  if (state.sessionId === next.id) {
    state.currentSession = next;
  }
}

function currentSessionScope() {
  return state.sortMode === 'favorites' ? 'favorites' : 'all';
}

function upsertSessionInScope(scope, session) {
  const list = state.sessionsByScope[scope] || [];
  const index = list.findIndex((item) => item.id === session.id);
  const next = mergeSessionSummary(index >= 0 ? list[index] : null, session);
  if (index >= 0) {
    list[index] = next;
  } else {
    list.unshift(next);
  }
  state.sessionsByScope[scope] = list;
}

function removeSessionFromScope(scope, sessionId) {
  state.sessionsByScope[scope] = (state.sessionsByScope[scope] || []).filter((session) => session.id !== sessionId);
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
    state.batches = new Map(cached.batches);
    state.approvals = new Map(cached.approvals);
    if (fullHistory.length) {
      const currentStart = visibleStartIndexForTimeline(fullHistory, cached.timeline);
      setSessionHistoryWindow(fullHistory, currentStart);
      state.timeline = state.sessionHistoryItems.slice(currentStart).map((item) => ({ ...item }));
    } else {
      state.timeline = cached.timeline.map((item) => ({ ...item }));
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

function loadQueuedMessages() {
  const queue = new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUED_MESSAGES_KEY) || '{"sessions":[]}');
    const sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : [];
    for (const session of sessions) {
      const sessionId = typeof session?.sessionId === 'string' ? session.sessionId : '';
      const messages = Array.isArray(session?.messages)
        ? session.messages
          .map((message) => normalizeQueuedMessage(message))
          .filter(Boolean)
          .slice(0, 20)
        : [];
      if (sessionId && messages.length) {
        queue.set(sessionId, messages);
      }
    }
  } catch (_error) {
    localStorage.removeItem(QUEUED_MESSAGES_KEY);
  }
  return queue;
}

function persistQueuedMessages() {
  const sessions = [...state.queuedMessages.entries()]
    .map(([sessionId, messages]) => ({
      sessionId,
      messages: (Array.isArray(messages) ? messages : []).map((message) => normalizeQueuedMessage(message)).filter(Boolean).slice(0, 20),
    }))
    .filter((entry) => entry.sessionId && entry.messages.length)
    .slice(-50);
  try {
    localStorage.setItem(QUEUED_MESSAGES_KEY, JSON.stringify({ sessions }));
  } catch (error) {
    console.warn('[codex-web] queued messages persist failed', error);
  }
}

function normalizeQueuedMessage(message) {
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!text) {
    return null;
  }
  const id = typeof message?.id === 'string' && message.id
    ? message.id
    : `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = typeof message?.createdAt === 'string' && message.createdAt
    ? message.createdAt
    : new Date().toISOString();
  return {
    id,
    text: text.slice(0, 12000),
    createdAt,
  };
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
  const storedTimeline = normalizeSessionTimeline(session?.timeline);
  if (storedTimeline.length) {
    return storedTimeline;
  }
  const items = [];
  const turns = Array.isArray(session.thread?.turns) ? session.thread.turns : [];
  for (const turn of turns) {
    for (const item of turn.items || []) {
      const role = timelineRoleForThreadItem(item);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!role || !text) {
        continue;
      }
      const normalized = normalizeSessionTimelineItem({
        id: `history_${turn.id}_${items.length}`,
        kind: 'message',
        role,
        label: role === 'user' ? 'You' : 'Assistant',
        meta: 'history',
        text,
      });
      if (normalized) {
        items.push(normalized);
      }
    }
    if (isFailureTurnStatus(turn?.status)) {
      const text = runtimeTurnErrorMessage(turn);
      items.push({
        id: `error_${turn?.id || `history_failed_${items.length}`}`,
        kind: 'message',
        role: 'system',
        severity: 'error',
        label: 'Error',
        meta: 'failed',
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

function normalizeSessionTimeline(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeSessionTimelineItem(item))
    .filter(Boolean);
}

function normalizeSessionTimelineItem(item) {
  if (!item || item.kind !== 'message') {
    return null;
  }
  const role = item.role === 'user' || item.role === 'assistant' || item.role === 'system'
    ? item.role
    : null;
  const display = normalizeTimelineMessageDisplay(role, item.text, item.attachments);
  if (!role || (!display.text && !display.attachments.length)) {
    return null;
  }
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `timeline_${role}_${display.text.slice(0, 24)}`,
    kind: 'message',
    role,
    label: typeof item.label === 'string' && item.label ? item.label : role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System',
    meta: typeof item.meta === 'string' ? item.meta : '',
    text: display.text,
    ...(display.attachments.length ? { attachments: display.attachments } : {}),
    severity: item.severity === 'error' ? 'error' : undefined,
  };
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
  const startIndex = completeExchangeStarts.length < MIN_HYDRATED_COMPLETE_EXCHANGES
    ? 0
    : completeExchangeStarts[completeExchangeStarts.length - MIN_HYDRATED_COMPLETE_EXCHANGES];
  return includeAdjacentSystemTimelineItems(items, startIndex);
}

function includeAdjacentSystemTimelineItems(items, startIndex) {
  let index = Math.max(0, Number.isFinite(startIndex) ? Math.floor(startIndex) : 0);
  while (index > 0 && isStandaloneSystemTimelineItem(items[index - 1])) {
    index -= 1;
  }
  return index;
}

function isStandaloneSystemTimelineItem(item) {
  return item?.kind === 'message' && item?.role === 'system';
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
  if ((!isDesktopWorkspaceView() && state.view !== 'chat') || !state.sessionId) {
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
  if (state.sortMode === 'favorites') {
    return sortedFavoriteSessions();
  }
  return sessions.sort((left, right) => lastInputAtForSession(right) - lastInputAtForSession(left));
}

function filteredSessions() {
  const sessions = projectScopedSessions();
  if (state.sortMode === 'favorites') {
    return sessions.filter(isFavoriteSession);
  }
  return sessions;
}

function sortedFavoriteSessions() {
  return projectScopedSessions()
    .filter(isFavoriteSession)
    .sort((left, right) => lastInputAtForSession(right) - lastInputAtForSession(left));
}

function projectScopedSessions() {
  const selectedKey = String(state.selectedProjectKey || '').trim();
  if (!selectedKey) {
    return [...state.sessions];
  }
  return state.sessions.filter((session) => sessionProjectScope(session).key === selectedKey);
}

function currentProjectScopeTitle() {
  return String(state.selectedProjectLabel || '').trim() || 'All Sessions';
}

function workspaceProjects() {
  const items = new Map();
  for (const project of Array.isArray(state.projects) ? state.projects : []) {
    const id = String(project?.id || '').trim();
    if (!id) {
      continue;
    }
    items.set(id, {
      key: id,
      id,
      label: projectVisibleName(project, id),
      defaultCwd: typeof project?.cwd === 'string' ? project.cwd : '',
      sessionCount: 0,
      latestAt: 0,
      canCreate: project?.canCreate !== false,
      favorite: project?.favorite === true,
      source: 'managed',
    });
  }
  for (const session of state.sessions) {
    const scope = sessionProjectScope(session);
    if (!scope.key) {
      continue;
    }
    const existing = items.get(scope.key) || {
      key: scope.key,
      id: scope.id,
      label: scope.label,
      defaultCwd: scope.defaultCwd,
      sessionCount: 0,
      latestAt: 0,
      canCreate: Boolean(scope.id),
      favorite: false,
      source: scope.id ? 'managed' : 'legacy',
    };
    existing.label = existing.label || scope.label;
    existing.defaultCwd = existing.defaultCwd || scope.defaultCwd;
    existing.sessionCount += 1;
    existing.latestAt = Math.max(existing.latestAt || 0, scope.latestAt || 0);
    if (!existing.id && scope.id) {
      existing.id = scope.id;
    }
    items.set(scope.key, existing);
  }
  return [...items.values()].sort((left, right) => {
    if (Boolean(right.favorite) !== Boolean(left.favorite)) {
      return Number(Boolean(right.favorite)) - Number(Boolean(left.favorite));
    }
    if (right.sessionCount !== left.sessionCount) {
      return right.sessionCount - left.sessionCount;
    }
    if ((right.latestAt || 0) !== (left.latestAt || 0)) {
      return (right.latestAt || 0) - (left.latestAt || 0);
    }
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
}

function currentSelectedProject() {
  const selectedKey = String(state.selectedProjectKey || '').trim();
  if (!selectedKey) {
    return {
      key: '',
      id: '',
      label: 'All Sessions',
      defaultCwd: '',
      sessionCount: state.sessions.length,
      latestAt: 0,
      canCreate: true,
      favorite: false,
      source: 'all',
    };
  }
  const match = workspaceProjects().find((project) => project.key === selectedKey);
  if (match) {
    if (state.selectedProjectId !== match.id || state.selectedProjectLabel !== match.label) {
      state.selectedProjectId = match.id || '';
      state.selectedProjectLabel = match.label || '';
    }
    return match;
  }
  state.selectedProjectKey = '';
  state.selectedProjectId = '';
  state.selectedProjectLabel = '';
  return currentSelectedProject();
}

function sessionProjectScope(session) {
  const projectId = String(session?.projectId || '').trim();
  const displayName = cwdLeafName(session?.projectDisplayName || '');
  const cwdName = cwdLeafName(session?.cwd || '');
  const projectName = cwdLeafName(session?.projectName || '');
  const legacyLabel = displayName || cwdName || projectName || String(session?.title || '').trim() || 'Untitled Project';
  if (projectId) {
    return {
      key: projectId,
      id: projectId,
      label: displayName || legacyLabel || projectId,
      defaultCwd: typeof session?.cwd === 'string' ? session.cwd : '',
      latestAt: lastInputAtForSession(session),
    };
  }
  const cwd = String(session?.cwd || '').trim();
  const key = cwd ? `cwd:${cwd}` : `legacy:${legacyLabel.toLowerCase()}`;
  return {
    key,
    id: '',
    label: legacyLabel,
    defaultCwd: cwd,
    latestAt: lastInputAtForSession(session),
  };
}

function renderWorkspaceProjectList() {
  const currentKey = String(currentSelectedProject().key || '');
  const entries = [
    {
      key: '',
      id: '',
      label: 'All Sessions',
      sessionCount: state.sessions.length,
      favorite: false,
      source: 'all',
    },
    ...workspaceProjects(),
  ];
  return entries.map((project) => {
    const isActive = project.key === currentKey;
    const count = project.sessionCount ? String(project.sessionCount) : project.source === 'all' ? String(state.sessions.length) : '0';
    const canFavorite = project.source !== 'all' && Boolean(project.id);
    const favorite = Boolean(project.favorite);
    const favoriteLabel = `${favorite ? 'Unfavorite' : 'Favorite'} ${project.label}`;
    return `
    <div class="project-rail-item${canFavorite ? ' has-favorite-control' : ''}${isActive ? ' is-active' : ''}${favorite ? ' is-favorite' : ''}">
      <button class="project-rail-select-button" type="button" data-project-scope-key="${escapeAttribute(project.key)}" aria-pressed="${String(isActive)}">
        <span class="project-rail-item-main">${escapeHtml(project.label)}</span>
        <span class="project-rail-item-meta">${escapeHtml(count)}</span>
      </button>
      ${canFavorite ? `<button class="project-rail-favorite-button${favorite ? ' is-favorite' : ''}" type="button" data-project-favorite-id="${escapeAttribute(project.id)}" aria-pressed="${String(favorite)}" aria-label="${escapeAttribute(favoriteLabel)}" title="${escapeAttribute(favoriteLabel)}">${favorite ? '★' : '☆'}</button>` : ''}
    </div>
  `;
  }).join('');
}

function renderWorkspaceRailActions({ mobile = false } = {}) {
  const showAdmin = isAdminPrincipal();
  const settingsActive = state.view === 'settings' || state.desktopSettingsOpen;
  const reportsActive = state.view === 'reports' || state.desktopOverlay === 'reports';
  const newActive = state.view === 'new';
  if (mobile) {
    return `
    <button class="project-rail-action${reportsActive ? ' is-active' : ''}" type="button" id="open-reports-button">Reports</button>
    <button class="project-rail-action${newActive ? ' is-active' : ''}" type="button" id="open-new-session-button">New</button>
    <button class="project-rail-action${settingsActive ? ' is-active' : ''}" type="button" id="open-app-settings-button">Setting</button>
    ${showAdmin ? '<button class="project-rail-action project-rail-admin-action" type="button" id="open-admin-console-button">Admin Console</button>' : ''}
  `;
  }
  const sessionsActive = !settingsActive && state.view !== 'new';
  return `
    <button class="project-rail-action${sessionsActive ? ' is-active' : ''}" type="button" id="rail-show-sessions-button">Sessions</button>
    <button class="project-rail-action${settingsActive ? ' is-active' : ''}" type="button" id="open-app-settings-button">Setting</button>
    ${showAdmin ? '<button class="project-rail-action project-rail-admin-action" type="button" id="open-admin-console-button">Admin Console</button>' : ''}
  `;
}

function renderMobileProjectDrawer() {
  if (isDesktopLayout()) {
    return '';
  }
  return `
    <div class="mobile-drawer-backdrop${state.mobileSidebarOpen ? ' is-open' : ''}" id="mobile-drawer-backdrop">
      <aside class="mobile-project-drawer${state.mobileSidebarOpen ? ' is-open' : ''}" aria-label="Projects">
        <header class="project-rail-header mobile-project-drawer-header">
          <div class="project-rail-brand">${escapeHtml(state.siteTitle)}</div>
        </header>
        <nav class="project-rail-list">
          ${renderWorkspaceProjectList()}
        </nav>
        <div class="project-rail-footer">
          ${renderWorkspaceRailActions({ mobile: true })}
        </div>
      </aside>
    </div>
  `;
}

function seedNewSessionTargetFromSelection() {
  if (!state.selectedProjectKey && state.selectedProjectId) {
    applySelectedProjectById(state.selectedProjectId);
  }
  const selectedProject = currentSelectedProject();
  if (isMultiUserMode()) {
    initializeNewProjectSelection();
    if (selectedProject.id && availableProjects().some((project) => project.id === selectedProject.id)) {
      state.newProjectId = selectedProject.id;
    }
    state.newCwd = '';
    return;
  }
  if (selectedProject.defaultCwd) {
    state.newCwd = selectedProject.defaultCwd;
    return;
  }
  state.newCwd = hasProjectChoices() ? '' : state.cwd || '';
}

function applySelectedProjectById(projectId) {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) {
    state.selectedProjectKey = '';
    state.selectedProjectId = '';
    state.selectedProjectLabel = '';
    return;
  }
  const match = workspaceProjects().find((project) => project.id === normalizedId || project.key === normalizedId);
  if (match) {
    state.selectedProjectKey = match.key;
    state.selectedProjectId = match.id || normalizedId;
    state.selectedProjectLabel = match.label || normalizedId;
    return;
  }
  const fallback = (Array.isArray(state.projects) ? state.projects : []).find((project) => String(project?.id || '').trim() === normalizedId) || null;
  state.selectedProjectKey = normalizedId;
  state.selectedProjectId = normalizedId;
  state.selectedProjectLabel = projectVisibleName(fallback, normalizedId);
}

function applySelectedLegacyProjectFromCwd(cwd) {
  const normalizedCwd = String(cwd || '').trim();
  if (!normalizedCwd) {
    return;
  }
  state.selectedProjectKey = `cwd:${normalizedCwd}`;
  state.selectedProjectId = '';
  state.selectedProjectLabel = cwdLeafName(normalizedCwd) || normalizedCwd;
}

function resetWorkspaceSessionContext() {
  state.sessionId = null;
  state.currentSession = null;
  state.draftSessionActive = false;
  state.cwd = '';
  state.prompt = '';
  state.composerAttachments = [];
  state.timeline = [];
  state.sessionHistoryItems = [];
  state.sessionHistoryStartIndex = 0;
  state.turnId = null;
  state.pendingTurn = false;
  state.settingsOpen = false;
  state.composerExpanded = false;
  resetTurnState();
}

async function selectProjectScope(projectKey) {
  const normalizedKey = String(projectKey || '').trim();
  if (!normalizedKey) {
    state.selectedProjectKey = '';
    state.selectedProjectId = '';
    state.selectedProjectLabel = '';
    state.mobileSidebarOpen = false;
    if (!isDesktopLayout()) {
      showSessionList();
      return null;
    }
    state.view = 'sessions';
    render();
    return null;
  }
  const selectedProject = workspaceProjects().find((project) => project.key === normalizedKey) || null;
  state.selectedProjectKey = normalizedKey;
  state.selectedProjectId = selectedProject?.id || '';
  state.selectedProjectLabel = selectedProject?.label || '';
  state.mobileSidebarOpen = false;
  state.archiveConfirmSessionId = null;
  state.desktopSettingsOpen = false;
  state.desktopOverlay = null;
  if (!isDesktopLayout()) {
    showSessionList();
    return null;
  }
  const [latestSession] = projectScopedSessions()
    .sort((left, right) => lastInputAtForSession(right) - lastInputAtForSession(left));
  if (latestSession) {
    await selectSession(latestSession.id);
    return latestSession;
  }
  resetWorkspaceSessionContext();
  openNewSessionPage();
  return null;
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

function availableProjects() {
  return Array.isArray(state.projects)
    ? state.projects.filter((project) => project?.id && project.canCreate !== false)
    : [];
}

function hasProjectChoices() {
  return availableProjects().length > 0;
}

function initializeNewProjectSelection() {
  const projects = availableProjects();
  if (!projects.length) {
    state.newProjectId = '';
    return;
  }
  if (!projects.some((project) => project.id === state.newProjectId)) {
    state.newProjectId = projects[0]?.id || '';
  }
}

function currentNewProjectId() {
  initializeNewProjectSelection();
  return state.newProjectId || '';
}

function isReadOnlySession(session) {
  return session?.readOnly === true || session?.mode === 'observer' || session?.mode === 'share';
}

function resetAdminState() {
  state.admin.loading = false;
  state.admin.loaded = false;
  state.admin.settings = null;
  state.admin.projects = [];
  state.admin.users = [];
  state.admin.roles = [];
  state.admin.sessions = [];
  state.admin.page = 'projects';
  state.admin.filterUserId = '';
  state.admin.filterProjectId = '';
  state.admin.editingProjectId = '';
  state.admin.editingRoleId = '';
}

function adminSessionsPath(userId = '', projectId = '') {
  const normalizedUserId = String(userId || '').trim();
  const normalizedProjectId = String(projectId || '').trim();
  const params = [];
  if (normalizedUserId) {
    params.push(`userId=${encodeURIComponent(normalizedUserId)}`);
  }
  if (normalizedProjectId) {
    params.push(`projectId=${encodeURIComponent(normalizedProjectId)}`);
  }
  const query = params.join('&');
  return query ? `/api/admin/sessions?${query}` : '/api/admin/sessions';
}

function adminUserName(userId) {
  const value = String(userId || '');
  return state.admin.users.find((user) => user.id === value)?.username || value || 'unknown';
}

function adminUserById(userId) {
  const value = String(userId || '').trim();
  return state.admin.users.find((user) => user.id === value) || null;
}

function adminUserMeta(user) {
  const status = user?.enabled === false ? 'disabled' : user?.id || '';
  const roleId = adminUserRoleId(user);
  return [status, roleId].filter(Boolean).join(' · ');
}

function adminUserRoleId(user) {
  return user?.roleId || (Array.isArray(user?.roleIds) ? user.roleIds[0] : '') || '';
}

function adminUserProjectIds(user) {
  return Array.isArray(user?.directProjectGrants)
    ? user.directProjectGrants.map((grant) => String(grant?.projectId || '').trim()).filter(Boolean)
    : [];
}

function projectVisibleName(project, fallback = '') {
  const displayName = cwdLeafName(String(project?.displayName || '').trim());
  if (displayName) {
    return displayName;
  }
  const cwd = String(project?.cwd || '').trim();
  const cwdName = cwdLeafName(cwd);
  if (cwdName) {
    return cwdName;
  }
  const normalizedFallback = String(fallback || '').trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }
  const id = String(project?.id || '').trim();
  if (id) {
    return id;
  }
  return 'Unknown project';
}

function adminProjectVisibleName(project) {
  return projectVisibleName(project);
}

function adminProjectNameById(projectId, fallback = '') {
  const normalizedId = String(projectId || '').trim();
  const project = state.admin.projects.find((item) => String(item?.id || '').trim() === normalizedId);
  if (project) {
    return adminProjectVisibleName(project);
  }
  const normalizedFallback = String(fallback || '').trim();
  if (normalizedFallback && normalizedFallback !== normalizedId) {
    return normalizedFallback;
  }
  return 'Unknown project';
}

function adminAuditProjects() {
  const byId = new Map();
  for (const project of state.admin.projects) {
    const id = String(project?.id || '').trim();
    if (!id) {
      continue;
    }
    byId.set(id, {
      id,
      displayName: adminProjectVisibleName(project),
    });
  }
  for (const session of state.admin.sessions) {
    const id = String(session?.projectId || '').trim();
    if (!id || byId.has(id)) {
      continue;
    }
    byId.set(id, {
      id,
      displayName: adminProjectNameById(id, session?.projectDisplayName),
    });
  }
  return [...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function adminEditingProject() {
  const id = String(state.admin.editingProjectId || '');
  return state.admin.projects.find((project) => project.id === id) || null;
}

function adminEditingRole() {
  const id = String(state.admin.editingRoleId || '');
  return state.admin.roles.find((role) => role.id === id) || null;
}

function adminRoleProjectIds(role) {
  return Array.isArray(role?.projectGrants)
    ? role.projectGrants.map((grant) => String(grant?.projectId || '').trim()).filter(Boolean)
    : [];
}

function currentAdminPage() {
  return normalizeAdminPage(state.admin.page);
}

function normalizeAdminPage(page) {
  const value = String(page || '').trim();
  return ['projects', 'roles', 'users', 'sessions'].includes(value) ? value : 'projects';
}

function projectNameForSession(session, fallbackCwd = '') {
  return cwdLeafName(session?.projectDisplayName || '')
    || cwdLeafName(session?.cwd || fallbackCwd)
    || cwdLeafName(session?.projectName || '')
    || String(session?.title || '').trim()
    || 'New Session';
}

function isFavoriteSession(session) {
  return session?.favorite === true || session?.settings?.favorite === true || session?.settings?.metadata?.favorite === true;
}

function normalizeReports(payload) {
  const reports = Array.isArray(payload?.items) ? payload.items : [];
  return reports
    .map(normalizeReport)
    .filter(Boolean)
    .sort(compareReports);
}

function normalizeReport(report) {
  if (!report || typeof report.id !== 'string' || !report.id) {
    return null;
  }
  return {
    id: report.id,
    project: typeof report.project === 'string' && report.project ? report.project : reportProjectFromId(report.id),
    title: typeof report.title === 'string' && report.title ? report.title : reportTitleFromId(report.id),
    kind: report.kind === 'html' ? 'html' : 'markdown',
    favorite: report.favorite === true,
    updatedAt: report.updatedAt || '',
    createdAt: report.createdAt || '',
    sizeBytes: Number.isFinite(report.sizeBytes) ? Number(report.sizeBytes) : 0,
  };
}

function filteredReports() {
  const reports = [...state.reports].sort(compareReports);
  const project = String(state.reportProject || '').trim();
  if (!project) {
    return reports;
  }
  const projectSlug = slugifyReportKey(project);
  return reports.filter((report) => slugifyReportKey(report.project) === projectSlug || slugifyReportKey(reportProjectFromId(report.id)) === projectSlug);
}

function reportProjects() {
  const projects = new Map();
  for (const report of state.reports) {
    const name = report.project || reportProjectFromId(report.id);
    const key = slugifyReportKey(name);
    const existing = projects.get(key) || {
      name,
      count: 0,
      favoriteCount: 0,
      updatedAt: '',
    };
    existing.count += 1;
    existing.favoriteCount += report.favorite ? 1 : 0;
    if (!existing.updatedAt || String(report.updatedAt || '').localeCompare(existing.updatedAt) > 0) {
      existing.updatedAt = report.updatedAt || '';
    }
    projects.set(key, existing);
  }
  return [...projects.values()].sort((left, right) => {
    if (left.favoriteCount !== right.favoriteCount) {
      return right.favoriteCount - left.favoriteCount;
    }
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
      || String(left.name || '').localeCompare(String(right.name || ''));
  });
}

function compareReports(left, right) {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1;
  }
  return String(left.project || '').localeCompare(String(right.project || ''))
    || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
    || String(left.title || '').localeCompare(String(right.title || ''));
}

function upsertReport(report) {
  const normalized = normalizeReport(report);
  if (!normalized) {
    return;
  }
  const index = state.reports.findIndex((item) => item.id === normalized.id);
  if (index >= 0) {
    state.reports[index] = {
      ...state.reports[index],
      ...normalized,
    };
  } else {
    state.reports.unshift(normalized);
  }
  state.reports.sort(compareReports);
}

function reportTitleFromId(reportId) {
  const file = String(reportId || '').split('/').filter(Boolean).pop() || 'report';
  return file.replace(/\.[^.]+$/u, '');
}

function reportProjectFromId(reportId) {
  return String(reportId || '').split('/').filter(Boolean)[0] || 'reports';
}

function reportKindFromId(reportId) {
  return /\.html?$/iu.test(String(reportId || '')) ? 'html' : 'markdown';
}

function reportFromPath(reportPath) {
  const value = String(reportPath || '');
  const reportRootMarker = '/.codex-web/reports/';
  const markerIndex = value.indexOf(reportRootMarker);
  const reportId = markerIndex >= 0
    ? value.slice(markerIndex + reportRootMarker.length)
    : value.split('/').filter(Boolean).slice(-3).join('/');
  return {
    id: reportId || value,
    title: reportTitleFromId(reportId || value),
    kind: reportKindFromId(reportId || value),
    project: reportProjectFromId(reportId || value),
  };
}

function reportProjectForSession(session) {
  const keys = sessionReportProjectKeys(session);
  if (!keys.slugSet.size) {
    return '';
  }

  const nestedProject = [...state.reports]
    .sort(compareReports)
    .find((item) => {
      const project = String(item.project || '').trim();
      return project && keys.fullProjectSlugSet.has(slugifyReportKey(project));
    })
    || null;
  if (nestedProject) {
    return nestedProject.project;
  }

  const topLevelProject = [...state.reports]
    .sort(compareReports)
    .find((item) => {
      const projectRoot = String(reportProjectFromId(item.id) || '').trim();
      return projectRoot && keys.slugSet.has(slugifyReportKey(projectRoot));
    })
    || null;
  if (topLevelProject) {
    return reportProjectFromId(topLevelProject.id);
  }

  const report = [...state.reports]
    .sort(compareReports)
    .find((item) => keys.slugSet.has(slugifyReportKey(item.project)) || keys.slugSet.has(slugifyReportKey(reportProjectFromId(item.id))))
    || null;
  if (report) {
    return reportProjectFromId(report.id);
  }
  return keys.fallbackProject || '';
}

function sessionReportProjectKeys(session) {
  const values = [
    cwdLeafName(session?.cwd || ''),
    session?.projectName,
    session?.title,
  ];
  const slugSet = new Set();
  const fullProjectSlugSet = new Set();
  let fallbackProject = '';
  for (const value of values) {
    const normalized = String(value || '').trim();
    const slug = slugifyReportKey(normalized);
    if (slug) {
      slugSet.add(slug);
      if (!fallbackProject) {
        fallbackProject = normalized;
      }
      if (/[\\/]/u.test(normalized)) {
        fullProjectSlugSet.add(slug);
      }
    }
  }
  return { slugSet, fullProjectSlugSet, fallbackProject };
}

function slugifyReportKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function projectNameFromCwd(cwd) {
  return cwdLeafName(cwd);
}

function cwdLeafName(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function firstInputForSession(session) {
  return session?.firstUserInput || session?.preview || session?.title || '';
}

function previewInputForSession(session) {
  return session?.lastUserInput || firstInputForSession(session);
}

function lastInputAtForSession(session) {
  return Math.max(session?.lastInputAt || 0, session?.updatedAt || 0);
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

function applyDefaultThreadPermissionPreset(settings, preset) {
  settings.accessPreset = preset;
  if (preset === 'read-only') {
    settings.approvalPolicy = 'never';
    settings.sandboxMode = 'read-only';
    return;
  }
  if (preset === 'full-access') {
    settings.approvalPolicy = 'never';
    settings.sandboxMode = 'danger-full-access';
    return;
  }
  settings.approvalPolicy = 'on-request';
  settings.sandboxMode = 'workspace-write';
}

function applyDefaultSettings() {
  const defaults = state.defaultThreadSettings || createDefaultThreadSettings();
  state.model = defaults.model || DEFAULT_MODEL;
  state.reasoningEffort = defaults.reasoningEffort || DEFAULT_REASONING_EFFORT;
  state.collaborationMode = defaults.collaborationMode || DEFAULT_COLLABORATION_MODE;
  applyPermissionPreset(defaults.accessPreset || DEFAULT_PERMISSION_PRESET);
}

function applySessionSettings(session) {
  const settings = session?.settings;
  if (!settings || typeof settings !== 'object' || settings.metadata?.codexWebDefaultsOnly === true || !hasSavedThreadSettings(settings)) {
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

function createDefaultThreadSettings() {
  return {
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    collaborationMode: DEFAULT_COLLABORATION_MODE,
    accessPreset: DEFAULT_PERMISSION_PRESET,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    personality: 'pragmatic',
  };
}

function hasSavedThreadSettings(settings) {
  return ['model', 'reasoningEffort', 'collaborationMode', 'accessPreset', 'approvalPolicy', 'sandboxMode']
    .some((key) => typeof settings[key] === 'string' && settings[key]);
}

function loadDefaultThreadSettings() {
  try {
    return normalizeThreadSettings(JSON.parse(localStorage.getItem(DEFAULT_THREAD_SETTINGS_KEY) || 'null'));
  } catch (_error) {
    return createDefaultThreadSettings();
  }
}

function applyDefaultThreadSettings(patch = {}) {
  const next = normalizeThreadSettings({
    ...state.defaultThreadSettings,
    ...patch,
  });
  if (typeof patch.accessPreset === 'string') {
    applyDefaultThreadPermissionPreset(next, patch.accessPreset);
  }
  state.defaultThreadSettings = next;
  localStorage.setItem(DEFAULT_THREAD_SETTINGS_KEY, JSON.stringify(next));
  if (!state.sessionId) {
    applyDefaultSettings();
  }
}

function normalizeThreadSettings(value) {
  const next = createDefaultThreadSettings();
  if (!value || typeof value !== 'object') {
    return next;
  }
  if (typeof value.model === 'string' && value.model) {
    next.model = value.model;
  }
  if (['low', 'medium', 'high', 'xhigh'].includes(value.reasoningEffort)) {
    next.reasoningEffort = value.reasoningEffort;
  }
  if (value.collaborationMode === 'plan' || value.collaborationMode === 'default') {
    next.collaborationMode = value.collaborationMode;
  }
  const preset = ['read-only', 'default', 'full-access'].includes(value.accessPreset)
    ? value.accessPreset
    : DEFAULT_PERMISSION_PRESET;
  applyDefaultThreadPermissionPreset(next, preset);
  return next;
}

function applyTheme(theme, options = {}) {
  const nextTheme = normalizeTheme(theme);
  state.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  if (options.persist !== false) {
    localStorage.setItem(THEME_KEY, nextTheme);
  }
}

function applySiteTitle(title, options = {}) {
  const nextTitle = normalizeSiteTitle(title);
  state.siteTitle = nextTitle;
  document.title = nextTitle;
  if (options.persist !== false) {
    localStorage.setItem(SITE_TITLE_KEY, nextTitle);
  }
}

function normalizeSiteTitle(title) {
  const value = String(title || '').trim();
  return value || DEFAULT_SITE_TITLE;
}

function normalizeTheme(theme) {
  return ['dark', 'light', 'sunny', 'forest'].includes(theme) ? theme : DEFAULT_THEME;
}

function normalizeMessageFontSize(size) {
  return ['small', 'medium', 'large'].includes(size) ? size : DEFAULT_MESSAGE_FONT_SIZE;
}

function messageFontSizeTokens(size) {
  switch (normalizeMessageFontSize(size)) {
    case 'small':
      return {
        fontSize: '13px',
        headingFontSize: '13px',
      };
    case 'large':
      return {
        fontSize: '17px',
        headingFontSize: '16px',
      };
    default:
      return {
        fontSize: '15px',
        headingFontSize: '14px',
      };
  }
}

function applyMessageFontSize(size, options = {}) {
  const nextSize = normalizeMessageFontSize(size);
  const tokens = messageFontSizeTokens(nextSize);
  state.messageFontSize = nextSize;
  document.documentElement.dataset.messageFontSize = nextSize;
  document.documentElement.style.setProperty('--message-font-size', tokens.fontSize);
  document.documentElement.style.setProperty('--message-heading-font-size', tokens.headingFontSize);
  if (options.persist !== false) {
    localStorage.setItem(MESSAGE_FONT_SIZE_KEY, nextSize);
  }
}

function setMessageFontSize(size) {
  const nextSize = normalizeMessageFontSize(size);
  if (nextSize === state.messageFontSize) {
    return;
  }
  withTimelineBottomOffsetPreserved(() => {
    applyMessageFontSize(nextSize);
    withTimelineScrollPreserved(() => render());
  });
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

function removeTimelineEntryById(entryId) {
  if (!entryId) {
    return;
  }
  const index = state.timeline.findIndex((item) => item?.id === entryId);
  if (index >= 0) {
    state.timeline.splice(index, 1);
  }
}

function surfaceTimelineError(turnId, message) {
  appendTimelineError(turnId, message);
  state.error = '';
  if (!state.sessionId) {
    return;
  }
  void persistTimelineError(turnId, message);
}

function appendTimelineError(turnId, message) {
  const text = String(message || 'Turn failed');
  const id = `error_${turnId || Date.now()}`;
  appendOrReplace({
    id,
    kind: 'message',
    role: 'system',
    severity: 'error',
    label: 'Error',
    meta: 'failed',
    text,
  }, (item) => item.id === id, { moveToEnd: true });
}

async function persistTimelineError(turnId, message) {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/timeline`, {
      method: 'POST',
      body: {
        id: `error_${turnId || Date.now()}`,
        role: 'system',
        label: 'Error',
        meta: 'failed',
        text: String(message || 'Turn failed'),
        severity: 'error',
        afterHistoryIndex: currentHydratedHistoryLength(),
      },
    });
  } catch (error) {
    if (handleMissingSession(error, '')) {
      return;
    }
  }
}

function appendOrReplace(entry, matcher, options = {}) {
  const index = state.timeline.findIndex(matcher);
  if (index >= 0) {
    if (options.moveToEnd) {
      state.timeline.splice(index, 1);
      state.timeline.push(entry);
    } else {
      state.timeline[index] = entry;
    }
  } else {
    state.timeline.push(entry);
  }
}

function currentHydratedHistoryLength() {
  if (!state.currentSession) {
    return 0;
  }
  return fullHydratedTimelineFromSession(state.currentSession)
    .filter((item) => item?.kind === 'message' && item?.meta === 'history')
    .length;
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
  if (state.view === 'admin') {
    return false;
  }
  if (state.view === 'chat' && isChatTitlePullTarget(pull.target)) {
    return null;
  }
  return document.querySelector('.timeline')
    || document.querySelector('.report-viewer')
    || document.querySelector('.report-list')
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

function setupMobileOrientationLock() {
  requestMobilePortraitLock();
  document.addEventListener('visibilitychange', requestMobilePortraitLock);
  document.addEventListener('pointerdown', requestMobilePortraitLock, { passive: true });
  window.addEventListener('focus', requestMobilePortraitLock);
  window.addEventListener('orientationchange', requestMobilePortraitLock);
}

function requestMobilePortraitLock() {
  if (!shouldRequestMobilePortraitLock()) {
    return;
  }
  const orientation = globalThis.screen?.orientation || window.screen?.orientation;
  if (!orientation || typeof orientation.lock !== 'function') {
    return;
  }
  try {
    const result = orientation.lock('portrait-primary');
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (_error) {
  }
}

function shouldRequestMobilePortraitLock() {
  if (isDesktopLayout()) {
    return false;
  }
  if (document.visibilityState === 'hidden') {
    return false;
  }
  const hasCoarsePointer = typeof window?.matchMedia === 'function'
    ? window.matchMedia('(hover: none) and (pointer: coarse)').matches
    : false;
  const hasTouch = Number(navigator?.maxTouchPoints || 0) > 0;
  const narrowViewport = typeof window?.innerWidth !== 'number'
    || window.innerWidth < DESKTOP_WORKSPACE_MIN_WIDTH;
  return hasCoarsePointer || hasTouch || narrowViewport;
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    if (state.view === 'chat' && state.sessionId) {
      chatTimelineForegroundSnapshot = captureTimelineViewport();
    }
    if (state.pendingTurn) {
      state.streamWasBackgrounded = true;
    }
    return;
  }
  if (document.visibilityState === 'visible') {
    void checkForAppUpdate();
    void recoverActiveTurnAfterForeground();
  }
}

function onPageResume() {
  if (document.visibilityState === 'hidden') {
    return;
  }
  void checkForAppUpdate();
  void recoverActiveTurnAfterForeground();
}

function setupAppVersionRefresh() {
  if (!isStandalonePwa()) {
    return;
  }
  window.addEventListener('load', () => {
    void checkForAppUpdate();
  });
}

async function checkForAppUpdate() {
  if (!isStandalonePwa()) {
    return;
  }
  try {
    const response = await fetch(`/app.js?version-check=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      return;
    }
    const text = await response.text();
    const match = text.match(/const APP_BUILD_ID = ['"]([^'"]+)['"]/u);
    if (match?.[1] && match[1] !== APP_BUILD_ID) {
      window.location.reload();
    }
  } catch (_error) {
  }
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
  const viewportSnapshot = isDesktopWorkspaceView()
    ? latestTimelineViewportSnapshot()
    : rememberedTimelineViewport()
      || chatTimelineForegroundSnapshot
      || latestTimelineViewportSnapshot();
  await refreshCurrentSessionMetadata({ hydrateTimeline: true, viewportSnapshot });
  chatTimelineForegroundSnapshot = null;
  if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
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
  state.error = options.suppressComposerError ? '' : message;
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
      state.timelineShouldFollowLatest = true;
      rememberCurrentTimelineViewport();
    }
  });
}

function rememberCurrentTimelineViewport() {
  if (!state.sessionId || (!isDesktopWorkspaceView() && state.view !== 'chat')) {
    return;
  }
  const snapshot = captureTimelineViewport();
  chatTimelineViewportSnapshot = {
    ...snapshot,
    sessionId: state.sessionId,
  };
}

function rememberedTimelineViewport() {
  if (!state.sessionId || chatTimelineViewportSnapshot?.sessionId !== state.sessionId) {
    return null;
  }
  const { sessionId: _sessionId, ...snapshot } = chatTimelineViewportSnapshot;
  return { ...snapshot };
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
  const lines = text.split('\n');
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
    const table = parseMarkdownTable(lines, index);
    if (table) {
      flushTextBlocks();
      blocks.push(renderMarkdownTable(table.header, table.rows, table.alignments));
      index = table.lastLineIndex;
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

function parseMarkdownTable(lines, startIndex) {
  const header = parseMarkdownTableRow(lines[startIndex]);
  if (!header || startIndex + 1 >= lines.length) {
    return null;
  }
  const alignments = parseMarkdownTableDivider(lines[startIndex + 1], header.length);
  if (!alignments) {
    return null;
  }

  const rows = [];
  let cursor = startIndex + 2;
  while (cursor < lines.length) {
    const row = parseMarkdownTableRow(lines[cursor]);
    if (!row || row.length !== header.length) {
      break;
    }
    rows.push(row);
    cursor += 1;
  }

  return {
    header,
    alignments,
    rows,
    lastLineIndex: cursor - 1,
  };
}

function parseMarkdownTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || !trimmed.includes('|')) {
    return null;
  }
  const cells = [];
  let current = '';
  let index = trimmed.startsWith('|') ? 1 : 0;
  let codeDelimiterLength = 0;
  let endedWithDelimiter = false;

  while (index < trimmed.length) {
    const character = trimmed[index];
    const nextCharacter = trimmed[index + 1];
    if (codeDelimiterLength === 0 && character === '\\' && nextCharacter === '|') {
      current += '|';
      index += 2;
      endedWithDelimiter = false;
      continue;
    }
    if (character === '`') {
      const runLength = countRepeatedCharacter(trimmed, index, '`');
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (runLength === codeDelimiterLength) {
        codeDelimiterLength = 0;
      }
      current += '`'.repeat(runLength);
      index += runLength;
      endedWithDelimiter = false;
      continue;
    }
    if (codeDelimiterLength === 0 && character === '|') {
      cells.push(current.trim());
      current = '';
      index += 1;
      endedWithDelimiter = true;
      continue;
    }
    current += character;
    index += 1;
    endedWithDelimiter = false;
  }
  if (!endedWithDelimiter || current.length > 0) {
    cells.push(current.trim());
  }
  if (cells.length < 2) {
    return null;
  }
  return cells;
}

function countRepeatedCharacter(value, startIndex, character) {
  let index = startIndex;
  while (index < value.length && value[index] === character) {
    index += 1;
  }
  return index - startIndex;
}

function parseMarkdownTableDivider(line, expectedColumns) {
  const cells = parseMarkdownTableRow(line);
  if (!cells || cells.length !== expectedColumns) {
    return null;
  }
  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/u.test(cell)) {
      return null;
    }
    const leftAligned = cell.startsWith(':');
    const rightAligned = cell.endsWith(':');
    if (leftAligned && rightAligned) {
      alignments.push('center');
    } else if (rightAligned) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  }
  return alignments;
}

function renderMarkdownTable(header, rows, alignments = []) {
  const getAlignmentStyle = (index) => ` style="text-align: ${escapeAttribute(alignments[index] || 'left')};"`;
  const headHtml = header.map((cell, index) => `<th${getAlignmentStyle(index)}>${renderInlineMarkdown(cell)}</th>`).join('');
  const bodyHtml = rows.map((row) => `<tr>${row.map((cell, index) => `<td${getAlignmentStyle(index)}>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="markdown-table"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderInlineMarkdown(value) {
  return linkPlainReportPaths(escapeHtml(value)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/gu, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(((?:\/|~\/|\.\.?\/)[^)\s]+\.(?:md|markdown|html?|htm))\)/giu, (_match, label, href) => {
      const decodedHref = decodeHtmlEntityText(href);
      if (!isStrictReportPath(decodedHref)) {
        return `[${label}](${href})`;
      }
      return renderReportLink(label, decodedHref);
    })
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, '<a href="$2" target="_blank" rel="noreferrer">$1</a>'));
}

function linkPlainReportPaths(html) {
  return String(html || '').replace(
    /(^|[\s:：>])((?:\/|~\/|\.\.?\/)[^\s<>"']*?\.codex-web\/reports\/[^\s<>"']+?\.(?:md|markdown|html?|htm))(?=$|[\s<),，。！？!?])/giu,
    (_match, prefix, reportPath) => {
      if (!isStrictReportPath(reportPath)) {
        return `${prefix}${reportPath}`;
      }
      return `${prefix}${renderReportLink(shortReportPathLabel(reportPath), reportPath)}`;
    },
  );
}

function renderReportLink(label, href) {
  const reportPath = decodeHtmlEntityText(href);
  return `<a href="#" class="report-link" data-report-path="${escapeAttribute(reportPath)}">${label}</a>`;
}

function isStrictReportPath(value) {
  const reportPath = decodeHtmlEntityText(value);
  return /(?:^|[\\/])\.codex-web[\\/]reports[\\/].+\.(?:md|markdown|html?|htm)$/iu.test(reportPath);
}

function shortReportPathLabel(reportPath) {
  const decoded = decodeHtmlEntityText(reportPath);
  return decoded.split(/[\\/]/u).filter(Boolean).pop() || decoded;
}

function decodeHtmlEntityText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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
