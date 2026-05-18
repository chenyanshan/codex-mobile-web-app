import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const stylesUrl = new URL('../public/styles.css', import.meta.url);
const appUrl = new URL('../public/app.js', import.meta.url);
const indexUrl = new URL('../public/index.html', import.meta.url);
const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url);
const serviceWorkerUrl = new URL('../public/service-worker.js', import.meta.url);
const pwaPullRefreshUrl = new URL('../public/pwa-pull-refresh.js', import.meta.url);

test('mobile UI exposes iOS PWA install metadata and registers a service worker', async () => {
  const [index, app, manifest, serviceWorker] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(manifestUrl, 'utf8'),
    readFile(serviceWorkerUrl, 'utf8'),
  ]);
  const parsedManifest = JSON.parse(manifest);

  assert.equal(parsedManifest.name, 'Codex Web');
  assert.equal(parsedManifest.short_name, 'Codex');
  assert.equal(parsedManifest.display, 'standalone');
  assert.equal(parsedManifest.start_url, '/');
  assert.equal(parsedManifest.theme_color, '#0b0d12');
  assert.equal(parsedManifest.background_color, '#0b0d12');
  assert.match(index, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(index, /<meta name="theme-color" content="#0b0d12">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-capable" content="yes">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-title" content="Codex">/u);
  assert.match(app, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/u);
  assert.match(serviceWorker, /self\.addEventListener\('install'/u);
  assert.match(serviceWorker, /self\.addEventListener\('fetch'/u);
  assert.doesNotMatch(serviceWorker, /cached \|\| fetch\(request\)/u);
  assert.match(serviceWorker, /fetch\(request\)/u);
  assert.match(serviceWorker, /cache\.put\(request, response\.clone\(\)\)/u);
});

test('new sessions default to gpt-5.4 xhigh full access settings', async () => {
  const { api } = await loadAppHarness();

  assert.equal(api.state.model, 'gpt-5.4');
  assert.equal(api.state.reasoningEffort, 'xhigh');
  assert.equal(api.state.permissionPreset, 'full-access');
  assert.equal(api.state.approvalPolicy, 'never');
  assert.equal(api.state.sandboxMode, 'danger-full-access');
  assert.equal(
    JSON.stringify(api.collectSettings()),
    JSON.stringify({
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      collaborationMode: 'default',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      personality: 'pragmatic',
    }),
  );
});

test('opening a session applies its persisted settings to controls', async () => {
  const { api } = await loadAppHarness();

  api.applySessionSettings({
    settings: {
      model: 'gpt-5',
      reasoningEffort: 'high',
      collaborationMode: 'plan',
      accessPreset: 'read-only',
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
    },
  });

  assert.equal(api.state.model, 'gpt-5');
  assert.equal(api.state.reasoningEffort, 'high');
  assert.equal(api.state.collaborationMode, 'plan');
  assert.equal(api.state.permissionPreset, 'read-only');
  assert.equal(api.state.approvalPolicy, 'never');
  assert.equal(api.state.sandboxMode, 'read-only');
});

test('changing existing session settings patches the session settings endpoint', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_settings',
            cwd: '/repo',
            settings: JSON.parse(options.body),
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.sessionId = 'session_settings';
  api.state.currentSession = { id: 'session_settings', cwd: '/repo', settings: {} };
  api.state.sessions = [api.state.currentSession];

  await api.updateSessionSettings({ model: 'gpt-5-mini', reasoningEffort: 'low' });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_settings/settings');
  assert.equal(fetchCalls[0]?.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(fetchCalls[0]?.options.body), {
    model: 'gpt-5-mini',
    reasoningEffort: 'low',
    collaborationMode: 'default',
    accessPreset: 'full-access',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    personality: 'pragmatic',
  });
});

test('repeat opens with a stored token render the app shell before auth verification finishes', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function createCachedAuthSession\(\)/u);
  assert.match(app, /state\.authSession = createCachedAuthSession\(\);/u);
  assert.match(app, /function bootstrap\(\)[\s\S]*void restoreAuth\(\);/u);
  assert.doesNotMatch(app, /function bootstrap\(\)\s*\{(?:(?!\n\}\n\nasync function restoreAuth).)*await restoreAuth\(\);/su);
  assert.match(app, /function onLoginSubmit\(event\)[\s\S]*state\.authSession = payload\.session \|\| createCachedAuthSession\(\);/u);
  assert.match(app, /function onLoginSubmit\(event\)[\s\S]*void restoreAuth\(\);/u);
  assert.doesNotMatch(app, /function onLoginSubmit\(event\)\s*\{(?:(?!\n\}\n\nasync function onLogout).)*await restoreAuth\(\);/su);
  assert.doesNotMatch(app, /name="deviceName"/u);
  assert.doesNotMatch(app, /form\.get\('deviceName'\)/u);
});

test('sessions navigation remains available during a pending turn', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.doesNotMatch(app, /id="back-to-list-button"[^>]*state\.pendingTurn \? 'disabled'/u);
  assert.doesNotMatch(app, /function showSessionList\(\)\s*\{\s*if \(state\.pendingTurn\)/u);
  assert.doesNotMatch(app, /function openNewSessionPage\(\)\s*\{\s*if \(state\.pendingTurn\)/u);
  assert.doesNotMatch(app, /async function selectSession\(sessionId\)\s*\{\s*if \(state\.pendingTurn\)/u);
});

test('message input starts one line and auto-grows to a compact capped height', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(app, /<textarea id="prompt-input"[^>]*rows="1"/u);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*min-height:\s*38px;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*max-height:\s*116px;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.icon-button,\s*\.compact-send\s*\{[^}]*min-height:\s*38px;/su);
  assert.match(styles, /\.icon-button,\s*\.compact-send\s*\{[^}]*padding:\s*0 8px;/su);
  assert.match(app, /function autoGrowPromptInput\(textarea\)/u);
  assert.match(app, /textarea\.style\.height = 'auto';/u);
  assert.match(app, /Math\.min\(textarea\.scrollHeight, 116\)/u);
  assert.match(app, /Math\.max\(38, nextHeight\)/u);
  assert.match(app, /autoGrowPromptInput\(promptInput\)/u);
});

test('chat and session list use separate scroll containers', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /html,\s*body\s*\{[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /#app\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.screen\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.timeline\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.timeline\s*\{[^}]*overscroll-behavior:\s*contain;/su);
  assert.match(styles, /\.session-list,\s*\.new-session-page\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.session-list,\s*\.new-session-page\s*\{[^}]*overscroll-behavior:\s*contain;/su);
});

test('mobile timeline reserves the measured composer height', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(styles, /--composer-offset:\s*320px;/u);
  assert.match(styles, /\.timeline\s*\{[^}]*padding:\s*12px 12px var\(--composer-offset\);/su);
  assert.match(styles, /\.timeline\s*\{[^}]*scroll-padding-bottom:\s*var\(--composer-offset\);/su);
  assert.match(app, /function syncComposerOffset\(\)/u);
  assert.match(app, /getBoundingClientRect\(\)\.height/u);
  assert.match(app, /new ResizeObserver/u);
  assert.match(app, /style\.setProperty\('--composer-offset'/u);
});

test('opening a session jumps straight to the latest timeline content', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function scrollTimelineToBottom\(\)[\s\S]*timeline\.scrollTop = timeline\.scrollHeight;/u);
  assert.doesNotMatch(app, /window\.scrollTo\(/u);
  assert.match(app, /async function selectSession\(sessionId\)[\s\S]*render\(\);\s*scrollTimelineToBottom\(\);/u);
});

test('chat page uses app-style back header and left-edge swipe navigation', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /<div class="chat-nav">[\s\S]*id="back-to-list-button"[\s\S]*aria-label="Sessions"[\s\S]*>[\s\S]*&lt;[\s\S]*<\/button>[\s\S]*<div class="project-title"/u);
  assert.match(app, /setupEdgeSwipeBackNavigation\(\)/u);
  assert.match(app, /const EDGE_SWIPE_START_PX = 24;/u);
  assert.match(app, /const EDGE_SWIPE_TRIGGER_PX = 72;/u);
  assert.match(app, /document\.addEventListener\('touchstart', onEdgeSwipeStart/u);
  assert.match(app, /document\.addEventListener\('touchend', onEdgeSwipeEnd/u);
  assert.match(app, /if \(state\.view !== 'chat'\)/u);
  assert.match(app, /showSessionList\(\);/u);
  assert.match(styles, /\.chat-nav\s*\{/u);
  assert.match(styles, /\.chat-back-button\s*\{/u);
  assert.match(styles, /\.chat-nav \.project-title\s*\{/u);
});

test('mobile UI uses session list, compact composer, settings drawer, and history restore', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /view:\s*'sessions'/u);
  assert.match(app, /renderSessionList\(\)/u);
  assert.match(app, /renderNewSession\(\)/u);
  assert.match(app, /renderChat\(\)/u);
  assert.match(app, /timelineCache:\s*loadTimelineCache\(\)/u);
  assert.match(app, /saveCurrentTimeline\(\)/u);
  assert.match(app, /hydrateTimelineFromSession/u);
  assert.match(app, /data-permission-preset/u);
  assert.match(app, /danger-full-access/u);
  assert.match(app, /approvalPolicy = 'never'/u);
  assert.match(app, /settingsOpen/u);
  assert.doesNotMatch(app, /status-pill/u);
  assert.doesNotMatch(app, /Turn started/u);
  assert.doesNotMatch(app, /Turn completed/u);
  assert.doesNotMatch(app, /id="session-select"/u);
  assert.doesNotMatch(app, /id="cwd-input"/u);
  assert.doesNotMatch(app, /renderSessionOptions/u);
});

test('mobile UI persists per-browser chat timelines across reloads', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /TIMELINE_CACHE_KEY/u);
  assert.match(app, /timelineCache:\s*loadTimelineCache\(\)/u);
  assert.match(app, /function loadTimelineCache\(\)/u);
  assert.match(app, /function persistTimelineCache\(\)/u);
  assert.match(app, /localStorage\.getItem\(TIMELINE_CACHE_KEY\)/u);
  assert.match(app, /localStorage\.setItem\(TIMELINE_CACHE_KEY/u);
  assert.match(app, /MAX_TIMELINE_CACHE_SESSIONS/u);
  assert.match(app, /savedAt:\s*Date\.now\(\)/u);
});

test('mobile UI refreshes session metadata after turn completion', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /async function refreshCurrentSessionMetadata\(/u);
  assert.match(app, /function optimisticallyUpdateSessionInput\(text\)/u);
  assert.match(app, /optimisticallyUpdateSessionInput\(promptToSend\)/u);
  assert.match(app, /case 'turn\.completed':[\s\S]*void refreshCurrentSessionMetadata\(\);/u);
  assert.match(app, /const sessionId = state\.sessionId;[\s\S]*apiFetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`\)/u);
});

test('session cards prefer the latest user input for orientation', async () => {
  const { api } = await loadAppHarness();

  const session = {
    id: 'session_1',
    cwd: '/Users/alice/project',
    firstUserInput: 'Original setup question',
    lastUserInput: 'Latest debugging question',
    updatedAt: 1,
    lastInputAt: 2,
  };

  assert.equal(api.previewInputForSession(session), 'Latest debugging question');
  assert.equal(api.firstInputForSession(session), 'Original setup question');
});

test('stale session refresh failures do not clear the active session after switching', async () => {
  let releaseFetch;
  const fetchReady = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const { api } = await loadAppHarness({
    fetch: async () => {
      await fetchReady;
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'session_not_found', message: 'session not found' }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [
    { id: 'old_session', cwd: '/repo/old' },
    { id: 'new_session', cwd: '/repo/new' },
  ];
  api.state.sessionId = 'old_session';
  api.state.currentSession = api.state.sessions[0];

  const refresh = api.refreshCurrentSessionMetadata();
  api.state.sessionId = 'new_session';
  api.state.currentSession = api.state.sessions[1];
  releaseFetch();
  await refresh;

  assert.equal(api.state.sessionId, 'new_session');
  assert.equal(api.state.currentSession?.id, 'new_session');
  assert.deepEqual(api.state.sessions.map((session) => session.id), ['new_session']);
});

test('timeline cache bounds persisted batches and approvals', async () => {
  const { api, storage } = await loadAppHarness();

  api.state.sessionId = 'session_1';
  api.state.timeline = [];
  api.state.batches = new Map(Array.from({ length: 40 }, (_, index) => [
    `batch_${index}`,
    {
      id: `batch_${index}`,
      kind: 'batch',
      batchId: `batch_${index}`,
      summary: { output: 'x'.repeat(20000) },
    },
  ]));
  api.state.approvals = new Map(Array.from({ length: 40 }, (_, index) => [
    `approval_${index}`,
    {
      id: `approval_${index}`,
      kind: 'approval',
      approvalId: `approval_${index}`,
      summary: { command: 'y'.repeat(20000) },
    },
  ]));

  api.saveCurrentTimeline();

  const persisted = JSON.parse(storage.get('codexWebTimelineCache'));
  const entry = persisted.entries[0];
  assert.ok(entry.batches.length <= api.MAX_TIMELINE_CACHE_MAP_ITEMS);
  assert.ok(entry.approvals.length <= api.MAX_TIMELINE_CACHE_MAP_ITEMS);
  assert.ok(entry.batches.every(([, item]) => item.summary.output.length <= api.MAX_TIMELINE_SUMMARY_TEXT));
  assert.ok(entry.approvals.every(([, item]) => item.summary.command.length <= api.MAX_TIMELINE_SUMMARY_TEXT));
});

test('history hydration includes recent assistant app-server messages', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_history',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'First user question' },
            { type: 'agentMessage', role: null, text: 'First assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'message', role: 'user', text: 'Second user question' },
            { type: 'assistantMessage', role: null, text: 'Second assistant answer' },
          ],
        },
        {
          id: 'turn_3',
          items: [
            { type: 'message', role: 'user', text: 'Third user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer (part 1)' },
            { type: 'agentMessage', role: null, text: 'Third assistant answer (part 2)' },
          ],
        },
        {
          id: 'turn_4',
          items: [
            { type: 'message', role: 'user', text: 'Newest user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer' },
          ],
        },
      ],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.role, item.text])),
    JSON.stringify([
      ['user', 'Third user question'],
      ['assistant', 'Third assistant answer (part 1)'],
      ['assistant', 'Third assistant answer (part 2)'],
      ['user', 'Newest user question'],
      ['assistant', 'Third assistant answer'],
    ]),
  );
});

test('history hydration falls back to the full available conversation when fewer than two answered turns exist', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_short_history',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'Only user question' },
            { type: 'agentMessage', role: null, text: 'Only assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'agentMessage', role: null, text: 'Follow-up assistant note' },
          ],
        },
      ],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.role, item.text])),
    JSON.stringify([
      ['user', 'Only user question'],
      ['assistant', 'Only assistant answer'],
      ['assistant', 'Follow-up assistant note'],
    ]),
  );
});

test('session list defaults to favorites and supports time plus favorite actions', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /sortMode:\s*'favorites'/u);
  assert.match(app, /data-sort-mode="favorites"/u);
  assert.match(app, /data-sort-mode="time"/u);
  assert.doesNotMatch(app, /data-sort-mode="project"/u);
  assert.doesNotMatch(app, /renderProjectFilter\(\)/u);
  assert.doesNotMatch(app, /data-project-filter/u);
  assert.match(app, /function filteredSessions\(\)/u);
  assert.match(app, /function isFavoriteSession\(session\)/u);
  assert.match(app, /data-session-favorite-id/u);
  assert.match(app, /data-session-archive-request-id/u);
  assert.match(app, /function toggleSessionFavorite\(sessionId\)/u);
  assert.match(app, /async function archiveSession\(sessionId\)/u);
  assert.match(app, /apiFetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`,\s*\{\s*method:\s*'DELETE'/su);
});

test('favorite filter shows only favorite sessions and time shows all sessions', async () => {
  const { api } = await loadAppHarness();

  api.state.sessions = [
    { id: 'old', updatedAt: 10, settings: { metadata: {} } },
    { id: 'favorite', favorite: true, updatedAt: 20, settings: { metadata: {} } },
  ];

  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(JSON.stringify(api.filteredSessions().map((session) => session.id)), JSON.stringify(['favorite']));

  api.state.sortMode = 'time';
  assert.equal(JSON.stringify(api.filteredSessions().map((session) => session.id).sort()), JSON.stringify(['favorite', 'old']));
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['favorite', 'old']));
});

test('favorite action patches session favorite state without opening the session', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_1',
            cwd: '/repo',
            favorite: JSON.parse(options.body).favorite,
            updatedAt: 1,
            settings: { metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [{ id: 'session_1', settings: { metadata: {} } }];

  await api.toggleSessionFavorite('session_1');

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_1/favorite');
  assert.equal(fetchCalls[0]?.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(fetchCalls[0]?.options.body), {
    favorite: true,
  });
  assert.equal(api.state.sessions[0]?.favorite, true);
});

test('archive action requires a confirmation dialog before deleting a session', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /archiveConfirmSessionId:\s*null/u);
  assert.match(app, /renderArchiveConfirmModal\(\)/u);
  assert.match(app, /role="dialog"/u);
  assert.match(app, /data-session-archive-request-id/u);
  assert.match(app, /data-session-archive-confirm-id/u);
  assert.match(app, /function requestArchiveSession\(sessionId\)/u);
  assert.match(app, /requestArchiveSession\(button\.getAttribute\('data-session-archive-request-id'\) \|\| ''\)/u);
  assert.match(app, /archiveSession\(button\.getAttribute\('data-session-archive-confirm-id'\) \|\| ''\)/u);
  assert.doesNotMatch(app, /archiveSession\(button\.getAttribute\('data-session-archive-id'\) \|\| ''\)/u);
  assert.match(styles, /\.modal-backdrop\s*\{/u);
  assert.match(styles, /\.confirm-dialog\s*\{/u);
});

test('PWA standalone mode enables local pull-to-refresh without normal browser refresh hooks', async () => {
  const [index, app, serviceWorker, pullRefresh] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(serviceWorkerUrl, 'utf8'),
    readFile(pwaPullRefreshUrl, 'utf8'),
  ]);

  assert.match(index, /<script src="\/pwa-pull-refresh\.js"><\/script>/u);
  assert.match(serviceWorker, /'\/pwa-pull-refresh\.js'/u);
  assert.match(app, /function isStandalonePwa\(\)/u);
  assert.match(app, /navigator\.standalone === true/u);
  assert.match(app, /matchMedia\('\(display-mode: standalone\)'\)/u);
  assert.match(app, /function setupPwaPullToRefresh\(\)/u);
  assert.match(app, /window\.CodexPullToRefresh\.init/u);
  assert.match(app, /refreshCurrentView\(\)/u);
  assert.match(app, /threshold:\s*120/u);
  assert.doesNotMatch(app, /window\.location\.reload\(\)/u);
  assert.match(pullRefresh, /window\.CodexPullToRefresh/u);
  assert.match(pullRefresh, /touchstart/u);
  assert.match(pullRefresh, /touchmove/u);
  assert.match(pullRefresh, /const DEFAULT_THRESHOLD = 112;/u);
});

test('PWA refresh updates the current view instead of reloading the app', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'session_fresh', favorite: true, settings: { metadata: {} } }],
          }),
        };
      }
      if (path === '/api/sessions/session_fresh') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_fresh',
              favorite: true,
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    items: [
                      { type: 'message', role: 'user', text: 'Latest question' },
                      { type: 'message', role: 'assistant', text: 'Latest answer' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';

  await api.refreshCurrentView();
  assert.deepEqual(api.state.sessions.map((session) => session.id), ['session_fresh']);

  api.state.view = 'chat';
  api.state.sessionId = 'session_fresh';
  api.state.currentSession = api.state.sessions[0];
  await api.refreshCurrentView();

  assert.deepEqual(fetchCalls, ['/api/sessions', '/api/sessions/session_fresh']);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Latest answer/u);
});

test('PWA foreground recovery refreshes session history and reconnects unhealthy turn streams', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/u);
  assert.match(app, /function onVisibilityChange\(\)/u);
  assert.match(app, /state\.streamWasBackgrounded = true/u);
  assert.match(app, /function isTurnStreamHealthy\(\)/u);
  assert.match(app, /async function recoverActiveTurnAfterForeground\(\)/u);
  assert.match(app, /refreshCurrentSessionMetadata\(\{ hydrateTimeline: true \}\)/u);
  assert.match(app, /streamTurnEvents\(state\.turnId, \{ forceReconnect: true \}\)/u);
  assert.match(app, /lastTurnEventSequence/u);
  assert.match(app, /after=\$\{encodeURIComponent\(String\(state\.lastTurnEventSequence\)\)\}/u);
});

test('backgrounded PWA stream failures keep the active turn recoverable', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => {
      throw new Error('Background fetch closed');
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.streamTurnEvents('turn_1');

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.streamWasBackgrounded, true);
  assert.notEqual(api.state.status, 'Stream failed');
});

async function loadAppHarness(overrides = {}) {
  const app = await readFile(appUrl, 'utf8');
  const storage = new Map();
  const appElement = {
    innerHTML: '',
    appendChild() {},
  };
  const context = {
    console,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        storage.set(key, String(value));
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    },
    document: {
      body: { scrollHeight: 0 },
      visibilityState: 'visible',
      documentElement: {
        style: {
          removeProperty() {},
          setProperty() {},
        },
      },
      addEventListener() {},
      querySelector: (selector) => selector === '#app' ? appElement : null,
      querySelectorAll: () => [],
      createElement: () => ({
        className: '',
        innerHTML: '',
      }),
    },
    window: {
      scrollTo() {},
    },
    navigator: {
      userAgent: 'Node test',
    },
    requestAnimationFrame: (callback) => {
      callback();
    },
    fetch: overrides.fetch || (async () => ({ ok: true, status: 204 })),
    TextDecoder,
    AbortController,
    FormData,
    ResizeObserver: class ResizeObserver {
      observe() {}
      disconnect() {}
    },
  };
  vm.runInNewContext(`${app}
globalThis.__codexWebTest = {
  state,
  MAX_TIMELINE_CACHE_MAP_ITEMS: typeof MAX_TIMELINE_CACHE_MAP_ITEMS === 'number' ? MAX_TIMELINE_CACHE_MAP_ITEMS : null,
  MAX_TIMELINE_SUMMARY_TEXT: typeof MAX_TIMELINE_SUMMARY_TEXT === 'number' ? MAX_TIMELINE_SUMMARY_TEXT : null,
  firstInputForSession,
  previewInputForSession: typeof previewInputForSession === 'function' ? previewInputForSession : null,
  hydrateTimelineFromSession,
  applySessionSettings: typeof applySessionSettings === 'function' ? applySessionSettings : null,
  updateSessionSettings: typeof updateSessionSettings === 'function' ? updateSessionSettings : null,
  collectSettings,
  refreshCurrentSessionMetadata,
  refreshCurrentView: typeof refreshCurrentView === 'function' ? refreshCurrentView : null,
  filteredSessions: typeof filteredSessions === 'function' ? filteredSessions : null,
  sortedSessions: typeof sortedSessions === 'function' ? sortedSessions : null,
  toggleSessionFavorite: typeof toggleSessionFavorite === 'function' ? toggleSessionFavorite : null,
  streamTurnEvents,
  saveCurrentTimeline,
};`, context);
  return {
    api: context.__codexWebTest,
    storage,
  };
}
