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
  assert.match(index, /<link rel="icon" href="\/icon-192\.png" type="image\/png">/u);
  assert.match(index, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/u);
  assert.match(index, /<meta name="theme-color" content="#0b0d12">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-capable" content="yes">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-title" content="Codex">/u);
  assert.deepEqual(parsedManifest.icons.map((icon) => icon.src), ['/icon-192.png', '/icon-512.png']);
  assert.deepEqual(parsedManifest.icons.map((icon) => icon.type), ['image/png', 'image/png']);
  assert.deepEqual(parsedManifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  assert.match(app, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/u);
  assert.match(serviceWorker, /codex-web-static-2026-05-19-thread-activity-details-v16/u);
  assert.match(serviceWorker, /'\/icon-192\.png'/u);
  assert.match(serviceWorker, /'\/icon-512\.png'/u);
  assert.match(serviceWorker, /'\/apple-touch-icon\.png'/u);
  assert.match(serviceWorker, /self\.addEventListener\('install'/u);
  assert.match(serviceWorker, /self\.addEventListener\('fetch'/u);
  assert.doesNotMatch(serviceWorker, /cached \|\| fetch\(request\)/u);
  assert.match(serviceWorker, /fetch\(request\)/u);
  assert.match(serviceWorker, /cache\.put\(request, response\.clone\(\)\)/u);
});

test('PWA checks app version on foreground to escape stale standalone caches', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /const APP_BUILD_ID = /u);
  assert.match(app, /setupAppVersionRefresh\(\)/u);
  assert.match(app, /async function checkForAppUpdate\(\)/u);
  assert.match(app, /fetch\(`\/app\.js\?version-check=\$\{Date\.now\(\)\}`/u);
  assert.match(app, /window\.location\.reload\(\)/u);
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

test('session home opens a settings page and keeps logout inside settings', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function renderAppSettings\(\)/u);
  assert.match(app, /id="open-app-settings-button"/u);
  assert.match(app, /id="settings-logout-button"/u);
  assert.doesNotMatch(app, /renderSessionList\(\)[\s\S]{0,900}id="logout-button"/u);
});

test('app settings persist theme and default thread settings', async () => {
  const { api, storage, context } = await loadAppHarness();

  api.state.models = [
    { id: 'gpt-5.4', label: 'GPT 5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  ];

  api.applyTheme('light');
  assert.equal(storage.get('codexWebTheme'), 'light');
  assert.equal(context.document.documentElement.dataset.theme, 'light');

  api.applyDefaultThreadSettings({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    collaborationMode: 'plan',
    accessPreset: 'default',
  });

  assert.equal(storage.get('codexWebDefaultThreadSettings'), JSON.stringify({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    collaborationMode: 'plan',
    accessPreset: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    personality: 'pragmatic',
  }));

  api.applyDefaultSettings();
  assert.equal(api.state.model, 'gpt-5.4-mini');
  assert.equal(api.state.reasoningEffort, 'medium');
  assert.equal(api.state.collaborationMode, 'plan');
  assert.equal(api.state.permissionPreset, 'default');
  assert.equal(api.state.approvalPolicy, 'on-request');
  assert.equal(api.state.sandboxMode, 'workspace-write');
});

test('pull refresh indicator keeps readable themed colors', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.pull-refresh-indicator\s*\{[^}]*background:\s*var\(--panel\);/su);
  assert.match(styles, /\.pull-refresh-indicator\s*\{[^}]*color:\s*var\(--text\);/su);
  assert.doesNotMatch(styles, /\.pull-refresh-indicator\s*\{[^}]*background:\s*rgba\(18,\s*23,\s*34/su);
});

test('new session path entry and primary submit buttons are readable on mobile', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /<textarea id="new-cwd-input"[^>]*name="cwd"[^>]*rows="3"/u);
  assert.doesNotMatch(app, /<input id="new-cwd-input"[^>]*type="text"/u);
  assert.match(styles, /\.new-session-page \.panel\s*\{[^}]*width:\s*100%;/su);
  assert.match(styles, /\.new-session-page textarea\s*\{[^}]*min-height:\s*92px;/su);
  assert.match(styles, /\.new-session-page textarea\s*\{[^}]*resize:\s*vertical;/su);
  assert.match(styles, /\.primary-action\s*\{[^}]*min-height:\s*48px;/su);
  assert.match(app, /<button class="primary primary-action" type="submit">Start<\/button>/u);
  assert.match(app, /<button class="primary primary-action" type="submit">Log in<\/button>/u);
});

test('danger buttons use theme-aware readable colors', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.danger\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--danger\) 58%,\s*var\(--border\)\);/su);
  assert.match(styles, /\.danger\s*\{[^}]*color:\s*var\(--danger\);/su);
  assert.doesNotMatch(styles, /\.danger\s*\{[^}]*color:\s*#ffd9d9;/su);
});

test('sessions without saved settings use app default thread settings', async () => {
  const { api } = await loadAppHarness();

  api.applyDefaultThreadSettings({
    model: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    collaborationMode: 'plan',
    accessPreset: 'read-only',
  });

  api.applySessionSettings({ id: 'thread_without_settings', settings: {} });

  assert.equal(api.state.model, 'gpt-5.4-mini');
  assert.equal(api.state.reasoningEffort, 'low');
  assert.equal(api.state.collaborationMode, 'plan');
  assert.equal(api.state.permissionPreset, 'read-only');
  assert.equal(api.state.approvalPolicy, 'never');
  assert.equal(api.state.sandboxMode, 'read-only');
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

test('running turns keep message sending available and move stop into settings', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">/u);
  assert.doesNotMatch(app, /<textarea id="prompt-input"[^>]*state\.pendingTurn \? 'disabled'/u);
  assert.match(app, /id="send-button"/u);
  assert.doesNotMatch(app, /id="\$\{state\.pendingTurn \? 'stop-button' : 'send-button'\}"/u);
  assert.match(app, /renderStopTurnControl\(\)/u);
  assert.match(app, /id="stop-button"/u);
  assert.match(app, /function onComposerSubmit\(event\)[\s\S]*const text = state\.prompt\.trim\(\);/u);
  assert.doesNotMatch(app, /function onComposerSubmit\(event\)\s*\{[\s\S]{0,180}if \(state\.pendingTurn\)/u);
});

test('composer can submit a new message while a turn is already running', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ turnId: 'turn_2' }),
        };
      }
      if (path === '/api/turns/turn_2/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_1';
  api.state.prompt = 'Follow-up while running';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.equal(fetchCalls[0]?.path, '/api/sessions/session_1/turns');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_2');
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Follow-up while running/u);
});

test('settings drawer exposes runtime reload and posts to the runtime endpoint', async () => {
  const app = await readFile(appUrl, 'utf8');
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/runtime/reload') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, mcpServersReloaded: true }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  assert.match(app, /id="runtime-reload-button"/u);
  assert.match(app, /function reloadRuntime\(\)/u);
  assert.match(app, /apiFetch\('\/api\/runtime\/reload',\s*\{\s*method:\s*'POST'\s*\}\)/su);

  api.state.token = 'token';

  await api.reloadRuntime();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.path, '/api/runtime/reload');
  assert.equal(fetchCalls[0]?.options.method, 'POST');
  assert.equal(api.state.status, 'Runtime reloaded');
  assert.equal(api.state.statusTone, 'success');
});

test('settings drawer opens without changing chat scroll geometry', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /function toggleSettingsDrawer\(\)/u);
  assert.match(app, /withTimelineScrollPreserved\(\(\) => render\(\)\)/u);
  assert.match(app, /settingsToggle\.addEventListener\('click', toggleSettingsDrawer\)/u);
  assert.match(styles, /\.composer\s*\{[^}]*position:\s*relative;/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*bottom:\s*calc\(100% \+ 8px\);/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*max-height:\s*min\(52dvh,\s*420px\);/su);
  assert.match(styles, /\.settings-drawer\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.doesNotMatch(styles, /\.settings-drawer\s*\{[^}]*margin-bottom:/su);
});

test('chat and session list use separate scroll containers', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /html,\s*body\s*\{[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /#app\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.screen\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.timeline\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.timeline\s*\{[^}]*overscroll-behavior:\s*contain;/su);
  assert.match(styles, /\.session-list,\s*\.new-session-page,\s*\.app-settings-page\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.session-list,\s*\.new-session-page,\s*\.app-settings-page\s*\{[^}]*overscroll-behavior:\s*contain;/su);
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

test('opening a session renders from the list summary before the detail request finishes', async () => {
  let resolveFetch;
  const detailReady = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path !== '/api/sessions/session_slow') {
        throw new Error(`Unexpected fetch ${path}`);
      }
      await detailReady;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_slow',
            cwd: '/repo',
            settings: { metadata: {} },
            thread: {
              turns: [
                {
                  id: 'turn_1',
                  items: [
                    { type: 'message', role: 'user', text: 'Loaded detail' },
                    { type: 'message', role: 'assistant', text: 'Detail answer' },
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
  api.state.sessions = [{
    id: 'session_slow',
    cwd: '/repo',
    firstUserInput: 'Summary prompt',
    settings: { metadata: {} },
  }];

  const opened = api.selectSession('session_slow');
  await Promise.resolve();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_slow');
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Summary prompt/u);

  resolveFetch();
  await opened;

  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Detail answer/u);
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
  assert.match(app, /function renderComposerStatus\(\)/u);
  assert.match(app, /composer-status/u);
  assert.match(app, /<div class="composer-wrap">\s*\$\{renderComposerStatus\(\)\}\s*<form class="composer"/u);
  assert.doesNotMatch(app, /----- \$\{escapeHtml\(composerStatusLabel\(\)\)\} -----/u);
  assert.doesNotMatch(app, /Turn started/u);
  assert.doesNotMatch(app, /Turn completed/u);
  assert.doesNotMatch(app, /id="session-select"/u);
  assert.doesNotMatch(app, /id="cwd-input"/u);
  assert.doesNotMatch(app, /renderSessionOptions/u);
});

test('composer status renders a small bottom status separator', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  assert.match(api.renderComposerStatus(), /composer-status/u);
  assert.match(api.renderComposerStatus(), /<span>Running<\/span>/u);
  assert.doesNotMatch(api.renderComposerStatus(), /----- Running -----/u);

  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  assert.match(api.renderComposerStatus(), /<span>Done<\/span>/u);
});

test('composer status separator uses continuous css rules outside the message box', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer-status::before,\s*\.composer-status::after\s*\{[^}]*flex:\s*1;/su);
  assert.match(styles, /\.composer-status::before,\s*\.composer-status::after\s*\{[^}]*border-top:\s*1px solid currentColor;/su);
  assert.match(styles, /\.composer-status\s*\{[^}]*width:\s*min\(40%,\s*288px\);/su);
  assert.match(styles, /\.composer-status span\s*\{/u);
});

test('assistant messages render markdown while user messages stay plain text', async () => {
  const { api } = await loadAppHarness();

  const assistantHtml = api.renderTimelineItem({
    id: 'assistant_1',
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    meta: 'final',
    text: '## Done\n\n- item with **bold** and `code`\n\n```sh\nnpm test\n```',
  });
  assert.match(assistantHtml, /<div class="message-text markdown-body">/u);
  assert.match(assistantHtml, /<h2>Done<\/h2>/u);
  assert.match(assistantHtml, /<li>item with <strong>bold<\/strong> and <code>code<\/code><\/li>/u);
  assert.match(assistantHtml, /<pre><code>npm test\n<\/code><\/pre>/u);

  const userHtml = api.renderTimelineItem({
    id: 'user_1',
    kind: 'message',
    role: 'user',
    label: 'You',
    meta: 'pending',
    text: '**do not render**',
  });
  assert.match(userHtml, /<p class="message-text">\*\*do not render\*\*<\/p>/u);
});

test('work items summarize commands edits reads and approvals in a collapsible block', async () => {
  const { api } = await loadAppHarness();

  const work = {
    id: 'work_turn_1',
    kind: 'work',
    turnId: 'turn_1',
    status: 'running',
    batches: [
      {
        batchId: 'batch_read',
        batchKind: 'command',
        title: 'rg -n "hydrateTimeline" packages/codex-web/public/app.js',
        status: 'completed',
        summary: { cwd: '/repo' },
      },
      {
        batchId: 'batch_test',
        batchKind: 'command',
        title: 'npm run test --workspace packages/codex-web -- public_ui.test.ts',
        status: 'completed',
        summary: { exitCode: 0 },
      },
      {
        batchId: 'batch_edit',
        batchKind: 'file_change',
        title: '2 file changes',
        status: 'completed',
        summary: {
          fileChanges: [
            { path: 'packages/codex-web/public/app.js' },
            { path: 'packages/codex-web/public/styles.css' },
          ],
        },
      },
    ],
    approvals: [
      {
        approvalId: 'approval_1',
        approvalKind: 'permission',
        resolved: true,
        summary: { command: 'npm install', decision: 'accepted' },
      },
    ],
  };

  const html = api.renderTimelineItem(work);

  assert.match(html, /<details class="card work-card" open/u);
  assert.match(html, /Work/u);
  assert.match(html, /Read 1/u);
  assert.match(html, /Ran 1/u);
  assert.match(html, /Edited 2/u);
  assert.match(html, /Approval 1/u);
  assert.match(html, /data-work-kind="read"/u);
  assert.match(html, /data-work-kind="command"/u);
  assert.match(html, /data-work-kind="edit"/u);
  assert.match(html, /packages\/codex-web\/public\/app\.js/u);
  assert.match(html, /npm run test --workspace packages\/codex-web -- public_ui\.test\.ts/u);
  assert.doesNotMatch(html, /<article class="card">\s*<div class="card-header">\s*<span class="card-title">npm run test/su);
});

test('work items expose detailed command output and file change metadata', async () => {
  const { api } = await loadAppHarness();

  const html = api.renderTimelineItem({
    id: 'work_turn_detail',
    kind: 'work',
    turnId: 'turn_detail',
    status: 'completed',
    batches: [
      {
        batchId: 'cmd_detail',
        batchKind: 'command',
        title: 'npm test',
        status: 'completed',
        summary: {
          command: 'npm test',
          cwd: '/workspace',
          output: '42 passing\n0 failing',
          exitCode: 0,
        },
      },
      {
        batchId: 'edit_detail',
        batchKind: 'file_change',
        title: 'Edited packages/codex-web/public/app.js',
        status: 'completed',
        summary: {
          fileChanges: [
            {
              path: 'packages/codex-web/public/app.js',
              action: 'modified',
              additions: 12,
              deletions: 3,
            },
          ],
        },
      },
    ],
    approvals: [],
  });

  assert.match(html, /<details class="work-detail" data-work-kind="command">/u);
  assert.doesNotMatch(html, /<details class="work-detail" open data-work-kind="command">/u);
  assert.match(html, /Command/u);
  assert.match(html, /npm test/u);
  assert.match(html, /42 passing/u);
  assert.match(html, /Exit Code/u);
  assert.match(html, /packages\/codex-web\/public\/app\.js/u);
  assert.match(html, /modified/u);
  assert.match(html, /\+12 \/ -3/u);
  assert.doesNotMatch(html, /No additional details/u);
});

test('work details stay collapsed until detailed activity is enabled in settings', async () => {
  const { api, storage } = await loadAppHarness();

  const work = {
    id: 'work_turn_detail_toggle',
    kind: 'work',
    turnId: 'turn_detail_toggle',
    status: 'running',
    batches: [
      {
        batchId: 'cmd_detail_toggle',
        batchKind: 'command',
        title: 'npm test',
        status: 'completed',
        summary: {
          command: 'npm test',
          cwd: '/workspace',
          output: '42 passing',
          raw: { method: 'item/completed' },
        },
      },
    ],
    approvals: [],
  };

  api.state.view = 'chat';
  api.state.settingsOpen = true;

  const collapsedHtml = api.renderTimelineItem(work);
  assert.match(collapsedHtml, /<details class="card work-card" open/u);
  assert.match(collapsedHtml, /<details class="work-detail" data-work-kind="command">/u);
  assert.doesNotMatch(collapsedHtml, /<details class="work-detail" open data-work-kind="command">/u);
  assert.doesNotMatch(collapsedHtml, /Raw Event/u);
  assert.match(api.renderSettingsDrawer(), /id="activity-detail-toggle"/u);

  api.setActivityDetailsEnabled(true);

  assert.equal(storage.get('codexWebActivityDetails'), 'true');
  const expandedHtml = api.renderTimelineItem(work);
  assert.match(expandedHtml, /<details class="work-detail" open data-work-kind="command">/u);
  assert.match(expandedHtml, /Raw Event/u);
  assert.match(expandedHtml, /item\/completed/u);
});

test('detailed activity renders raw SSE event payloads when enabled', async () => {
  const { api } = await loadAppHarness();

  api.setActivityDetailsEnabled(true);
  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_raw',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_raw',
    batchId: 'raw_batch',
    kind: 'command',
    title: 'npm test',
    raw: { method: 'item/started', params: { item: { id: 'raw_batch' } } },
  }, assistantEntry);

  const work = api.state.timeline.find((item) => item.id === 'work_turn_raw');
  const html = api.renderTimelineItem(work);

  assert.match(html, /Raw Event/u);
  assert.match(html, /item\/started/u);
  assert.match(html, /raw_batch/u);
});

test('turn failures render as visible timeline error messages', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_error',
    threadId: 'session_1',
  }, null);
  assistantEntry = api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_error',
    threadId: 'session_1',
    message: 'Codex app-server disconnected',
  }, assistantEntry);

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_error');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.match(errorItem?.text || '', /Codex app-server disconnected/u);

  const html = api.renderTimelineItem(errorItem);
  assert.match(html, /message-card system error-message/u);
  assert.match(html, /<span class="error-badge">Error<\/span>/u);
  assert.match(html, /Codex app-server disconnected/u);
});

test('stream failures render a visible timeline error instead of only composer status', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal_error', message: 'SSE failed hard' }),
    }),
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_stream_error';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;

  await api.streamTurnEvents('turn_stream_error');

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_stream_error');
  assert.equal(api.state.pendingTurn, false);
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /SSE failed hard/u);
});

test('thread work errors are highlighted and kept at the latest timeline position', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_work_error',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_work_error',
    threadId: 'session_1',
    text: 'Working...',
    phase: 'commentary',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_work_error',
    batchId: 'cmd_error',
    kind: 'command',
    title: 'npm test',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_work_error',
    batchId: 'cmd_error',
    summary: {
      command: 'npm test',
      output: '1 failing',
      error: 'Command failed with exit code 1',
      exitCode: 1,
    },
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_work_error',
    batchId: 'cmd_error',
    status: 'failed',
  }, assistantEntry);

  const latest = api.state.timeline.at(-1);
  assert.equal(latest?.kind, 'work');
  assert.equal(latest?.status, 'error');

  const html = api.renderTimelineItem(latest);
  assert.match(html, /work-card work-error/u);
  assert.match(html, /<span class="error-badge">Error<\/span>/u);
  assert.match(html, /Command failed with exit code 1/u);
  assert.match(html, /1 failing/u);
});

test('composer API failures render a visible timeline error', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            session: {
              id: 'session_new',
              cwd: '/repo',
              settings: {},
              thread: { turns: [] },
            },
          }),
        };
      }
      if (path === '/api/sessions/session_new/turns') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'internal_error', message: 'Codex refused the first turn' }),
        };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.cwd = '/repo';
  api.state.prompt = 'hello';

  await api.onComposerSubmit({ preventDefault() {} });

  const errorItem = api.state.timeline.find((item) => item.id.startsWith('error_'));
  assert.deepEqual(fetchCalls, ['/api/sessions', '/api/sessions/session_new/turns']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.match(errorItem?.text || '', /Codex refused the first turn/u);
});

test('turn events aggregate batches and approvals into one work item', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_1',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_1',
    batchId: 'batch_read',
    kind: 'command',
    title: 'sed -n "1,80p" packages/codex-web/public/app.js',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_1',
    batchId: 'batch_read',
    summary: { output: 'const state = {}' },
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.completed',
    turnId: 'turn_1',
    batchId: 'batch_read',
    status: 'completed',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'approval.requested',
    turnId: 'turn_1',
    approvalId: 'approval_1',
    approvalKind: 'permission',
    summary: { command: 'npm install' },
  }, assistantEntry);

  assert.equal(api.state.timeline.filter((item) => item.kind === 'work').length, 1);
  assert.equal(api.state.timeline.some((item) => item.kind === 'batch'), false);
  assert.equal(api.state.timeline.some((item) => item.kind === 'approval'), false);

  const work = api.state.timeline.find((item) => item.kind === 'work');
  assert.equal(work.turnId, 'turn_1');
  assert.equal(work.batches.length, 1);
  assert.equal(work.approvals.length, 1);
  assert.match(api.renderTimelineItem(work), /Read 1/u);
  assert.match(api.renderTimelineItem(work), /Approval 1/u);
});

test('work item stays visible at the bottom after assistant text completes', async () => {
  const { api } = await loadAppHarness();

  let assistantEntry = null;
  assistantEntry = api.applyTurnEvent({
    type: 'turn.started',
    turnId: 'turn_bottom',
    threadId: 'session_1',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.started',
    turnId: 'turn_bottom',
    batchId: 'cmd_bottom',
    kind: 'command',
    title: 'npm test',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'assistant.final',
    turnId: 'turn_bottom',
    threadId: 'session_1',
    text: 'Final response',
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'batch.updated',
    turnId: 'turn_bottom',
    batchId: 'cmd_bottom',
    summary: { output: 'ok' },
  }, assistantEntry);
  assistantEntry = api.applyTurnEvent({
    type: 'turn.completed',
    turnId: 'turn_bottom',
    threadId: 'session_1',
    status: 'completed',
  }, assistantEntry);

  assert.equal(api.state.timeline.at(-1)?.id, 'work_turn_bottom');
  assert.equal(api.state.timeline.at(-1)?.kind, 'work');
  assert.match(api.renderTimelineItem(api.state.timeline.at(-1)), /npm test/u);
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

test('session history defaults to two recent exchanges and expands older history on demand', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_history_expand',
    firstUserInput: 'Preview only',
    thread: {
      turns: [
        {
          id: 'turn_1',
          items: [
            { type: 'message', role: 'user', text: 'First user question' },
            { type: 'message', role: 'assistant', text: 'First assistant answer' },
          ],
        },
        {
          id: 'turn_2',
          items: [
            { type: 'message', role: 'user', text: 'Second user question' },
            { type: 'message', role: 'assistant', text: 'Second assistant answer' },
          ],
        },
        {
          id: 'turn_3',
          items: [
            { type: 'message', role: 'user', text: 'Third user question' },
            { type: 'message', role: 'assistant', text: 'Third assistant answer' },
          ],
        },
        {
          id: 'turn_4',
          items: [
            { type: 'message', role: 'user', text: 'Newest user question' },
            { type: 'message', role: 'assistant', text: 'Newest assistant answer' },
          ],
        },
      ],
    },
  };

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.restoreTimelineForSession(session);

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));
  assert.equal(api.state.sessionHistoryItems.length, 8);

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'First user question',
    'First assistant answer',
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
    'Newest user question',
    'Newest assistant answer',
  ]));
  assert.equal(api.showMoreSessionHistory(), false);
});

test('session list defaults to favorites and supports all sessions plus favorite actions', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /sortMode:\s*'favorites'/u);
  assert.match(app, /favoriteSortMode:\s*false/u);
  assert.match(app, /favoriteSortDraft:\s*\[\]/u);
  assert.match(app, /id="favorite-sort-button"/u);
  assert.match(app, /id="open-new-session-button"/u);
  assert.match(app, /id="open-app-settings-button"/u);
  assert.match(app, /id="favorite-sort-save-button"/u);
  assert.match(app, /id="favorite-sort-cancel-button"/u);
  assert.match(app, /data-sort-mode="favorites"/u);
  assert.match(app, /data-sort-mode="time"/u);
  assert.match(app, /data-sort-mode="time"[^>]*>All<\/button>/u);
  assert.doesNotMatch(app, />Time<\/button>/u);
  assert.doesNotMatch(app, /data-sort-mode="project"/u);
  assert.doesNotMatch(app, /renderProjectFilter\(\)/u);
  assert.doesNotMatch(app, /data-project-filter/u);
  assert.match(app, /function filteredSessions\(\)/u);
  assert.match(app, /function isFavoriteSession\(session\)/u);
  assert.match(app, /data-session-favorite-id/u);
  assert.match(app, /data-session-archive-request-id/u);
  assert.match(app, /function enterFavoriteSortMode\(\)/u);
  assert.match(app, /function saveFavoriteSortOrder\(\)/u);
  assert.match(app, /function cancelFavoriteSortMode\(\)/u);
  assert.match(app, /function toggleSessionFavorite\(sessionId\)/u);
  assert.match(app, /async function archiveSession\(sessionId\)/u);
  assert.match(app, /apiFetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`,\s*\{\s*method:\s*'DELETE'/su);
});

test('session topbar shows Sort only on Favorites and keeps New visually neutral', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'favorites';
  api.state.favoriteSortMode = false;
  const favoritesHtml = api.renderSessionList().innerHTML;

  assert.match(favoritesHtml, /id="favorite-sort-button"/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="favorite-sort-button"/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="open-new-session-button"/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="open-app-settings-button"/u);
  assert.doesNotMatch(favoritesHtml, /class="primary compact-button" type="button" id="open-new-session-button"/u);

  api.state.sortMode = 'time';
  api.state.favoriteSortMode = false;
  const allHtml = api.renderSessionList().innerHTML;

  assert.doesNotMatch(allHtml, /id="favorite-sort-button"/u);
  assert.match(allHtml, /class="ghost compact-button" type="button" id="open-new-session-button"/u);
  assert.match(allHtml, /class="ghost compact-button" type="button" id="open-app-settings-button"/u);
});

test('favorite filter shows only favorite sessions and all shows every session', async () => {
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

test('session list initially fetches only favorites and loads all sessions on demand', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions?favorite=true') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'favorite_session', favorite: true, settings: { metadata: {} } }],
          }),
        };
      }
      if (path === '/api/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'favorite_session', favorite: true, settings: { metadata: {} } },
              { id: 'time_session', favorite: false, settings: { metadata: {} } },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'favorites';

  await api.refreshSessionsList({ renderAfter: false });

  assert.deepEqual(fetchCalls, ['/api/sessions?favorite=true']);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session']));

  await api.setSessionSortMode('time');

  assert.deepEqual(fetchCalls, ['/api/sessions?favorite=true', '/api/sessions']);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session', 'time_session']));
});

test('session restore renders favorites first and preloads all sessions in the background', async () => {
  const pending: Array<{
    path: string;
    resolve: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => new Promise((resolve) => {
      pending.push({ path, resolve });
    }),
  });

  api.state.token = 'token';
  const restore = api.restoreAuth();
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me']);
  pending[0]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ session: { id: 'auth_1' } }),
  });
  await flushMicrotasks();

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/models', '/api/sessions?favorite=true']);
  pending[1]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ items: [] }),
  });
  pending[2]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{ id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } }],
    }),
  });
  await restore;
  await flushMicrotasks();

  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(api.state.sessionsScope, 'favorites');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session']));
  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/models', '/api/sessions?favorite=true', '/api/sessions']);

  pending[3]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } },
        { id: 'all_session', favorite: false, updatedAt: 30, settings: { metadata: {} } },
      ],
    }),
  });
  await flushMicrotasks();

  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(api.state.sessionsScope, 'favorites');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session']));
  assert.equal(JSON.stringify(api.state.sessionsByScope.all.map((session) => session.id)), JSON.stringify(['favorite_session', 'all_session']));

  await api.setSessionSortMode('time');

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/models', '/api/sessions?favorite=true', '/api/sessions']);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session', 'all_session']));
});

test('all tab does not show stale favorites while full sessions are loading', async () => {
  const pending: Array<{
    path: string;
    resolve: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
  }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => new Promise((resolve) => {
      pending.push({ path, resolve });
    }),
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sortMode = 'favorites';
  api.state.sessionsScope = 'favorites';
  api.state.sessions = [
    { id: 'old_favorite', favorite: true, updatedAt: 5, settings: { metadata: {} } },
  ];

  const favoritesRefresh = api.refreshSessionsList({ renderAfter: false, scope: 'favorites' });
  const timeSwitch = api.setSessionSortMode('time');

  assert.deepEqual(pending.map((request) => request.path), ['/api/sessions?favorite=true', '/api/sessions']);
  assert.equal(api.state.sortMode, 'time');
  assert.equal(api.state.sessionsLoading, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify([]));
  assert.match(api.renderSessionCards(), /Loading sessions/u);

  pending[0]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{ id: 'late_favorite', favorite: true, updatedAt: 10, settings: { metadata: {} } }],
    }),
  });
  await favoritesRefresh;

  assert.equal(api.state.sortMode, 'time');
  assert.equal(api.state.sessionsLoading, true);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify([]));

  pending[1]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } },
        { id: 'time_session', favorite: false, updatedAt: 30, settings: { metadata: {} } },
      ],
    }),
  });
  await timeSwitch;

  assert.equal(api.state.sessionsLoading, false);
  assert.equal(api.state.sessionsScope, 'all');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session', 'time_session']));
});

test('favorite sort mode drafts manual order and saves it explicitly', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      const body = JSON.parse(options.body || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: path.includes('session_b') ? 'session_b' : 'session_a',
            cwd: '/repo',
            favorite: true,
            favoriteOrder: body.favoriteOrder,
            updatedAt: 1,
            settings: { favoriteOrder: body.favoriteOrder, metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [
    { id: 'session_a', favorite: true, favoriteOrder: 20, updatedAt: 100, settings: { favoriteOrder: 20, metadata: {} } },
    { id: 'session_b', favorite: true, favoriteOrder: 10, updatedAt: 50, settings: { favoriteOrder: 10, metadata: {} } },
    { id: 'session_c', favorite: false, updatedAt: 200, settings: { metadata: {} } },
  ];

  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_b', 'session_a']));
  const normalHtml = api.renderSessionCards();
  assert.doesNotMatch(normalHtml, /data-session-favorite-move-id/u);
  assert.match(normalHtml, /data-session-favorite-id="session_a"/u);
  assert.match(normalHtml, /data-session-archive-request-id="session_a"/u);

  api.enterFavoriteSortMode();

  const sortHtml = api.renderSessionCards();
  assert.match(sortHtml, /data-session-favorite-move-id="session_a"/u);
  assert.match(sortHtml, /data-session-favorite-move="up"/u);
  assert.match(sortHtml, /data-session-favorite-move="down"/u);
  assert.doesNotMatch(sortHtml, /data-session-favorite-id="session_a"/u);
  assert.doesNotMatch(sortHtml, /data-session-archive-request-id="session_a"/u);

  await api.moveFavoriteSession('session_a', 'up');

  assert.equal(fetchCalls.length, 0);
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_a', 'session_b']));

  await api.saveFavoriteSortOrder();

  assert.deepEqual(fetchCalls.map((call) => ({
    path: call.path,
    body: JSON.parse(call.options.body),
  })), [
    { path: '/api/sessions/session_a/favorite', body: { favorite: true, favoriteOrder: 1 } },
    { path: '/api/sessions/session_b/favorite', body: { favorite: true, favoriteOrder: 2 } },
  ]);
  assert.equal(api.state.favoriteSortMode, false);
  assert.equal(JSON.stringify(api.state.favoriteSortDraft), JSON.stringify([]));
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_a', 'session_b']));
});

test('favorite sort save removes unavailable favorites and returns to the session list', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path.includes('session_missing')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'session_not_found', message: 'Unknown session' }),
        };
      }
      const body = JSON.parse(options.body || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_live',
            cwd: '/repo',
            favorite: true,
            favoriteOrder: body.favoriteOrder,
            updatedAt: 1,
            settings: { favorite: true, favoriteOrder: body.favoriteOrder, metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sortMode = 'favorites';
  api.state.sessions = [
    { id: 'session_missing', favorite: true, favoriteOrder: 1, settings: { favorite: true, favoriteOrder: 1, metadata: {} } },
    { id: 'session_live', favorite: true, favoriteOrder: 2, settings: { favorite: true, favoriteOrder: 2, metadata: {} } },
  ];
  api.state.sessionsByScope.favorites = [...api.state.sessions];

  api.enterFavoriteSortMode();
  await api.saveFavoriteSortOrder();

  assert.deepEqual(fetchCalls.map((call) => call.path), [
    '/api/sessions/session_missing/favorite',
    '/api/sessions/session_live/favorite',
  ]);
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.favoriteSortMode, false);
  assert.equal(JSON.stringify(api.state.favoriteSortDraft), JSON.stringify([]));
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_live']));
  assert.equal(JSON.stringify(api.state.sessionsByScope.favorites.map((session) => session.id)), JSON.stringify(['session_live']));
  assert.doesNotMatch(api.renderSessionCards(), /data-session-favorite-move-id/u);
  assert.match(api.renderSessionCards(), /data-session-favorite-id="session_live"/u);
});

test('favorite sort save treats missing rollout errors as unavailable sessions', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path.includes('session_missing')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'internal_error', message: 'no rollout found for thread id session_missing' }),
        };
      }
      const body = JSON.parse(options.body || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_live',
            cwd: '/repo',
            favorite: true,
            favoriteOrder: body.favoriteOrder,
            updatedAt: 1,
            settings: { favorite: true, favoriteOrder: body.favoriteOrder, metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sortMode = 'favorites';
  api.state.sessions = [
    { id: 'session_missing', favorite: true, favoriteOrder: 1, settings: { favorite: true, favoriteOrder: 1, metadata: {} } },
    { id: 'session_live', favorite: true, favoriteOrder: 2, settings: { favorite: true, favoriteOrder: 2, metadata: {} } },
  ];
  api.state.sessionsByScope.favorites = [...api.state.sessions];

  api.enterFavoriteSortMode();
  await api.saveFavoriteSortOrder();

  assert.deepEqual(fetchCalls.map((call) => call.path), [
    '/api/sessions/session_missing/favorite',
    '/api/sessions/session_live/favorite',
  ]);
  assert.equal(api.state.favoriteSortMode, false);
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_live']));
  assert.doesNotMatch(api.renderSessionCards(), /data-session-favorite-move-id/u);
});

test('favorite sort mode cancel restores the persisted order without patching', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.sessions = [
    { id: 'session_a', favorite: true, favoriteOrder: 20, updatedAt: 100, settings: { favoriteOrder: 20, metadata: {} } },
    { id: 'session_b', favorite: true, favoriteOrder: 10, updatedAt: 50, settings: { favoriteOrder: 10, metadata: {} } },
  ];

  api.enterFavoriteSortMode();
  await api.moveFavoriteSession('session_a', 'up');

  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_a', 'session_b']));

  api.cancelFavoriteSortMode();

  assert.equal(fetchCalls.length, 0);
  assert.equal(api.state.favoriteSortMode, false);
  assert.equal(JSON.stringify(api.state.favoriteSortDraft), JSON.stringify([]));
  assert.equal(JSON.stringify(api.sortedSessions().map((session) => session.id)), JSON.stringify(['session_b', 'session_a']));
});

test('session list shows loading state while sessions are still syncing', async () => {
  const { api } = await loadAppHarness();

  api.state.sessions = [];
  api.state.sortMode = 'time';
  api.state.sessionsLoading = true;

  assert.match(api.renderSessionCards(), /Loading sessions/u);

  api.state.sessionsLoading = false;
  assert.match(api.renderSessionCards(), /No sessions yet/u);
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
    favoriteOrder: 1,
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
  assert.doesNotMatch(app, /onRefresh:\s*\([^)]*\)\s*=>\s*window\.location\.reload\(\)/u);
  assert.match(pullRefresh, /window\.CodexPullToRefresh/u);
  assert.match(pullRefresh, /touchstart/u);
  assert.match(pullRefresh, /touchmove/u);
  assert.match(pullRefresh, /const DEFAULT_THRESHOLD = 112;/u);
});

test('PWA chat pull gestures expand timeline history while title pulls refresh the session', async () => {
  const [app, pullRefresh] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(pwaPullRefreshUrl, 'utf8'),
  ]);

  assert.match(pullRefresh, /startTarget/u);
  assert.match(pullRefresh, /getScrollContainer\(\{[\s\S]*target/su);
  assert.match(pullRefresh, /const target = startTarget/u);
  assert.match(pullRefresh, /onRefresh\(\{[\s\S]*target,/su);
  assert.match(app, /function handlePwaPullRefresh\(/u);
  assert.match(app, /function getActiveScrollContainer\(pull = \{\}\)/u);
  assert.match(app, /isTimelinePullTarget/u);
  assert.match(app, /showMoreSessionHistory\(\)/u);
  assert.match(app, /isChatTitlePullTarget/u);
  assert.match(app, /refreshCurrentView\(\)/u);
  assert.match(app, /onRefresh:\s*\(pull\)\s*=>\s*\{/u);
});

test('PWA refresh updates the current view instead of reloading the app', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions?favorite=true' || path === '/api/sessions') {
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
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['session_fresh']));

  api.state.view = 'chat';
  api.state.sessionId = 'session_fresh';
  api.state.currentSession = api.state.sessions[0];
  await api.refreshCurrentView();

  assert.deepEqual(fetchCalls, ['/api/sessions?favorite=true', '/api/sessions/session_fresh']);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Latest answer/u);
});

test('PWA foreground recovery refreshes session history and reconnects unhealthy turn streams', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/u);
  assert.match(app, /window\.addEventListener\('pageshow', onPageResume\)/u);
  assert.match(app, /window\.addEventListener\('focus', onPageResume\)/u);
  assert.match(app, /function onVisibilityChange\(\)/u);
  assert.match(app, /function onPageResume\(\)/u);
  assert.match(app, /state\.streamWasBackgrounded = true/u);
  assert.match(app, /function isTurnStreamHealthy\(\)/u);
  assert.match(app, /async function recoverActiveTurnAfterForeground\(\)/u);
  assert.match(app, /refreshCurrentSessionMetadata\(\{ hydrateTimeline: true \}\)/u);
  assert.match(app, /streamTurnEvents\(state\.turnId, \{ forceReconnect: true \}\)/u);
  assert.match(app, /lastTurnEventSequence/u);
  assert.match(app, /after=\$\{encodeURIComponent\(String\(state\.lastTurnEventSequence\)\)\}/u);
});

test('PWA stream network failures keep the active turn recoverable when visibility stays visible', async () => {
  const { api } = await loadAppHarness({
    fetch: async () => {
      throw new Error('Load failed');
    },
  });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.streamTurnEvents('turn_1');

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_1');
  assert.equal(api.state.streamWasBackgrounded, true);
  assert.equal(api.state.status, 'Stream paused');
});

test('PWA history refresh completes a paused active turn from session history', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from PWA' },
                      { type: 'message', role: 'assistant', text: 'Final answer from history' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.turnId = 'turn_1';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = true;
  api.state.timeline = [
    { id: 'local_user_1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Question from PWA' },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.streamWasBackgrounded, false);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Final answer from history/u);
});

test('session refresh restores running status when history reports an active turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_active',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Still working question' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_active/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  await api.refreshCurrentView();

  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_active');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn"><span>Running</span></div>');
  assert.ok(fetchCalls.includes('/api/turns/turn_active/events'));
});

test('opening a session restores running status when the session has an active turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_active') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_active',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_active',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Active question' },
                    ],
                  },
                ],
              },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_active/events') {
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => ({ done: true }),
            }),
          },
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_active', cwd: '/repo', settings: { metadata: {} } }];

  await api.selectSession('session_active');

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_active');
  assert.equal(api.state.status, 'Turn running');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn"><span>Running</span></div>');
  assert.ok(fetchCalls.includes('/api/turns/turn_active/events'));
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
        dataset: {},
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
      addEventListener() {},
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
  renderSessionCards: typeof renderSessionCards === 'function' ? renderSessionCards : null,
  renderSessionList: typeof renderSessionList === 'function' ? renderSessionList : null,
  renderTimelineItem: typeof renderTimelineItem === 'function' ? renderTimelineItem : null,
  renderComposerStatus: typeof renderComposerStatus === 'function' ? renderComposerStatus : null,
  hydrateTimelineFromSession,
  restoreTimelineForSession: typeof restoreTimelineForSession === 'function' ? restoreTimelineForSession : null,
  showMoreSessionHistory: typeof showMoreSessionHistory === 'function' ? showMoreSessionHistory : null,
  applySessionSettings: typeof applySessionSettings === 'function' ? applySessionSettings : null,
  updateSessionSettings: typeof updateSessionSettings === 'function' ? updateSessionSettings : null,
  collectSettings,
  refreshCurrentSessionMetadata,
  refreshSessionsList: typeof refreshSessionsList === 'function' ? refreshSessionsList : null,
  refreshCurrentView: typeof refreshCurrentView === 'function' ? refreshCurrentView : null,
  restoreAuth: typeof restoreAuth === 'function' ? restoreAuth : null,
  setSessionSortMode: typeof setSessionSortMode === 'function' ? setSessionSortMode : null,
  selectSession: typeof selectSession === 'function' ? selectSession : null,
  onComposerSubmit: typeof onComposerSubmit === 'function' ? onComposerSubmit : null,
  filteredSessions: typeof filteredSessions === 'function' ? filteredSessions : null,
  sortedSessions: typeof sortedSessions === 'function' ? sortedSessions : null,
  toggleSessionFavorite: typeof toggleSessionFavorite === 'function' ? toggleSessionFavorite : null,
  enterFavoriteSortMode: typeof enterFavoriteSortMode === 'function' ? enterFavoriteSortMode : null,
  saveFavoriteSortOrder: typeof saveFavoriteSortOrder === 'function' ? saveFavoriteSortOrder : null,
  cancelFavoriteSortMode: typeof cancelFavoriteSortMode === 'function' ? cancelFavoriteSortMode : null,
  moveFavoriteSession: typeof moveFavoriteSession === 'function' ? moveFavoriteSession : null,
	  reloadRuntime: typeof reloadRuntime === 'function' ? reloadRuntime : null,
	  applyTheme: typeof applyTheme === 'function' ? applyTheme : null,
	  applyDefaultThreadSettings: typeof applyDefaultThreadSettings === 'function' ? applyDefaultThreadSettings : null,
	  applyDefaultSettings: typeof applyDefaultSettings === 'function' ? applyDefaultSettings : null,
	  setActivityDetailsEnabled: typeof setActivityDetailsEnabled === 'function' ? setActivityDetailsEnabled : null,
	  renderSettingsDrawer: typeof renderSettingsDrawer === 'function' ? renderSettingsDrawer : null,
	  handleApiError: typeof handleApiError === 'function' ? handleApiError : null,
	  streamTurnEvents,
	  applyTurnEvent: typeof applyTurnEvent === 'function' ? applyTurnEvent : null,
	  saveCurrentTimeline,
	};`, context);
  return {
    api: context.__codexWebTest,
    storage,
    context,
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}
