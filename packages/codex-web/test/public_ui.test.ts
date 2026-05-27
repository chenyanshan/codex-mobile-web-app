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
  assert.match(app, /const APP_BUILD_ID = '__CODEX_WEB_BUILD_ID__';/u);
  assert.match(serviceWorker, /codex-web-static-__CODEX_WEB_BUILD_ID__/u);
  assert.doesNotMatch(app, /runtime-status-v37/u);
  assert.doesNotMatch(serviceWorker, /runtime-status-v37/u);
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

test('login form supports optional username for multi-user mode', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /name="username"/u);
  assert.match(app, /autocomplete="username"/u);
  assert.match(app, /const username = String\(form\.get\('username'\) \|\| ''\);/u);
  assert.match(app, /body: \{ username, password \}/u);
});

test('admin principals see a management entry in settings', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function isAdminPrincipal\(\)/u);
  assert.match(app, /id="open-admin-settings-button"/u);
  assert.match(app, /Admin Console/u);
});

test('restore auth also loads project display names for new sessions', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: { id: 'auth_1', principal: { userId: 'user_1', isAdmin: false } } }),
        };
      }
      if (path === '/api/models') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/projects') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: 'project_a', displayName: 'Project Alpha' }] }),
        };
      }
      if (path === '/api/sessions?favorite=true') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (path === '/api/reports') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';

  await api.restoreAuth();

  assert.equal(fetchCalls.includes('/api/projects'), true);
  assert.equal(JSON.stringify(api.state.projects), JSON.stringify([{ id: 'project_a', displayName: 'Project Alpha' }]));
  assert.equal(api.state.projectsLoaded, true);
});

test('new session form uses project display names and posts selected project id', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            session: {
              id: 'session_project',
              projectId: 'project_a',
              projectDisplayName: 'Project Alpha',
              settings: {},
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.projects = [
    { id: 'project_a', displayName: 'Project Alpha' },
    { id: 'project_b', displayName: 'Project Beta' },
  ];
  api.state.projectsLoaded = true;
  api.state.newProjectId = 'project_b';

  const html = api.renderNewSession().innerHTML;
  assert.match(html, /<label for="new-project-select">Project<\/label>/u);
  assert.match(html, /<option value="project_a"/u);
  assert.match(html, />Project Alpha<\/option>/u);
  assert.doesNotMatch(html, /new-cwd-input/u);

  await api.ensureSession();

  assert.equal(fetchCalls[0]?.path, '/api/sessions');
  assert.equal(JSON.stringify(JSON.parse(fetchCalls[0]?.options.body)), JSON.stringify({
    projectId: 'project_b',
    settings: api.collectSettings(),
  }));
});

test('admin console opens from settings and loads management overview', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/admin/settings') {
        return { ok: true, status: 200, json: async () => ({ settings: { multiUserEnabled: true } }) };
      }
      if (path === '/api/admin/projects') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'project_a', displayName: 'Project Alpha' }] }) };
      }
      if (path === '/api/admin/users') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'user_1', username: 'alice', enabled: true }] }) };
      }
      if (path === '/api/admin/roles') {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'role_user', name: 'User' }] }) };
      }
      if (path === '/api/admin/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: 'session_1', userId: 'user_1', projectDisplayName: 'Project Alpha' }] }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1', principal: { userId: 'admin', isAdmin: true } };

  await api.openAdminConsole();

  assert.equal(api.state.view, 'admin');
  assert.deepEqual(fetchCalls, [
    '/api/admin/settings',
    '/api/admin/projects',
    '/api/admin/users',
    '/api/admin/roles',
    '/api/admin/sessions',
  ]);
  const html = api.renderAdminConsole().innerHTML;
  assert.match(html, /Admin Console/u);
  assert.match(html, /Project Alpha/u);
  assert.match(html, /alice/u);
  assert.match(html, /session_1/u);
});

test('observer sessions and share sessions render read-only chat without composer actions', async () => {
  const [styles, { api }] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    loadAppHarness(),
  ]);

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_observed';
  api.state.currentSession = {
    id: 'session_observed',
    projectDisplayName: 'Project Alpha',
    mode: 'observer',
    readOnly: true,
  };

  const html = api.renderChat().innerHTML;

  assert.match(html, /read-only-banner/u);
  assert.match(html, /Observer mode/u);
  assert.doesNotMatch(html, /id="prompt-input"/u);
  assert.doesNotMatch(html, /id="send-button"/u);
  assert.doesNotMatch(html, /id="settings-toggle"/u);
  assert.match(styles, /\.read-only-banner\s*\{[^}]*display:\s*flex;/su);
  assert.match(styles, /\.read-only-banner\s*\{[^}]*border:\s*1px solid var\(--border\);/su);
});

test('share routes load public session history without auth and render read-only', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    pathname: '/share/cws_public_token',
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/share/cws_public_token/session') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'share',
            session: {
              id: 'session_shared',
              projectDisplayName: 'Project Alpha',
              timeline: [
                { id: 'm1', kind: 'message', role: 'user', label: 'User', meta: 'history', text: 'Shared question' },
                { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Shared answer' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  await api.loadSharedSessionFromLocation();

  assert.deepEqual(fetchCalls, ['/api/share/cws_public_token/session']);
  assert.equal(api.state.authSession?.principal?.mode, 'share');
  assert.equal(api.state.token, '');
  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.currentSession.readOnly, true);
  const html = api.renderChat().innerHTML;
  assert.match(html, /Shared answer/u);
  assert.match(html, /Shared link/u);
  assert.doesNotMatch(html, /id="prompt-input"/u);
});

test('admin console uses dense mobile-safe management rows', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.admin-console-page\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.admin-list\s*\{[^}]*display:\s*grid;/su);
  assert.match(styles, /\.admin-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su);
  assert.match(styles, /\.admin-row-main\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(styles, /\.admin-session-open\s*\{[^}]*text-align:\s*left;/su);
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

  api.applyMessageFontSize('small');
  assert.equal(storage.get('codexWebMessageFontSize'), 'small');
  assert.equal(context.document.documentElement.dataset.messageFontSize, 'small');

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
  assert.match(app, /id="composer-expand-button"/u);
  assert.match(app, /function updateComposerExpansionState\(textarea\)/u);
  assert.match(app, /function toggleComposerExpanded\(\)/u);
  assert.match(app, /class="composer-wrap \$\{composerClassName\}"/u);
  assert.match(app, /class="composer \$\{composerClassName\}"/u);
  assert.match(app, /class="message-editor-shell \$\{composerClassName\}"/u);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*min-height:\s*38px;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*max-height:\s*116px;/su);
  assert.match(styles, /\.compact-composer-row textarea\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.composer\.is-expanded\s*\{/su);
  assert.match(styles, /\.message-editor-shell\s*\{[^}]*position:\s*relative;/su);
  assert.doesNotMatch(styles, /\.message-editor-shell\[data-editor-toggle-visible=/u);
  assert.doesNotMatch(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*padding-left:/su);
  assert.doesNotMatch(styles, /\.composer-editor-toggle/u);
  assert.match(styles, /\.composer-leading-controls\s*\{[^}]*gap:\s*6px;/su);
  assert.match(styles, /\.icon-button\[hidden\]\s*\{[^}]*display:\s*none;/su);
  assert.match(styles, /\.icon-button,\s*\.compact-send\s*\{[^}]*min-height:\s*38px;/su);
  assert.match(styles, /\.icon-button,\s*\.compact-send\s*\{[^}]*padding:\s*0 8px;/su);
  assert.match(app, /function autoGrowPromptInput\(textarea\)/u);
  assert.match(app, /textarea\.style\.height = 'auto';/u);
  assert.match(app, /if \(state\.composerExpanded\) \{\s*textarea\.style\.height = '';\s*return;\s*\}/u);
  assert.match(app, /PROMPT_TEXTAREA_MAX_HEIGHT/u);
  assert.match(app, /PROMPT_EXPAND_LINE_THRESHOLD/u);
  assert.match(app, /Math\.min\(textarea\.scrollHeight, maxHeight\)/u);
  assert.match(app, /Math\.max\(38, nextHeight\)/u);
  assert.match(app, /autoGrowPromptInput\(promptInput\)/u);
  assert.match(styles, /\.composer\.is-expanded\s*\{[^}]*min-height:\s*min\(84dvh,\s*640px\);/su);
  assert.doesNotMatch(styles, /\.composer\.is-expanded \.compact-composer-row textarea\s*\{[^}]*min-height:\s*min\(72dvh,\s*560px\);/su);
  assert.doesNotMatch(styles, /\.composer\.is-expanded \.compact-composer-row textarea\s*\{[^}]*max-height:\s*min\(72dvh,\s*560px\);/su);
});

test('composer shows external expand above Set and expanded editor wraps collapse textarea and Send', async () => {
  const { api } = await loadAppHarness();

  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.composerCanExpand = false;
  api.state.composerExpanded = false;

  const shortHtml = api.renderChat().innerHTML;
  assert.match(shortHtml, /id="settings-toggle"[^>]*>Set<\/button>/u);
  assert.doesNotMatch(shortHtml, /id="settings-toggle"[^>]*hidden/u);
  assert.match(shortHtml, /id="composer-expand-button"[^>]*hidden/u);
  assert.match(shortHtml, /id="settings-toggle"[^>]*>Set<\/button>/u);
  assert.match(shortHtml, /class="message-editor-shell [^"]*"/u);
  assert.match(shortHtml, /<textarea id="prompt-input"[\s\S]*<button class="primary compact-send" type="submit" id="send-button">Send<\/button>/u);
  assert.match(shortHtml, /class="composer-wrap "/u);

  api.state.composerCanExpand = true;
  const compactHtml = api.renderChat().innerHTML;
  assert.match(compactHtml, /class="composer-wrap is-expandable"/u);
  assert.match(compactHtml, /class="composer is-expandable"/u);
  assert.match(compactHtml, /class="message-editor-shell is-expandable"/u);
  assert.match(compactHtml, /<div class="composer-leading-controls">[\s\S]*id="composer-expand-button"[\s\S]*\^<\/button>[\s\S]*id="settings-toggle"[^>]*>Set<\/button>[\s\S]*<\/div>/u);
  assert.doesNotMatch(compactHtml, /id="settings-toggle"[^>]*hidden/u);

  api.state.composerExpanded = true;
  api.state.settingsOpen = true;
  api.state.error = 'Failure stays available after collapsing';
  const expandedHtml = api.renderChat().innerHTML;

  assert.match(expandedHtml, /id="settings-toggle"[^>]*hidden/u);
  assert.doesNotMatch(expandedHtml, /settings-drawer/u);
  assert.doesNotMatch(expandedHtml, /composer-status/u);
  assert.doesNotMatch(expandedHtml, /composer-error/u);
  assert.match(expandedHtml, /class="composer-wrap is-expanded"/u);
  assert.match(expandedHtml, /class="composer is-expanded"/u);
  assert.match(expandedHtml, /<div class="composer-leading-controls">[\s\S]*id="composer-expand-button"[\s\S]*v<\/button>[\s\S]*id="settings-toggle"[^>]*hidden/u);
  assert.match(expandedHtml, /<div class="message-editor-shell is-expanded"[\s\S]*<textarea id="prompt-input"[\s\S]*<button class="primary compact-send" type="submit" id="send-button">Send<\/button>[\s\S]*<\/div>/u);
  assert.match(expandedHtml, /<textarea id="prompt-input"[\s\S]*id="send-button"/u);
});

test('expanded composer positions collapse and Send inside a single editor surface', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer\.is-expanded\s*\{[^}]*padding:\s*0;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded\s*\{[^}]*position:\s*relative;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded\s*\{[^}]*min-height:\s*min\(84dvh,\s*640px\);/su);
  assert.match(styles, /\.composer\.is-expanded \.composer-leading-controls #composer-expand-button\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /\.composer\.is-expanded \.composer-leading-controls #composer-expand-button\s*\{[^}]*top:\s*0;/su);
  assert.match(styles, /\.composer\.is-expanded \.composer-leading-controls #composer-expand-button\s*\{[^}]*left:\s*0;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*height:\s*100%;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*border-color:\s*transparent;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded textarea\s*\{[^}]*padding:\s*54px 12px 58px;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded \.compact-send\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded \.compact-send\s*\{[^}]*right:\s*8px;/su);
  assert.match(styles, /\.message-editor-shell\.is-expanded \.compact-send\s*\{[^}]*bottom:\s*8px;/su);
  assert.doesNotMatch(styles, /\.composer\.is-expanded \.compact-composer-row textarea\s*\{[^}]*max-height:\s*min\(72dvh,\s*560px\);/su);
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

test('composer restores the prompt and reconnects when backend reports an active turn conflict', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'turn_conflict',
            message: 'Session session_1 already has an active turn (turn_active).',
            activeTurnId: 'turn_active',
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
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_old';
  api.state.prompt = 'Follow-up while running';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.deepEqual(fetchCalls.map((call) => call.path), [
    '/api/sessions/session_1/turns',
    '/api/turns/turn_active/events',
  ]);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.turnId, 'turn_active');
  assert.equal(api.state.prompt, 'Follow-up while running');
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.state.timeline.map((item) => item.text || '').join('\n'), /Follow-up while running/u);
});

test('composer renders handled goal slash command results without streaming a turn', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_goal/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            type: 'command',
            command: {
              name: 'goal',
              action: 'resume',
              message: 'Goal resumed: ship slash goal support',
              goal: {
                threadId: 'session_goal',
                objective: 'ship slash goal support',
                status: 'active',
              },
            },
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'command_user_resume', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
              ],
              thread: { turns: [] },
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
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };
  api.state.prompt = '/goal resume';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_goal/turns']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.deepEqual(api.state.timeline.map((item) => item.text), [
    '/goal resume',
    'Goal resumed: ship slash goal support',
  ]);
});

test('goal command completion ignores stale stream load failures from a previous running turn', async () => {
  const fetchCalls = [];
  let rejectStaleFetch = null;
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_goal/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            type: 'command',
            command: {
              name: 'goal',
              action: 'resume',
              message: 'Goal resumed: ship slash goal support',
              goal: {
                threadId: 'session_goal',
                objective: 'ship slash goal support',
                status: 'active',
              },
            },
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'command_user_resume', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
              ],
              thread: { turns: [] },
            },
          }),
        };
      }
      if (path === '/api/turns/turn_stale/events') {
        return await new Promise((_resolve, reject) => {
          rejectStaleFetch = () => reject(new Error('Load failed'));
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';
  api.state.prompt = '/goal resume';

  const staleStreamPromise = api.streamTurnEvents('turn_stale');

  await api.onComposerSubmit({
    preventDefault() {},
  });

  assert.equal(typeof rejectStaleFetch, 'function');
  rejectStaleFetch();
  await staleStreamPromise;

  assert.deepEqual(fetchCalls.slice(0, 2), [
    '/api/turns/turn_stale/events',
    '/api/sessions/session_goal/turns',
  ]);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.state.timeline.map((item) => item.text || '').join('\n'), /Load failed/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Goal resumed: ship slash goal support/u);
});

test('composer renders handled help slash command results with report links', async () => {
  const fetchCalls = [];
  const reportPath = '/Users/chenyanshan/.codex-web/reports/codex-mobile-web-app/2026-05-22/codex-web-help.md';
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/sessions/session_help/turns') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            type: 'command',
            command: {
              name: 'help',
              action: 'show',
              message: [
                '支持的命令：',
                '- `/help`',
                '- `/goal`',
                `完整说明：[Codex Web 帮助文档](${reportPath})`,
              ].join('\n'),
              goal: null,
            },
            session: {
              id: 'session_help',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'command_user_help', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/help' },
                {
                  id: 'command_help_show',
                  kind: 'message',
                  role: 'system',
                  label: '/help',
                  meta: 'show',
                  text: [
                    '支持的命令：',
                    '- `/help`',
                    '- `/goal`',
                    `完整说明：[Codex Web 帮助文档](${reportPath})`,
                  ].join('\n'),
                },
              ],
              thread: { turns: [] },
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
  api.state.sessionId = 'session_help';
  api.state.currentSession = { id: 'session_help', cwd: '/repo' };
  api.state.prompt = '/help';

  await api.onComposerSubmit({
    preventDefault() {},
  });

  const latest = api.state.timeline.at(-1);
  const html = api.renderTimelineItem(latest);
  assert.deepEqual(fetchCalls.map((call) => call.path), ['/api/sessions/session_help/turns']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(latest?.role, 'system');
  assert.equal(latest?.label, '/help');
  assert.match(html, /<code>\/help<\/code>/u);
  assert.match(html, /data-report-path="\/Users\/chenyanshan\/\.codex-web\/reports\/codex-mobile-web-app\/2026-05-22\/codex-web-help\.md"/u);
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

test('chat settings drawer no longer exposes activity detail controls', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.doesNotMatch(app, /activity-detail-toggle/u);
  assert.doesNotMatch(app, /Activity details/u);
  assert.doesNotMatch(app, /function setActivityDetailsEnabled\(/u);
  assert.doesNotMatch(styles, /\.settings-toggle-row/u);
});

test('app settings page exposes message font size controls scoped to chat messages', async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(app, /const MESSAGE_FONT_SIZE_KEY = 'codexWebMessageFontSize';/u);
  assert.match(app, /function renderAppSettings\(\)[\s\S]*data-message-font-size="small"[\s\S]*data-message-font-size="medium"[\s\S]*data-message-font-size="large"/u);
  assert.doesNotMatch(app, /function renderSettingsDrawer\(\)[\s\S]*data-message-font-size="small"/u);
  assert.match(app, /for \(const button of document\.querySelectorAll\('\[data-message-font-size\]'\)\)/u);
  assert.match(styles, /\.message-card \.message-text,\s*\.message-card \.markdown-body\s*\{[^}]*font-size:\s*var\(--message-font-size\);/su);
  assert.match(styles, /\.message-card \.markdown-body h1,\s*\.message-card \.markdown-body h2,\s*\.message-card \.markdown-body h3\s*\{[^}]*font-size:\s*var\(--message-heading-font-size\);/su);
  assert.doesNotMatch(styles, /\.report-document\s*\{[^}]*font-size:\s*var\(--message-font-size\);/su);
});

test('message font size loads from storage and applies root variables', async () => {
  const { api, storage, context } = await loadAppHarness({
    storage: {
      codexWebMessageFontSize: 'large',
    },
  });

  const styleCalls = [];
  context.document.documentElement.style.setProperty = (name, value) => {
    styleCalls.push([name, value]);
  };

  api.applyMessageFontSize(api.state.messageFontSize, { persist: false });

  assert.equal(api.state.messageFontSize, 'large');
  assert.equal(storage.get('codexWebMessageFontSize'), 'large');
  assert.equal(context.document.documentElement.dataset.messageFontSize, 'large');
  assert.deepEqual(styleCalls, [
    ['--message-font-size', '17px'],
    ['--message-heading-font-size', '16px'],
  ]);
});

test('changing message font size preserves timeline bottom offset', async () => {
  const { api, storage, context } = await loadAppHarness();

  let fontApplied = false;
  const timeline = {
    _scrollTop: 420,
    clientHeight: 500,
    get scrollTop() {
      return this._scrollTop;
    },
    set scrollTop(value) {
      this._scrollTop = value;
    },
    get scrollHeight() {
      return fontApplied ? 1180 : 1000;
    },
  };
  const appElement = context.document.querySelector('#app');
  context.document.documentElement.style.setProperty = (name) => {
    if (name === '--message-font-size') {
      fontApplied = true;
    }
  };
  context.document.querySelector = (selector) => {
    if (selector === '#timeline') {
      return timeline;
    }
    if (selector === '#app') {
      return appElement;
    }
    return null;
  };

  api.setMessageFontSize('large');

  assert.equal(api.state.messageFontSize, 'large');
  assert.equal(storage.get('codexWebMessageFontSize'), 'large');
  assert.equal(timeline.scrollTop, 600);
});

test('prompt focus protection keeps timeline scroll anchored during keyboard reflow', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /promptInput\.addEventListener\('touchstart',\s*syncPromptFocusLayout,\s*\{\s*passive:\s*true\s*\}\)/u);
  assert.match(app, /promptInput\.addEventListener\('focus',\s*syncPromptFocusLayout\)/u);
  assert.match(app, /function scheduleTimelineViewportRestore\(/u);
});

test('prompt focus refreshes textarea layout before input changes', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /function syncPromptFocusLayout\(eventOrTextarea\)/u);
  assert.match(app, /function syncPromptInputLayout\(textarea\)/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*protectPromptFocusScroll\(\)/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*syncPromptInputLayout\(textarea\)/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*requestAnimationFrame\(\(\) => \{\s*syncPromptInputLayout\(textarea\);/u);
  assert.match(app, /syncPromptFocusLayout[\s\S]*promptFocusLayoutTimer = setTimeout\(\(\) => \{[\s\S]*syncPromptInputLayout\(textarea\);/u);
  assert.match(app, /promptFocusLayoutTimer/u);
  assert.match(app, /syncPromptInputLayout\(event\.target\);/u);
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

test('report viewer uses its own scroll container instead of the outer document', async () => {
  const { api, context } = await loadAppHarness();
  const appRoot = { innerHTML: '', appendChild() {} };
  const reportViewer = { id: 'report-viewer' };
  const documentScroll = { id: 'document-scroll' };

  api.state.view = 'report';
  context.document.scrollingElement = documentScroll;
  context.document.querySelector = (selector) => {
    if (selector === '.report-viewer') {
      return reportViewer;
    }
    if (selector === '#app') {
      return appRoot;
    }
    return null;
  };

  assert.equal(api.getActiveScrollContainer({}), reportViewer);
});

test('desktop workspace CSS creates a two-pane layout on computer windows at 820px', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /@media \(min-width:\s*820px\) and \(hover:\s*hover\) and \(pointer:\s*fine\)/u);
  assert.match(styles, /\.desktop-workspace\s*\{[^}]*display:\s*grid;/su);
  assert.match(styles, /\.desktop-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*340px\) minmax\(0,\s*1fr\);/su);
  assert.match(styles, /\.desktop-sidebar\s*\{[^}]*overflow:\s*hidden;/su);
  assert.match(styles, /\.desktop-session-list\s*\{[^}]*overflow-y:\s*auto;/su);
  assert.match(styles, /\.desktop-chat-pane\s*\{[^}]*position:\s*relative;/su);
});

test('desktop composer is anchored inside the right chat pane', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /@media \(min-width:\s*820px\) and \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*position:\s*absolute;/su);
  assert.match(styles, /@media \(min-width:\s*820px\) and \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*left:\s*0;/su);
  assert.match(styles, /@media \(min-width:\s*820px\) and \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*\.desktop-chat-pane \.composer-wrap\s*\{[^}]*right:\s*0;/su);
  assert.match(styles, /@media \(min-width:\s*820px\) and \(hover:\s*hover\) and \(pointer:\s*fine\)[\s\S]*\.desktop-chat-pane \.timeline\s*\{[^}]*padding-bottom:\s*var\(--composer-offset\);/su);
});

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

test('composer bottom gap stays tight above the keyboard safe area', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer-wrap\s*\{[^}]*padding:\s*6px 10px calc\(env\(safe-area-inset-bottom,\s*0px\) \+ 4px\);/su);
});

test('timeline follows the latest messages until the user scrolls upward', async () => {
  const { api, context } = await loadAppHarness();
  const timeline = {
    _scrollTop: 800,
    clientHeight: 200,
    scrollHeight: 1000,
    get scrollTop() {
      return this._scrollTop;
    },
    set scrollTop(value) {
      this._scrollTop = value;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const appElement = context.document.querySelector('#app');
  context.document.querySelector = (selector) => {
    if (selector === '#timeline') {
      return timeline;
    }
    if (selector === '#app') {
      return appElement;
    }
    return null;
  };

  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'latest' }];

  api.attachTimelineScrollTracking();
  api.state.timeline.push({ id: 'm2', kind: 'message', role: 'assistant', text: 'new latest' });
  api.scrollTimelineToBottomIfFollowingLatest();
  assert.equal(timeline.scrollTop, 1000);

  timeline.scrollHeight = 1200;
  timeline._scrollTop = 700;
  api.updateTimelineFollowState();
  api.state.timeline.push({ id: 'm3', kind: 'message', role: 'assistant', text: 'should not snap' });
  api.scrollTimelineToBottomIfFollowingLatest();
  assert.equal(timeline.scrollTop, 700);
});

test('composer expand toggle stays hidden at two lines and appears at four lines', async () => {
  const { api, context } = await loadAppHarness();
  let expandButtonHidden = true;
  const textarea = {
    scrollHeight: 62,
    style: {},
  };
  const expandButton = {
    textContent: '',
    hidden: true,
    setAttribute() {},
    get hidden() {
      return expandButtonHidden;
    },
    set hidden(value) {
      expandButtonHidden = Boolean(value);
    },
  };

  context.window.getComputedStyle = () => ({
    lineHeight: '23px',
    paddingTop: '8px',
    paddingBottom: '8px',
  });
  const originalQuerySelector = context.document.querySelector;
  context.document.querySelector = (selector) => {
    if (selector === '#composer-expand-button') {
      return expandButton;
    }
    return originalQuerySelector(selector);
  };

  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, false);
  assert.equal(expandButton.hidden, true);

  textarea.scrollHeight = 108;
  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, true);
  assert.equal(expandButton.hidden, false);
});

test('composer expansion threshold ignores textarea padding when counting lines', async () => {
  const { api, context } = await loadAppHarness();
  const textarea = {
    scrollHeight: 56,
    style: {},
  };

  context.window.getComputedStyle = () => ({
    lineHeight: '16px',
    paddingTop: '12px',
    paddingBottom: '12px',
  });

  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, false);

  textarea.scrollHeight = 88;
  api.updateComposerExpansionState(textarea);
  assert.equal(api.state.composerCanExpand, true);
});

test('composer expansion state changes do not re-render the whole chat while typing', async () => {
  const app = await readFile(appUrl, 'utf8');
  const updateComposerExpansionState = app.match(/function updateComposerExpansionState\(textarea\)\s*\{[\s\S]*?\n\}/u)?.[0] || '';

  assert.ok(updateComposerExpansionState.length > 0);
  assert.doesNotMatch(updateComposerExpansionState, /render\(\)/u);
});

test('session list scroll position is restored when returning from chat or refresh', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /let sessionListRestoreScrollTop = null;/u);
  assert.match(app, /function restoreSessionListScroll\(\)/u);
  assert.match(app, /function rememberSessionListScroll\(\)/u);
  assert.match(app, /if \(state\.view === 'sessions'\) \{\s*restoreSessionListScroll\(\);/u);
  assert.match(app, /showSessionList\(\) \{\s*saveCurrentTimeline\(\);[\s\S]*rememberSessionListScroll\(\);/u);
  assert.match(app, /for \(const button of document\.querySelectorAll\('\[data-session-id\]'\)\) \{\s*button\.addEventListener\('click', \(\) => \{\s*rememberSessionListScroll\(\);/u);
  assert.match(app, /function refreshCurrentView\(\)[\s\S]*rememberSessionListScroll\(\);[\s\S]*await refreshSessionsList/u);
});

test('chat render keeps the timeline at the latest content by default', async () => {
  const { api, context } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  api.state.timelineShouldFollowLatest = true;
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', text: 'Question' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Latest answer' },
  ];

  api.render();
  const timeline = context.document.querySelector('#timeline');

  assert.equal(timeline.scrollTop, timeline.scrollHeight);
  assert.equal(api.state.timelineShouldFollowLatest, true);
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
  assert.match(app, /<div class="composer-wrap \$\{composerClassName\}">\s*\$\{state\.composerExpanded \? '' : renderComposerStatus\(\)\}\s*<form class="composer \$\{composerClassName\}"/u);
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

  assert.match(api.renderComposerStatus(), /<div class="composer-status" data-tone="work"><span>Running<\/span><\/div>/u);
  assert.match(api.renderComposerStatus(), /<span>Running<\/span>/u);
  assert.doesNotMatch(api.renderComposerStatus(), /----- Running -----/u);

  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  assert.match(api.renderComposerStatus(), /<span>Done<\/span>/u);
});

test('chat header renders current goal state under the project title', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'paused',
    },
  };

  const html = api.renderChatContent();

  assert.match(html, /<div class="goal-status" data-status="paused">/u);
  assert.match(html, /Goal paused/u);
  assert.match(html, /ship goal status indicator/u);
});

test('chat header renders active, pause, and done goal statuses without calling them running', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'active',
    },
  };

  const activeHtml = api.renderChatContent();

  assert.match(activeHtml, /data-status="active"/u);
  assert.match(activeHtml, /Goal active/u);
  assert.doesNotMatch(activeHtml, /Goal running/u);

  api.state.currentSession.goal.status = 'pause';

  const pausedHtml = api.renderChatContent();

  assert.match(pausedHtml, /data-status="paused"/u);
  assert.match(pausedHtml, /Goal paused/u);
  assert.doesNotMatch(pausedHtml, /Goal running/u);

  api.state.currentSession.goal.status = 'done';

  const doneHtml = api.renderChatContent();

  assert.match(doneHtml, /data-status="done"/u);
  assert.match(doneHtml, /Goal done/u);
  assert.doesNotMatch(doneHtml, /Goal running/u);
});

test('goal status colors are distinct for each state', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.goal-status\[data-status="active"\]\s*\{[^}]*color:\s*var\(--success\);/su);
  assert.match(styles, /\.goal-status\[data-status="paused"\]\s*\{[^}]*color:\s*var\(--warn\);/su);
  assert.match(styles, /\.goal-status\[data-status="done"\]\s*\{[^}]*color:\s*var\(--info\);/su);
  assert.match(styles, /\.goal-status\[data-status="blocked"\]\s*\{[^}]*color:\s*var\(--danger\);/su);
  assert.match(styles, /\.goal-status\[data-status="unknown"\]\s*\{[^}]*color:\s*var\(--muted\);/su);
});

test('session summary updates do not clear a detailed current goal', async () => {
  const { api } = await loadAppHarness();

  api.state.sessionId = 'session_goal';
  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'active',
    },
  };
  api.state.sessions = [api.state.currentSession];

  api.upsertSession({ id: 'session_goal', cwd: '/repo', lastUserInput: 'new prompt' });

  assert.equal(api.state.currentSession.goal.objective, 'ship goal status indicator');
});

test('session detail updates can clear the current goal', async () => {
  const { api } = await loadAppHarness();

  api.state.sessionId = 'session_goal';
  api.state.currentSession = {
    id: 'session_goal',
    cwd: '/repo',
    goal: {
      threadId: 'session_goal',
      objective: 'ship goal status indicator',
      status: 'active',
    },
  };
  api.state.sessions = [api.state.currentSession];

  api.upsertSession({ id: 'session_goal', cwd: '/repo', goal: null });

  assert.equal(api.state.currentSession.goal, null);
});

test('composer status separator uses continuous css rules outside the message box', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.composer-status::before,\s*\.composer-status::after\s*\{[^}]*flex:\s*1;/su);
  assert.match(styles, /\.composer-status::before,\s*\.composer-status::after\s*\{[^}]*border-top:\s*1px solid currentColor;/su);
  assert.match(styles, /\.composer-status\s*\{[^}]*width:\s*min\(40%,\s*288px\);/su);
  assert.match(styles, /\.composer-status\[data-tone="work"\]\s*\{[^}]*color:\s*var\(--success\);/su);
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

test('work batches are cached for recovery without rendering timeline cards', async () => {
  const { api } = await loadAppHarness();

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

  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.state.batches.get('raw_batch')?.batchId, 'raw_batch');
  assert.equal(api.state.batches.get('raw_batch')?.summary?.raw?.method, 'item/started');
});

test('returning to sessions and back keeps the unsent prompt draft', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [{ id: 'session_1', cwd: '/repo', settings: { metadata: {} } }];
  api.state.prompt = 'unfinished draft';

  api.showSessionList();
  assert.equal(api.state.prompt, 'unfinished draft');

  await api.selectSession('session_1');
  assert.equal(api.state.prompt, 'unfinished draft');
});

test('session refresh while chat is open keeps the latest timeline position', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.doesNotMatch(app, /if \(state\.view === 'sessions' \|\| hydrateTimeline\)[\s\S]*scrollTimelineToBottom\(\);/u);
  assert.match(app, /if \(state\.sessionId === sessionId\) \{\s*renderChatWithTimelineRestored\(\(\) => \{\}\);\s*if \(hydrateTimeline && state\.view === 'chat'\) \{\s*scrollTimelineToBottomIfFollowingLatest\(\);/u);
});

test('turn events update the chat timeline without replacing the focused composer', async () => {
  const { api } = await loadAppHarness();

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'draft in progress';
  api.render();

  const promptInput = api.context.document.querySelector('#prompt-input');
  promptInput.focus();
  const originalAppRenderCount = api.context.__appRenderCount;
  const originalTimeline = api.context.document.querySelector('#timeline');

  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_1',
    text: 'hello',
    phase: 'streaming',
  }, null);

  assert.equal(api.context.__appRenderCount, originalAppRenderCount);
  assert.equal(api.context.document.activeElement, promptInput);
  assert.equal(api.context.document.querySelector('#prompt-input'), promptInput);
  assert.equal(api.context.document.querySelector('#timeline'), originalTimeline);
  assert.match(originalTimeline.innerHTML, /hello/u);
});

test('stream completion refreshes chat chrome without replacing the focused composer', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/turns/turn_1/events');
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => ({ done: true }),
          }),
        },
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.render();

  const promptInput = api.context.document.querySelector('#prompt-input');
  promptInput.focus();
  const originalAppRenderCount = api.context.__appRenderCount;
  const originalTimeline = api.context.document.querySelector('#timeline');

  await api.streamTurnEvents('turn_1');

  assert.equal(api.context.__appRenderCount, originalAppRenderCount);
  assert.equal(api.context.document.activeElement, promptInput);
  assert.equal(api.context.document.querySelector('#prompt-input'), promptInput);
  assert.equal(api.context.document.querySelector('#timeline'), originalTimeline);
});

test('chat metadata refresh keeps the focused composer input', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/sessions/session_1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            id: 'session_1',
            cwd: '/repo',
            settings: { metadata: {} },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.sessions = [api.state.currentSession];
  api.render();

  const promptInput = context.document.querySelector('#prompt-input');
  promptInput.focus();

  await api.refreshCurrentSessionMetadata();

  const nextPromptInput = context.document.querySelector('#prompt-input');
  assert.equal(context.document.activeElement, nextPromptInput);
});

test('sending a message keeps a following chat timeline at the latest content', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1/turns') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ turnId: 'turn_1' }),
        };
      }
      if (path === '/api/turns/turn_1/events') {
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
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.prompt = 'keep me anchored';
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1000;
  timeline.clientHeight = 200;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  await api.onComposerSubmit({ preventDefault() {} });

  const nextTimeline = context.document.querySelector('#timeline');
  assert.equal(nextTimeline.scrollTop, nextTimeline.scrollHeight - nextTimeline.clientHeight);
});

test('opening a report path switches to a report loading view before resolve finishes', async () => {
  let resolveReportPath;
  const resolveReady = new Promise((resolve) => {
    resolveReportPath = resolve;
  });
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/reports/resolve') {
        await resolveReady;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
          }),
        };
      }
      if (path === '/api/reports/project-a%2F2026-05-19%2Fsummary.md/content') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
            content: '# Summary',
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
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  const pending = api.openReportByPath('/Users/alice/.codex-web/reports/project-a/2026-05-19/summary.md', { returnView: 'chat' });
  await Promise.resolve();

  assert.equal(api.state.view, 'report');
  assert.equal(api.state.reportReturnView, 'chat');
  assert.equal(api.state.currentReport?.project, 'project-a');
  assert.match(context.document.querySelector('.report-viewer')?.innerHTML || '', /Loading report/u);

  resolveReportPath();
  await pending;

  assert.match(context.document.querySelector('.report-viewer')?.innerHTML || '', /Summary/u);
});

test('returning from a report restores the chat timeline position', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/reports/resolve') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
          }),
        };
      }
      if (path === '/api/reports/project-a%2F2026-05-19%2Fsummary.md/content') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
            content: '# Summary',
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
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1400;
  timeline.clientHeight = 400;
  timeline.scrollTop = 640;
  api.updateTimelineFollowState();

  await api.openReportByPath('/Users/alice/.codex-web/reports/project-a/2026-05-19/summary.md', { returnView: 'chat' });
  api.closeReportViewer();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight - restoredTimeline.clientHeight - 360);
});

test('returning from a report keeps a following chat timeline at the latest content', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/reports/resolve') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
          }),
        };
      }
      if (path === '/api/reports/project-a%2F2026-05-19%2Fsummary.md/content') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
            content: '# Summary',
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
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [{ id: 'm1', kind: 'message', role: 'assistant', text: 'hello' }];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1200;
  timeline.clientHeight = 400;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  await api.openReportByPath('/Users/alice/.codex-web/reports/project-a/2026-05-19/summary.md', { returnView: 'chat' });
  api.closeReportViewer();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight - restoredTimeline.clientHeight);
});

test('report viewer rerenders preserve the report scroll position', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      assert.equal(path, '/api/reports/project-a%2F2026-05-19%2Fsummary.md/favorite');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          report: {
            id: 'project-a/2026-05-19/summary.md',
            project: 'project-a',
            title: 'summary',
            kind: 'markdown',
            favorite: true,
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'report';
  api.state.reports = [{
    id: 'project-a/2026-05-19/summary.md',
    project: 'project-a',
    title: 'summary',
    kind: 'markdown',
    favorite: false,
  }];
  api.state.currentReport = api.state.reports[0];
  api.state.currentReportContent = '# Summary\n\nLong content';
  api.render();

  const reportViewer = context.document.querySelector('.report-viewer');
  reportViewer.scrollHeight = 1800;
  reportViewer.clientHeight = 500;
  reportViewer.scrollTop = 520;

  await api.toggleReportFavorite('project-a/2026-05-19/summary.md');

  assert.equal(context.document.querySelector('.report-viewer').scrollTop, 520);
});

test('chat stream updates do not rerender an open report viewer', async () => {
  const { api, context } = await loadAppHarness();

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'report';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.currentReport = {
    id: 'project-a/2026-05-19/summary.md',
    project: 'project-a',
    title: 'summary',
    kind: 'markdown',
  };
  api.state.currentReportContent = '# Summary';
  api.render();

  const renderCount = context.__appRenderCount;
  const reportViewer = context.document.querySelector('.report-viewer');
  reportViewer.scrollTop = 480;

  api.applyTurnEvent({
    type: 'assistant.delta',
    turnId: 'turn_1',
    text: 'background update',
    phase: 'streaming',
  }, null);

  assert.equal(context.__appRenderCount, renderCount);
  assert.equal(context.document.querySelector('.report-viewer'), reportViewer);
  assert.equal(reportViewer.scrollTop, 480);
});

test('session cards show only the last cwd segment in metadata', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'time';
  api.state.sessions = [{
    id: 'session_path',
    cwd: '/Users/alice/workspace/project-alpha',
    updatedAt: 1716200000000,
    settings: { metadata: {} },
  }];

  const html = api.renderSessionCards();

  assert.match(html, />project-alpha<\/span>/u);
  assert.doesNotMatch(html, /Users\/alice\/workspace\/project-alpha/u);
});

test('session names prefer the last cwd segment over long stored project labels', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'time';
  api.state.sessions = [{
    id: 'session_name',
    cwd: '/Users/alice/workspace/project-beta',
    projectName: 'workspace/project-beta',
    updatedAt: 1716200000000,
    settings: { metadata: {} },
  }];
  api.state.currentSession = api.state.sessions[0];

  const listHtml = api.renderSessionCards();
  const chatHtml = api.renderChat().innerHTML;

  assert.match(listHtml, /class="session-project">project-beta<\/span>/u);
  assert.doesNotMatch(listHtml, /workspace\/project-beta/u);
  assert.match(chatHtml, /class="project-title">project-beta<\/div>/u);
});

test('chat reports button falls back to the top-level report project when only nested metadata matches', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSession = {
    id: 'session_report',
    cwd: '/Users/alice/work/project-alpha',
    projectName: 'project-alpha',
  };
  api.state.reports = [
    {
      id: 'project-alpha/docs/2026-05-20/summary.md',
      project: 'project-alpha/docs',
      title: 'summary',
      kind: 'markdown',
      favorite: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
    },
  ];

  const html = api.renderChat().innerHTML;

  assert.match(html, /data-session-reports-project="project-alpha"/u);
  assert.doesNotMatch(html, /data-session-reports-project="project-alpha\/docs"/u);
});

test('chat reports button keeps the nested report project path when the session cwd matches it exactly', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSession = {
    id: 'session_report_nested',
    cwd: '/Users/alice/work/project-alpha/docs',
    projectName: 'project-alpha/docs',
  };
  api.state.reports = [
    {
      id: 'project-alpha/2026-05-20/summary.md',
      project: 'project-alpha/docs',
      title: 'summary',
      kind: 'markdown',
      favorite: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
    },
  ];

  const html = api.renderChat().innerHTML;

  assert.match(html, /data-session-reports-project="project-alpha\/docs"/u);
});

test('chat reports button does not prepend parent workspace segments from cwd', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSession = {
    id: 'session_workspace_prefix',
    cwd: '/Users/alice/vibecoding/codex-mobile-web-app',
    projectName: 'vibecoding/codex-mobile-web-app',
  };
  api.state.reports = [
    {
      id: 'codex-mobile-web-app/2026-05-20/summary.md',
      project: 'codex-mobile-web-app',
      title: 'summary',
      kind: 'markdown',
      favorite: false,
      updatedAt: '2026-05-20T10:00:00.000Z',
    },
  ];

  const html = api.renderChat().innerHTML;

  assert.match(html, /data-session-reports-project="codex-mobile-web-app"/u);
  assert.doesNotMatch(html, /data-session-reports-project="vibecoding\/codex-mobile-web-app"/u);
});

test('chat reports button falls back to cwd leaf before reports load so workspace prefixes do not leak', async () => {
  const { api } = await loadAppHarness();

  api.state.currentSession = {
    id: 'session_reports_not_loaded',
    cwd: '/Users/alice/vibecoding/codex-mobile-web-app',
    projectName: 'vibecoding/codex-mobile-web-app',
  };
  api.state.reports = [];
  api.state.reportsLoaded = false;

  const html = api.renderChat().innerHTML;

  assert.match(html, /data-session-reports-project="codex-mobile-web-app"/u);
  assert.doesNotMatch(html, /data-session-reports-project="vibecoding\/codex-mobile-web-app"/u);
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
  assert.equal(api.state.error, '');
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.match(errorItem?.text || '', /Codex app-server disconnected/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);

  const html = api.renderTimelineItem(errorItem);
  assert.match(html, /message-card system error-message/u);
  assert.match(html, /<span class="error-badge">Error<\/span>/u);
  assert.match(html, /Codex app-server disconnected/u);
});

test('turn failures prefer raw details when present', async () => {
  const { api } = await loadAppHarness();

  api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_rate_limit',
    threadId: 'session_1',
    message: 'Codex request failed',
    details: '429 Too Many Requests: model rate limit reached',
  }, null);

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_rate_limit');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /429 Too Many Requests/u);
  assert.doesNotMatch(errorItem?.text || '', /^Codex request failed$/u);

  const html = api.renderTimelineItem(errorItem);
  assert.match(html, /message-card system error-message/u);
  assert.match(html, /429 Too Many Requests/u);
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
  assert.equal(api.state.error, '');
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /SSE failed hard/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('stream failures persist visible errors through the backend session timeline', async () => {
  const fetchCalls: Array<{ path: string; options: any }> = [];
  const { api } = await loadAppHarness({
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === '/api/turns/turn_stream_error/events') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'internal_error', message: 'SSE failed hard' }),
        };
      }
      if (path === '/api/sessions/session_1/timeline') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            entry: {
              id: 'error_turn_stream_error',
              kind: 'message',
              role: 'system',
              label: 'Error',
              meta: 'failed',
              text: 'SSE failed hard',
              severity: 'error',
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
  api.state.turnId = 'turn_stream_error';
  api.state.pendingTurn = true;
  api.state.streamWasBackgrounded = false;

  await api.streamTurnEvents('turn_stream_error');
  await flushMicrotasks();

  const persistCall = fetchCalls.find((call) => call.path === '/api/sessions/session_1/timeline');
  assert.ok(persistCall);
  assert.equal(persistCall?.options.method, 'POST');
  assert.deepEqual(JSON.parse(persistCall?.options.body), {
    id: 'error_turn_stream_error',
    role: 'system',
    label: 'Error',
    meta: 'failed',
    text: 'SSE failed hard',
    severity: 'error',
    afterHistoryIndex: 0,
  });
  assert.equal(api.state.timeline.find((item) => item.id === 'error_turn_stream_error')?.text, 'SSE failed hard');
});

test('thread work updates stay off the timeline and surface failures as visible error messages', async () => {
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
  assistantEntry = api.applyTurnEvent({
    type: 'turn.failed',
    turnId: 'turn_work_error',
    threadId: 'session_1',
    message: 'Command failed with exit code 1',
  }, assistantEntry);

  const latest = api.state.timeline.at(-1);
  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(latest?.kind, 'message');
  assert.equal(latest?.role, 'system');
  assert.equal(latest?.severity, 'error');

  const html = api.renderTimelineItem(latest);
  assert.doesNotMatch(html, /work-card/u);
  assert.match(html, /<span class="error-badge">Error<\/span>/u);
  assert.match(html, /Command failed with exit code 1/u);
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
      if (path === '/api/sessions/session_new/timeline') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            entry: {
              id: 'error_request_session_new',
              kind: 'message',
              role: 'system',
              label: 'Error',
              meta: 'failed',
              text: 'Codex refused the first turn',
              severity: 'error',
            },
          }),
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
  assert.deepEqual(fetchCalls, ['/api/sessions', '/api/sessions/session_new/turns', '/api/sessions/session_new/timeline']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.match(errorItem?.text || '', /Codex refused the first turn/u);
});

test('new first-turn rollout errors wait before showing a timeline error', async () => {
  const fetchCalls = [];
  const timers = [];
  const { api } = await loadAppHarness({
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
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
          json: async () => ({
            error: 'internal_error',
            message: 'failed to read thread: thread-store internal error: rollout at /Users/test/.codex/sessions/rollout.jsonl is empty',
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ session: { id: 'session_new', cwd: '/repo', thread: { turns: [] } } }) };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.cwd = '/repo';
  api.state.prompt = 'hello';

  await api.onComposerSubmit({ preventDefault() {} });

  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.delay, 10_000);
  assert.equal(api.state.pendingTurn, true);
  assert.equal(api.state.timeline.some((item) => item.id.startsWith('error_')), false);
  assert.deepEqual(fetchCalls, ['/api/sessions', '/api/sessions/session_new/turns']);
});

test('new first-turn rollout errors recover from refreshed session history before reporting', async () => {
  const timers = [];
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
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
          json: async () => ({
            error: 'internal_error',
            message: 'failed to read thread: thread-store internal error: rollout at /Users/test/.codex/sessions/rollout.jsonl is empty',
          }),
        };
      }
      if (path === '/api/sessions/session_new') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_new',
              cwd: '/repo',
              settings: {},
              thread: {
                turns: [{
                  id: 'turn_recovered',
                  status: 'completed',
                  items: [
                    { type: 'message', role: 'user', text: 'hello' },
                    { type: 'message', role: 'assistant', text: 'Recovered answer' },
                  ],
                }],
              },
            },
          }),
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
  timers[0].callback();
  await flushMicrotasks();

  assert.deepEqual(fetchCalls, ['/api/sessions', '/api/sessions/session_new/turns', '/api/sessions/session_new']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.timeline.some((item) => item.id.startsWith('error_')), false);
  assert.equal(api.state.timeline.some((item) => item.role === 'assistant' && item.text === 'Recovered answer'), true);
});

test('new first-turn rollout errors report after the recovery delay when history is still empty', async () => {
  const timers = [];
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
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
          json: async () => ({
            error: 'internal_error',
            message: 'failed to read thread: thread-store internal error: rollout at /Users/test/.codex/sessions/rollout.jsonl is empty',
          }),
        };
      }
      if (path === '/api/sessions/session_new') {
        return {
          ok: true,
          status: 200,
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
      if (path === '/api/sessions/session_new/timeline') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            entry: {
              id: 'error_request_session_new',
              kind: 'message',
              role: 'system',
              label: 'Error',
              meta: 'failed',
              text: 'failed to read thread: thread-store internal error: rollout at /Users/test/.codex/sessions/rollout.jsonl is empty',
              severity: 'error',
            },
          }),
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
  timers[0].callback();
  await flushMicrotasks();

  const errorItem = api.state.timeline.find((item) => item.id.startsWith('error_'));
  assert.deepEqual(fetchCalls, ['/api/sessions', '/api/sessions/session_new/turns', '/api/sessions/session_new', '/api/sessions/session_new/timeline']);
  assert.equal(api.state.pendingTurn, false);
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.match(errorItem?.text || '', /rollout.*is empty/u);
});

test('approval requests still render as standalone actionable cards without work timeline items', async () => {
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

  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.state.timeline.some((item) => item.kind === 'batch'), false);
  assert.equal(api.state.timeline.filter((item) => item.kind === 'approval').length, 1);

  const approval = api.state.timeline.find((item) => item.kind === 'approval');
  assert.equal(approval.approvalId, 'approval_1');
  assert.equal(api.state.approvals.get('approval_1')?.resolved, false);
  const html = api.renderTimelineItem(approval);
  assert.match(html, /Approval requested/u);
  assert.match(html, /npm install/u);
  assert.match(html, /data-approval-action="accept"/u);
});

test('assistant final messages stay at the bottom after hidden work updates complete', async () => {
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

  assert.equal(api.state.timeline.some((item) => item.kind === 'work'), false);
  assert.equal(api.state.timeline.at(-1)?.id, 'assistant_turn_bottom_final');
  assert.equal(api.state.timeline.at(-1)?.kind, 'message');
  assert.match(api.renderTimelineItem(api.state.timeline.at(-1)), /Final response/u);
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

test('history hydration prefers backend-managed session timeline entries', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_timeline_backend',
    timeline: [
      { id: 'history_1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
      { id: 'history_2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
      { id: 'cmd_user_1', kind: 'message', role: 'user', label: 'You', meta: 'command', text: '/goal resume' },
      { id: 'cmd_system_1', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
    ],
    thread: {
      turns: [
        {
          id: 'turn_ignored',
          items: [
            { type: 'message', role: 'user', text: 'Stale question' },
            { type: 'message', role: 'assistant', text: 'Stale answer' },
          ],
        },
      ],
    },
  });

  assert.equal(
    JSON.stringify(timeline.map((item) => [item.role, item.text])),
    JSON.stringify([
      ['user', 'Earlier question'],
      ['assistant', 'Earlier answer'],
      ['user', '/goal resume'],
      ['system', 'Goal resumed: ship slash goal support'],
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

test('history hydration includes failed turns as durable error messages', async () => {
  const { api } = await loadAppHarness();

  const timeline = api.hydrateTimelineFromSession({
    id: 'session_failed_history',
    thread: {
      turns: [
        {
          id: 'turn_403',
          status: 'failed',
          error: 'unexpected status 403 Forbidden: invalid credentials',
          items: [
            { type: 'message', role: 'user', text: 'Trigger auth failure' },
          ],
        },
      ],
    },
  });

  assert.equal(JSON.stringify(timeline.map((item) => [item.id, item.role, item.text])), JSON.stringify([
    ['history_turn_403_0', 'user', 'Trigger auth failure'],
    ['error_turn_403', 'system', 'unexpected status 403 Forbidden: invalid credentials'],
  ]));
  const errorItem = timeline.find((item) => item.id === 'error_turn_403');
  assert.equal(errorItem?.severity, 'error');
  assert.equal(errorItem?.label, 'Error');
  assert.match(api.renderTimelineItem(errorItem), /message-card system error-message/u);
});

test('session refresh keeps historical failed turn messages when later turns succeed', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_mixed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_mixed',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_403',
                    status: 'failed',
                    error: 'unexpected status 403 Forbidden',
                    items: [
                      { type: 'message', role: 'user', text: 'Bad key attempt' },
                    ],
                  },
                  {
                    id: 'turn_recovered',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Continue after fixing key' },
                      { type: 'message', role: 'assistant', text: 'Recovered answer' },
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
  api.state.sessionId = 'session_mixed';
  api.state.currentSession = { id: 'session_mixed', cwd: '/repo' };
  api.state.timeline = [
    { id: 'history_turn_403_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Bad key attempt' },
    { id: 'error_turn_403', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'unexpected status 403 Forbidden' },
  ];

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_403');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /403 Forbidden/u);
  assert.match(api.state.timeline.map((item) => item.text).join('\n'), /Recovered answer/u);
  assert.equal(api.state.error, '');
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('session refresh preserves backend goal and error messages that are not present in thread history', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Original question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Original answer' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
                { id: 'error_turn_stale', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'Load failed' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Original answer' },
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
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Original answer/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Goal resumed: ship slash goal support/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Load failed/u);
});

test('session refresh preserves backend goal and error messages when hydrated history adds missing assistant replies', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Original question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Original answer' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
                { id: 'error_turn_stale', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'Load failed' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Original answer' },
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
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Original answer/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Goal resumed: ship slash goal support/u);
  assert.match(api.state.timeline.map((item) => item.text || '').join('\n'), /Load failed/u);
});

test('session refresh keeps backend goal and error messages in place instead of pinning them to the bottom', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
                { id: 'error_turn_stale', kind: 'message', role: 'system', severity: 'error', label: 'Error', meta: 'failed', text: 'Load failed' },
                { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Later question' },
                { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Later answer' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Earlier question' },
                      { type: 'message', role: 'assistant', text: 'Earlier answer' },
                    ],
                  },
                  {
                    id: 'turn_2',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Later question' },
                      { type: 'message', role: 'assistant', text: 'Later answer' },
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
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Earlier question',
    'Earlier answer',
    'Goal resumed: ship slash goal support',
    'Load failed',
    'Later question',
    'Later answer',
  ]));
});

test('session refresh preserves backend slash commands before goal resumed system messages', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Earlier question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Earlier answer' },
                { id: 'local_user_goal_resume', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: '/goal resume' },
                { id: 'command_goal_resume', kind: 'message', role: 'system', label: '/goal', meta: 'resume', text: 'Goal resumed: ship slash goal support' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Earlier question' },
                      { type: 'message', role: 'assistant', text: 'Earlier answer' },
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
  api.state.sessionId = 'session_goal';
  api.state.currentSession = { id: 'session_goal', cwd: '/repo' };

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Earlier question',
    'Earlier answer',
    '/goal resume',
    'Goal resumed: ship slash goal support',
  ]));
});

test('expanding session history uses backend help and goal messages in the visible timeline', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_history_expand_with_commands',
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
  api.state.timeline = [
    { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Second user question' },
    { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Second assistant answer' },
    { id: 'history_turn_3_4', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Third user question' },
    { id: 'history_turn_3_5', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Third assistant answer' },
    { id: 'history_turn_4_6', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Newest user question' },
    { id: 'history_turn_4_7', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Newest assistant answer' },
  ];

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
});

test('expanding session history uses backend slash commands before goal resumed system messages', async () => {
  const { api } = await loadAppHarness();
  const session = {
    id: 'session_history_expand_with_goal_resume_command',
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
      ],
    },
  };

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sessionId = session.id;
  api.state.currentSession = session;
  api.restoreTimelineForSession(session);
  api.state.timeline = [
    { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Second user question' },
    { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Second assistant answer' },
    { id: 'history_turn_3_4', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Third user question' },
    { id: 'history_turn_3_5', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Third assistant answer' },
  ];

  assert.equal(api.showMoreSessionHistory(), true);
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'First user question',
    'First assistant answer',
    'Second user question',
    'Second assistant answer',
    'Third user question',
    'Third assistant answer',
  ]));
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

test('layout mode uses desktop workspace on pointer-based computer windows', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 900, desktopPointer: true });

  assert.equal(api.DESKTOP_WORKSPACE_MIN_WIDTH, 820);
  assert.equal(api.isDesktopLayout(), true);

  context.window.innerWidth = 819;
  assert.equal(api.isDesktopLayout(), false);

  context.window.innerWidth = 900;
  context.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  assert.equal(api.isDesktopLayout(), false);
});

test('desktop resize preserves active session while mobile resize maps back to chat', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1200, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };

  api.handleLayoutResize();
  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_1');

  context.window.innerWidth = 390;
  api.handleLayoutResize();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_1');
  assert.equal(api.state.currentSession?.id, 'session_1');
});

test('desktop renders a persistent session sidebar and chat pane', async () => {
  const { api, context } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/a', projectName: 'Repo A', favorite: true, lastUserInput: 'Build feature', updatedAt: 20, settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/b', projectName: 'Repo B', favorite: true, lastUserInput: 'Fix bug', updatedAt: 10, settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Ready' },
  ];

  api.render();

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

test('desktop session selection keeps the workspace view active', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 1280,
    desktopPointer: true,
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
    { id: 'session_1', cwd: '/repo/one', favorite: true, settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', favorite: true, settings: { metadata: {} } },
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

test('desktop session selection stays two-pane on common narrow computer windows', async () => {
  const { api } = await loadAppHarness({
    viewportWidth: 900,
    desktopPointer: true,
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
            timeline: [
              { id: 'm1', kind: 'message', role: 'assistant', label: 'Assistant', text: 'Right pane switched' },
            ],
            thread: { turns: [] },
          },
        }),
      };
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessions = [
    { id: 'session_1', cwd: '/repo/one', favorite: true, settings: { metadata: {} } },
    { id: 'session_2', cwd: '/repo/two', favorite: true, settings: { metadata: {} } },
  ];
  api.state.sessionId = 'session_1';
  api.state.currentSession = api.state.sessions[0];

  await api.selectSession('session_2');

  assert.equal(api.state.view, 'sessions');
  assert.equal(api.state.sessionId, 'session_2');
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-workspace/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-sidebar/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /desktop-chat-pane/u);
  assert.match(api.context.document.querySelector('#app').innerHTML, /Right pane switched/u);
  assert.doesNotMatch(api.context.document.querySelector('#app').innerHTML, /chat-back-button/u);
});

test('desktop showSessionList keeps the active right pane instead of clearing it', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

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

test('desktop composer is larger, hides Send, and submits with Enter while preserving Shift Enter', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(styles, /@media \(min-width:\s*820px\)[\s\S]*\.desktop-chat-pane \.composer\s*\{[^}]*width:\s*min\(100%,\s*960px\);/su);
  assert.match(styles, /@media \(min-width:\s*820px\)[\s\S]*\.desktop-chat-pane \.compact-composer-row textarea\s*\{[^}]*min-height:\s*96px;/su);
  assert.match(styles, /@media \(min-width:\s*820px\)[\s\S]*\.desktop-chat-pane \.compact-composer-row textarea\s*\{[^}]*max-height:\s*220px;/su);
  assert.match(styles, /@media \(min-width:\s*820px\)[\s\S]*\.desktop-chat-pane \.compact-send\s*\{[^}]*display:\s*none;/su);
  assert.match(app, /function handlePromptKeydown\(event\)/u);
  assert.match(app, /promptInput\.addEventListener\('keydown', handlePromptKeydown\)/u);
  assert.match(app, /if \(!isDesktopLayout\(\) \|\| event\.key !== 'Enter' \|\| event\.shiftKey/u);
  assert.match(app, /document\.querySelector\('#composer-form'\)\?\.requestSubmit\(\)/u);
});

test('desktop prompt Enter submits while Shift Enter keeps editing', async () => {
  let submitCount = 0;
  const { api, context } = await loadAppHarness({ viewportWidth: 900, desktopPointer: true });

  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sessionId = 'session_1';
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.render();

  const composerForm = {
    requestSubmit() {
      submitCount += 1;
    },
  };
  context.__elements.set('#composer-form', composerForm);

  const enterEvent = {
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  api.handlePromptKeydown(enterEvent);

  assert.equal(enterEvent.prevented, true);
  assert.equal(submitCount, 1);

  const shiftEnterEvent = {
    key: 'Enter',
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  api.handlePromptKeydown(shiftEnterEvent);

  assert.equal(shiftEnterEvent.prevented, false);
  assert.equal(submitCount, 1);
});

test('desktop new session opens an inline sidebar launcher', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

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
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

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

test('desktop app settings opens as a panel without clearing the active session', async () => {
  const { api } = await loadAppHarness({ viewportWidth: 1280, desktopPointer: true });

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
    desktopPointer: true,
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

test('session topbar shows Sort only on Favorites and keeps New visually neutral', async () => {
  const { api } = await loadAppHarness();

  api.state.sortMode = 'favorites';
  api.state.favoriteSortMode = false;
  const favoritesHtml = api.renderSessionList().innerHTML;

  assert.match(favoritesHtml, /id="favorite-sort-button"/u);
  assert.match(favoritesHtml, /<div class="topbar-actions">[\s\S]*id="open-reports-button"[\s\S]*id="favorite-sort-button"[\s\S]*id="open-new-session-button"[\s\S]*id="open-app-settings-button"/u);
  assert.match(favoritesHtml, /class="reports-action compact-button" type="button" id="open-reports-button"/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="favorite-sort-button"/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="open-new-session-button"/u);
  assert.match(favoritesHtml, /class="ghost compact-button" type="button" id="open-app-settings-button"/u);
  assert.doesNotMatch(favoritesHtml, /class="primary compact-button" type="button" id="open-new-session-button"/u);

  api.state.sortMode = 'time';
  api.state.favoriteSortMode = false;
  const allHtml = api.renderSessionList().innerHTML;

  assert.doesNotMatch(allHtml, /id="favorite-sort-button"/u);
  assert.match(allHtml, /<div class="topbar-actions">[\s\S]*id="open-reports-button"[\s\S]*id="open-new-session-button"[\s\S]*id="open-app-settings-button"/u);
  assert.match(allHtml, /class="ghost compact-button" type="button" id="open-new-session-button"/u);
  assert.match(allHtml, /class="ghost compact-button" type="button" id="open-app-settings-button"/u);
});

test('session topbar exposes Reports without replacing Message textarea or Set', async () => {
  const { api } = await loadAppHarness();

  const sessionsHtml = api.renderSessionList().innerHTML;
  assert.match(sessionsHtml, /id="open-reports-button"[^>]*>Reports<\/button>/u);
  assert.doesNotMatch(sessionsHtml, /data-main-view/u);
  assert.doesNotMatch(sessionsHtml, /main-view-toggle/u);

  api.state.view = 'chat';
  api.state.currentSession = { id: 'session_1', cwd: '/repo' };
  const chatHtml = api.renderChat().innerHTML;
  assert.match(chatHtml, /id="settings-toggle"/u);
  assert.match(chatHtml, /<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">/u);
  assert.doesNotMatch(chatHtml, /<input class="prompt-input" id="prompt-input"/u);
});

test('reports page renders report projects before project report cards', async () => {
  const { api } = await loadAppHarness();

  api.state.view = 'reports';
  api.state.reports = [
    {
      id: 'project-a/2026-05-19/summary.md',
      project: 'project-a',
      title: 'summary',
      kind: 'markdown',
      favorite: true,
      updatedAt: '2026-05-19T10:00:00.000Z',
    },
    {
      id: 'project-b/2026-05-19/audit.html',
      project: 'project-b',
      title: 'audit',
      kind: 'html',
      favorite: false,
      updatedAt: '2026-05-19T09:00:00.000Z',
    },
  ];
  const html = api.renderReportsPage().innerHTML;

  assert.match(html, /Reports/u);
  assert.match(html, /class="page-nav"/u);
  assert.match(html, /class="ghost page-back-button" type="button" id="back-to-list-button" aria-label="Back">&lt;<\/button>/u);
  assert.match(html, /data-report-project="project-a"/u);
  assert.match(html, /data-report-project="project-b"/u);
  assert.doesNotMatch(html, /data-report-id="project-a\/2026-05-19\/summary\.md"/u);
  assert.doesNotMatch(html, /data-report-favorite-id="project-a\/2026-05-19\/summary\.md"/u);
  assert.doesNotMatch(html, /id="report-search-input"/u);
});

test('reports page renders a selected project report list', async () => {
  const { api } = await loadAppHarness();

  api.state.view = 'reports';
  api.state.reportProject = 'project-a';
  api.state.reports = [
    {
      id: 'project-a/2026-05-19/summary.md',
      project: 'project-a',
      title: 'summary',
      kind: 'markdown',
      favorite: true,
      updatedAt: '2026-05-19T10:00:00.000Z',
    },
    {
      id: 'project-b/2026-05-19/audit.html',
      project: 'project-b',
      title: 'audit',
      kind: 'html',
      favorite: false,
      updatedAt: '2026-05-19T09:00:00.000Z',
    },
  ];

  const html = api.renderReportsPage().innerHTML;

  assert.match(html, /project-a/u);
  assert.match(html, /summary/u);
  assert.match(html, /data-report-id="project-a\/2026-05-19\/summary\.md"/u);
  assert.match(html, /data-report-favorite-id="project-a\/2026-05-19\/summary\.md"/u);
  assert.doesNotMatch(html, /data-report-project="project-b"/u);
  assert.doesNotMatch(html, /data-report-id="project-b\/2026-05-19\/audit\.html"/u);
});

test('reports page returns to sessions or chat depending on entry point', async () => {
  const { api } = await loadAppHarness({
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

  await api.openReportsPage();
  assert.equal(api.state.view, 'reports');
  assert.equal(api.state.reportsReturnView, 'sessions');
  api.closeReportsPage();
  assert.equal(api.state.view, 'sessions');

  api.state.view = 'chat';
  api.state.sessionId = 'session_a';
  api.state.currentSession = { id: 'session_a', cwd: '/Users/alice/work/project-a', projectName: 'Project A' };
  api.state.timeline = [{ id: 'msg_1', kind: 'message', role: 'assistant', text: 'hello' }];

  await api.openReportsPage({ project: 'project-a', returnView: 'chat' });
  assert.equal(api.state.view, 'reports');
  assert.equal(api.state.reportProject, 'project-a');
  assert.equal(api.state.reportsReturnView, 'chat');
  assert.equal(api.state.sessionId, 'session_a');
  assert.equal(api.state.timeline.length, 1);

  api.closeReportsPage();
  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_a');
  assert.equal(api.state.timeline.length, 1);
});

test('report viewer opened from a session reports page returns to that session', async () => {
  const { api } = await loadAppHarness({
    fetch: async (url) => {
      if (String(url).startsWith('/api/reports/project-a%2F2026-05-19%2Fsummary.md/content')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            report: {
              id: 'project-a/2026-05-19/summary.md',
              project: 'project-a',
              title: 'summary',
              kind: 'markdown',
            },
            content: '# Summary',
          }),
        };
      }
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

  api.state.view = 'chat';
  api.state.sessionId = 'session_a';
  api.state.currentSession = { id: 'session_a', cwd: '/Users/alice/work/project-a', projectName: 'Project A' };
  api.state.reports = [{
    id: 'project-a/2026-05-19/summary.md',
    project: 'project-a',
    title: 'summary',
    kind: 'markdown',
    favorite: false,
    updatedAt: '2026-05-19T10:00:00.000Z',
  }];
  api.state.reportsLoaded = true;

  await api.openReportsPage({ project: 'project-a', returnView: 'chat' });
  await api.openReportById('project-a/2026-05-19/summary.md');
  assert.equal(api.state.view, 'report');
  assert.equal(api.state.reportReturnView, 'chat');

  api.closeReportViewer();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.sessionId, 'session_a');
  assert.equal(api.state.currentSession?.id, 'session_a');
});

test('reports project back navigation returns to the originating session', async () => {
  const { api } = await loadAppHarness();

  api.state.view = 'reports';
  api.state.sessionId = 'session_a';
  api.state.currentSession = { id: 'session_a', cwd: '/Users/alice/work/project-a', projectName: 'Project A' };
  api.state.reportsReturnView = 'chat';
  api.state.reportProject = 'project-a';

  api.handleReportsBackNavigation();

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.reportProject, '');
  assert.equal(api.state.sessionId, 'session_a');
});

test('report viewer renders markdown and sandboxed html reports', async () => {
  const { api } = await loadAppHarness();

  api.state.currentReport = {
    id: 'project-a/2026-05-19/summary.md',
    project: 'project-a',
    title: 'summary',
    kind: 'markdown',
    favorite: false,
  };
  api.state.currentReportContent = '# Done\n\n- **item**\n\n| Col A | Col B | Col C |\n| :--- | :---: | ---: |\n| A \\| B | `x|y` | Gamma |\n';
  let html = api.renderReportViewer().innerHTML;
  assert.match(html, /<div class="report-document markdown-body">/u);
  assert.match(html, /<h1>Done<\/h1>/u);
  assert.match(html, /<strong>item<\/strong>/u);
  assert.match(html, /<table><thead><tr><th style="text-align: left;">Col A<\/th><th style="text-align: center;">Col B<\/th><th style="text-align: right;">Col C<\/th><\/tr><\/thead><tbody><tr><td style="text-align: left;">A \| B<\/td><td style="text-align: center;"><code>x\|y<\/code><\/td><td style="text-align: right;">Gamma<\/td><\/tr><\/tbody><\/table>/u);

  api.state.currentReport = {
    id: 'project-a/2026-05-19/audit.html',
    project: 'project-a',
    title: 'audit',
    kind: 'html',
    favorite: false,
  };
  api.state.currentReportContent = '<h1>Audit</h1>';
  html = api.renderReportViewer().innerHTML;
  assert.match(html, /<iframe class="report-frame" sandbox="" srcdoc="&lt;h1&gt;Audit&lt;\/h1&gt;"><\/iframe>/u);
});

test('markdown reports wrap long text within the mobile viewport', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.report-document\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(styles, /\.markdown-body p,\s*\.markdown-body li,\s*\.markdown-body blockquote,\s*\.markdown-body h1,\s*\.markdown-body h2,\s*\.markdown-body h3,\s*\.markdown-body td,\s*\.markdown-body th\s*\{[^}]*overflow-wrap:\s*anywhere;/su);
  assert.match(styles, /\.markdown-body pre,\s*\.markdown-body code\s*\{[^}]*white-space:\s*pre-wrap;/su);
  assert.doesNotMatch(styles, /\.markdown-body\s*\{[^}]*white-space:\s*nowrap;/su);
});

test('report viewer renders the shipped table verification report as real tables', async () => {
  const { api } = await loadAppHarness();

  api.state.currentReport = {
    id: 'codex-mobile-web-app/2026-05-21/markdown-table-render-report.md',
    project: 'codex-mobile-web-app',
    title: 'markdown-table-render-report',
    kind: 'markdown',
    favorite: false,
  };
  api.state.currentReportContent = [
    '# Markdown Table Render Report',
    '',
    '## What Changed',
    '',
    '| Area | Status | Notes |',
    '| :--- | :---: | ---: |',
    '| Basic markdown tables | OK | `table`, `thead`, `tbody` render |',
    '| Alignment syntax | OK | `:---`, `:---:`, `---:` supported |',
    '| Escaped pipes | OK | `\\|` stays inside the same cell |',
    '| Inline code pipes | OK | `` `x|y` `` does not split columns |',
    '',
    '## Mixed Real-World Example',
    '',
    '| Field | Example | Result |',
    '| :--- | :---: | ---: |',
    '| Name | `renderMarkdown()` | pass |',
    '| Escaped text | A \\| B | pass |',
    '| Code sample | `foo|bar` | pass |',
    '| Numeric column | 42 | aligned right |',
  ].join('\n');

  const html = api.renderReportViewer().innerHTML;
  assert.match(html, /<table>/u);
  assert.match(html, /<th style="text-align: left;">Area<\/th>/u);
  assert.match(html, /<td style="text-align: left;">Basic markdown tables<\/td>/u);
  assert.match(html, /<td style="text-align: right;"><code>table<\/code>, <code>thead<\/code>, <code>tbody<\/code> render<\/td>/u);
  assert.match(html, /<td style="text-align: left;">Escaped pipes<\/td>/u);
  assert.match(html, /<td style="text-align: right;"><code>\\\|<\/code> stays inside the same cell<\/td>/u);
  assert.match(html, /<td style="text-align: center;"><code>renderMarkdown\(\)<\/code><\/td>/u);
  assert.match(html, /<td style="text-align: center;"><code>foo\|bar<\/code><\/td>/u);
});

test('assistant report paths open as app report links', async () => {
  const { api } = await loadAppHarness();

  const markdownHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '[Summary](/Users/alice/.codex-web/reports/project-a/2026-05-19/summary.md)',
  });
  assert.match(markdownHtml, /data-report-path="\/Users\/alice\/\.codex-web\/reports\/project-a\/2026-05-19\/summary\.md"/u);
  assert.match(markdownHtml, /class="report-link"/u);

  const plainHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '手机可打开报告：/Users/alice/.codex-web/reports/project-a/2026-05-19/summary.md',
  });
  assert.match(plainHtml, /data-report-path="\/Users\/alice\/\.codex-web\/reports\/project-a\/2026-05-19\/summary\.md"/u);
  assert.match(plainHtml, />summary\.md<\/a>/u);
});

test('assistant local markdown paths outside codex-web reports stay as plain text', async () => {
  const { api } = await loadAppHarness();

  const markdownHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '[Render Test](/Users/alice/work/codex-mobile-web-app/render-test.md)',
  });
  assert.doesNotMatch(markdownHtml, /class="report-link"/u);
  assert.doesNotMatch(markdownHtml, /data-report-path=/u);
  assert.match(markdownHtml, /render-test\.md/u);

  const plainHtml = api.renderTimelineItem({
    kind: 'message',
    role: 'assistant',
    label: 'Assistant',
    text: '查看这个文件：/Users/alice/work/codex-mobile-web-app/render-test.md',
  });
  assert.doesNotMatch(plainHtml, /class="report-link"/u);
  assert.doesNotMatch(plainHtml, /data-report-path=/u);
  assert.match(plainHtml, /render-test\.md/u);
});

test('chat header opens reports for the current project when available', async () => {
  const { api } = await loadAppHarness();

  api.state.sessionId = 'session_a';
  api.state.currentSession = {
    id: 'session_a',
    cwd: '/Users/alice/work/project-a',
    projectName: 'Project A',
  };
  api.state.reports = [
    {
      id: 'project-a/2026-05-19/summary.md',
      project: 'project-a',
      title: 'summary',
      kind: 'markdown',
      favorite: false,
      updatedAt: '2026-05-19T10:00:00.000Z',
    },
  ];

  const html = api.renderChat().innerHTML;

  assert.match(html, /class="ghost compact-button session-report-button"/u);
  assert.match(html, /data-session-reports-project="project-a"/u);
  assert.doesNotMatch(html, /data-session-report-id/u);
  assert.match(html, /id="settings-toggle"/u);
  assert.match(html, /<textarea id="prompt-input" name="prompt" rows="1" placeholder="Message">/u);
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

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/models', '/api/projects', '/api/sessions?favorite=true', '/api/reports']);
  pending[1]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ items: [] }),
  });
  pending[2]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ items: [] }),
  });
  pending[3]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{ id: 'favorite_session', favorite: true, updatedAt: 20, settings: { metadata: {} } }],
    }),
  });
  pending[4]?.resolve({
    ok: true,
    status: 200,
    json: async () => ({ items: [] }),
  });
  await restore;
  await flushMicrotasks();

  assert.equal(api.state.sortMode, 'favorites');
  assert.equal(api.state.sessionsScope, 'favorites');
  assert.equal(JSON.stringify(api.state.sessions.map((session) => session.id)), JSON.stringify(['favorite_session']));
  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/models', '/api/projects', '/api/sessions?favorite=true', '/api/reports', '/api/sessions']);

  pending[5]?.resolve({
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

  assert.deepEqual(pending.map((request) => request.path), ['/api/auth/me', '/api/models', '/api/projects', '/api/sessions?favorite=true', '/api/reports', '/api/sessions']);
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

test('all tab rerenders in time order when session detail refresh finishes after returning to list', async () => {
  let resolveSessionDetail: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_recent') {
        return await new Promise((resolve) => {
          resolveSessionDetail = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'sessions';
  api.state.sortMode = 'time';
  api.state.sessionsScope = 'all';
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessions = [
    { id: 'session_other', cwd: '/repo/other', lastUserInput: 'Other prompt', lastInputAt: 200, updatedAt: 200, settings: { metadata: {} } },
    { id: 'session_recent', cwd: '/repo/recent', lastUserInput: 'Old prompt', lastInputAt: 100, updatedAt: 100, settings: { metadata: {} } },
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];

  api.render();
  const selectPromise = api.selectSession('session_recent');
  api.showSessionList();

  assert.match(context.document.querySelector('#app').innerHTML, /Other prompt[\s\S]*Old prompt/u);

  assert.equal(typeof resolveSessionDetail, 'function');
  resolveSessionDetail({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_recent',
        cwd: '/repo/recent',
        lastUserInput: 'Newest prompt',
        lastInputAt: 300,
        updatedAt: 300,
        settings: { metadata: {} },
        thread: { turns: [] },
      },
    }),
  });
  await selectPromise;
  await flushMicrotasks();

  assert.equal(api.state.view, 'sessions');
  assert.match(context.document.querySelector('#app').innerHTML, /Newest prompt[\s\S]*Other prompt/u);
});

test('all tab rerenders in time order when background session refresh finishes after returning to list', async () => {
  let resolveSessionRefresh: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_recent') {
        return await new Promise((resolve) => {
          resolveSessionRefresh = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sortMode = 'time';
  api.state.sessionsScope = 'all';
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessionId = 'session_recent';
  api.state.currentSession = { id: 'session_recent', cwd: '/repo/recent', lastUserInput: 'Old prompt', lastInputAt: 100, updatedAt: 100, settings: { metadata: {} } };
  api.state.sessions = [
    { id: 'session_other', cwd: '/repo/other', lastUserInput: 'Other prompt', lastInputAt: 200, updatedAt: 200, settings: { metadata: {} } },
    api.state.currentSession,
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Old prompt' },
  ];

  api.render();
  const refreshPromise = api.refreshCurrentSessionMetadata();
  api.showSessionList();

  assert.match(context.document.querySelector('#app').innerHTML, /Other prompt[\s\S]*Old prompt/u);

  assert.equal(typeof resolveSessionRefresh, 'function');
  resolveSessionRefresh({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_recent',
        cwd: '/repo/recent',
        lastUserInput: 'Newest prompt',
        lastInputAt: 300,
        updatedAt: 300,
        settings: { metadata: {} },
        thread: { turns: [] },
      },
    }),
  });
  await refreshPromise;
  await flushMicrotasks();

  assert.equal(api.state.view, 'sessions');
  assert.match(context.document.querySelector('#app').innerHTML, /Newest prompt[\s\S]*Other prompt/u);
});

test('all tab uses newer updatedAt when refreshed session omits lastInputAt', async () => {
  let resolveSessionRefresh: ((response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_recent') {
        return await new Promise((resolve) => {
          resolveSessionRefresh = resolve;
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  api.state.token = 'token';
  api.state.authSession = { id: 'auth_1' };
  api.state.view = 'chat';
  api.state.sortMode = 'time';
  api.state.sessionsScope = 'all';
  api.state.sessionsLoadedByScope.all = true;
  api.state.sessionId = 'session_recent';
  api.state.currentSession = { id: 'session_recent', cwd: '/repo/recent', lastUserInput: 'Old prompt', lastInputAt: 100, updatedAt: 100, settings: { metadata: {} } };
  api.state.sessions = [
    { id: 'session_other', cwd: '/repo/other', lastUserInput: 'Other prompt', lastInputAt: 200, updatedAt: 200, settings: { metadata: {} } },
    api.state.currentSession,
  ];
  api.state.sessionsByScope.all = [...api.state.sessions];
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'pending', text: 'Old prompt' },
  ];

  api.render();
  const refreshPromise = api.refreshCurrentSessionMetadata();
  api.showSessionList();

  assert.match(context.document.querySelector('#app').innerHTML, /Other prompt[\s\S]*Old prompt/u);

  assert.equal(typeof resolveSessionRefresh, 'function');
  resolveSessionRefresh({
    ok: true,
    status: 200,
    json: async () => ({
      session: {
        id: 'session_recent',
        cwd: '/repo/recent',
        lastUserInput: 'Newest prompt',
        updatedAt: 300,
        settings: { metadata: {} },
        thread: { turns: [] },
      },
    }),
  });
  await refreshPromise;
  await flushMicrotasks();

  assert.equal(api.state.view, 'sessions');
  assert.match(context.document.querySelector('#app').innerHTML, /Newest prompt[\s\S]*Other prompt/u);
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
  assert.match(app, /<button class="ghost compact-button" type="button" id="archive-cancel-button">Cancel<\/button>/u);
  assert.match(app, /<button class="danger compact-button" type="button" data-session-archive-confirm-id="\$\{escapeAttribute\(session\.id\)\}">Archive<\/button>/u);
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

test('foreground recovery keeps the latest chat message visible after browser resume resets scroll to top', async () => {
  const { api, context } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_1',
              cwd: '/repo',
              activeTurnId: 'turn_active',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from phone' },
                      { type: 'message', role: 'assistant', text: 'Latest answer from history' },
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
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Question from phone' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest answer from history' },
  ];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1200;
  timeline.clientHeight = 400;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  context.document.visibilityState = 'hidden';
  context.onVisibilityChange();

  timeline.scrollTop = 0;
  context.document.visibilityState = 'visible';
  await context.recoverActiveTurnAfterForeground();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(api.state.timelineShouldFollowLatest, true);
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight);
});

test('foreground recovery keeps the latest chat message visible even when hidden lifecycle was skipped', async () => {
  const { api, context } = await loadAppHarness({
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
                      { type: 'message', role: 'user', text: 'Question from phone' },
                      { type: 'message', role: 'assistant', text: 'Latest answer from history' },
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
  api.state.currentSession = { id: 'session_1', cwd: '/repo', settings: { metadata: {} } };
  api.state.timeline = [
    { id: 'm1', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Question from phone' },
    { id: 'm2', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Latest answer from history' },
  ];
  api.render();

  const timeline = context.document.querySelector('#timeline');
  timeline.scrollHeight = 1200;
  timeline.clientHeight = 400;
  timeline.scrollTop = 800;
  api.updateTimelineFollowState();

  timeline.scrollTop = 0;
  await context.recoverActiveTurnAfterForeground();

  const restoredTimeline = context.document.querySelector('#timeline');
  assert.equal(api.state.timelineShouldFollowLatest, true);
  assert.equal(restoredTimeline.scrollTop, restoredTimeline.scrollHeight);
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
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn"><span>Paused</span></div>');
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

test('PWA history refresh surfaces the latest failed turn as a visible error', async () => {
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
                    id: 'turn_failed',
                    status: 'failed',
                    error: 'unexpected status 403 Forbidden: invalid credentials',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from PWA' },
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
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  await api.refreshCurrentView();

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Turn failed');
  assert.equal(api.state.statusTone, 'danger');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="danger"><span>Failed</span></div>');
  assert.equal(api.state.error, '');
  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_failed');
  assert.equal(errorItem?.kind, 'message');
  assert.equal(errorItem?.role, 'system');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /403 Forbidden/u);
  assert.match(api.renderTimelineItem(errorItem), /message-card system error-message/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('opening a session surfaces a failed terminal turn as a visible error', async () => {
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      if (path === '/api/sessions/session_failed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_failed',
              cwd: '/repo',
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_forbidden',
                    status: 'failed',
                    error: 'unexpected status 403 Forbidden',
                    items: [
                      { type: 'message', role: 'user', text: 'Trigger auth failure' },
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
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_failed', cwd: '/repo', settings: { metadata: {} } }];

  await api.selectSession('session_failed');

  assert.equal(api.state.view, 'chat');
  assert.equal(api.state.status, 'Turn failed');
  assert.equal(api.state.statusTone, 'danger');
  assert.equal(api.state.error, '');
  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_forbidden');
  assert.equal(errorItem?.severity, 'error');
  assert.match(errorItem?.text || '', /403 Forbidden/u);
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('failed terminal turns without details still render a fallback error', async () => {
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
                    id: 'turn_failed_without_details',
                    status: 'failed',
                    error: null,
                    items: [
                      { type: 'message', role: 'user', text: 'No details failure' },
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

  await api.refreshCurrentView();

  assert.equal(api.state.error, '');
  const errorItem = api.state.timeline.find((item) => item.id === 'error_turn_failed_without_details');
  assert.equal(errorItem?.severity, 'error');
  assert.equal(errorItem?.text, 'Turn failed');
  assert.doesNotMatch(api.renderChat().innerHTML, /composer-error/u);
});

test('interrupted turn events render as stopped instead of interrupted', async () => {
  const { api } = await loadAppHarness();

  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stop';
  api.applyTurnEvent({
    type: 'turn.completed',
    turnId: 'turn_stop',
    threadId: 'session_1',
    status: 'interrupted',
  }, null);

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.status, 'Turn stopped');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn"><span>Stopped</span></div>');
});

test('history refresh renders interrupted terminal turns as stopped', async () => {
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
                    id: 'turn_cancelled',
                    status: 'cancelled',
                    items: [
                      { type: 'message', role: 'user', text: 'Stop this' },
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

  await api.refreshCurrentView();

  assert.equal(api.state.status, 'Turn stopped');
  assert.equal(api.state.statusTone, 'warn');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="warn"><span>Stopped</span></div>');
});

test('PWA history refresh clears stale running state from the latest terminal turn', async () => {
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
                    id: 'turn_newer_completed',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Question from another client' },
                      { type: 'message', role: 'assistant', text: 'Completed elsewhere' },
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
  api.state.pendingTurn = true;
  api.state.turnId = 'turn_stale';
  api.state.streamWasBackgrounded = true;
  api.state.status = 'Turn running';
  api.state.statusTone = 'warn';

  await api.refreshCurrentSessionMetadata({ hydrateTimeline: true });

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.streamWasBackgrounded, false);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.statusTone, 'success');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="success"><span>Done</span></div>');
});

test('session refresh restores running status when backend reports an active turn', async () => {
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
              activeTurnId: 'turn_active',
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
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="work"><span>Running</span></div>');
  assert.ok(fetchCalls.includes('/api/turns/turn_active/events'));
});

test('session refresh ignores stale in-progress history without a backend active turn', async () => {
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
              activeTurnId: null,
              settings: { metadata: {} },
              thread: {
                turns: [
                  {
                    id: 'turn_stale',
                    status: 'in_progress',
                    items: [
                      { type: 'message', role: 'user', text: 'Old question before service restart' },
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
  api.state.pendingTurn = false;
  api.state.status = 'Ready';
  api.state.statusTone = 'success';

  await api.refreshCurrentView();

  assert.equal(api.state.pendingTurn, false);
  assert.equal(api.state.turnId, null);
  assert.equal(api.state.status, 'Ready');
  assert.equal(api.state.statusTone, 'success');
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="success"><span>Done</span></div>');
  assert.deepEqual(fetchCalls, ['/api/sessions/session_1']);
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
              activeTurnId: 'turn_active',
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
  assert.equal(api.renderComposerStatus(), '<div class="composer-status" data-tone="work"><span>Running</span></div>');
  assert.ok(fetchCalls.includes('/api/turns/turn_active/events'));
});

test('opening a session uses backend timeline command messages without dropping them', async () => {
  const fetchCalls = [];
  const { api } = await loadAppHarness({
    fetch: async (path) => {
      fetchCalls.push(path);
      if (path === '/api/sessions/session_goal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              id: 'session_goal',
              cwd: '/repo',
              settings: { metadata: {} },
              timeline: [
                { id: 'history_turn_1_0', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Original question' },
                { id: 'history_turn_1_1', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Original answer' },
                { id: 'command_help_show', kind: 'message', role: 'system', label: '/help', meta: 'show', text: '支持的命令：/help /goal' },
                { id: 'command_goal_show', kind: 'message', role: 'system', label: '/goal', meta: 'show', text: 'Goal (active): ship slash goal support' },
                { id: 'history_turn_2_2', kind: 'message', role: 'user', label: 'You', meta: 'history', text: 'Later question' },
                { id: 'history_turn_2_3', kind: 'message', role: 'assistant', label: 'Assistant', meta: 'history', text: 'Later answer' },
              ],
              thread: {
                turns: [
                  {
                    id: 'turn_1',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Original question' },
                      { type: 'message', role: 'assistant', text: 'Original answer' },
                    ],
                  },
                  {
                    id: 'turn_2',
                    status: 'completed',
                    items: [
                      { type: 'message', role: 'user', text: 'Later question' },
                      { type: 'message', role: 'assistant', text: 'Later answer' },
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
  api.state.view = 'sessions';
  api.state.sessions = [{ id: 'session_goal', cwd: '/repo', settings: { metadata: {} } }];

  await api.selectSession('session_goal');

  assert.ok(fetchCalls.includes('/api/sessions/session_goal'));
  assert.equal(JSON.stringify(api.state.timeline.map((item) => item.text)), JSON.stringify([
    'Original question',
    'Original answer',
    '支持的命令：/help /goal',
    'Goal (active): ship slash goal support',
    'Later question',
    'Later answer',
  ]));
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
  const storage = new Map(Object.entries(overrides.storage || {}));
  const elements = new Map();
  let activeElement = null;
  const trackElement = (selector, element) => {
    elements.set(selector, element);
    return element;
  };
  const createTrackedElement = (selector, patch = {}) => ({
    innerHTML: '',
    style: {},
    classList: {
      add() {},
      remove() {},
    },
    hidden: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ height: 0 }),
    focus() {
      activeElement = this;
    },
    ...patch,
  });
  const materializeAppHtml = (html) => {
    elements.delete('#timeline');
    elements.delete('#prompt-input');
    elements.delete('.report-viewer');
    if (String(html || '').includes('id="timeline"')) {
      const timelineHtml = String(html).match(/<main class="timeline" id="timeline">([\s\S]*?)<\/main>/u)?.[1] || '';
      trackElement('#timeline', createTrackedElement('#timeline', {
        innerHTML: timelineHtml,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
      }));
    }
    if (String(html || '').includes('id="prompt-input"')) {
      trackElement('#prompt-input', createTrackedElement('#prompt-input', {
        value: '',
        scrollHeight: 38,
      }));
    }
    if (String(html || '').includes('class="report-viewer"')) {
      const reportHtml = String(html).match(/<main class="report-viewer">([\s\S]*?)<\/main>/u)?.[1] || '';
      trackElement('.report-viewer', createTrackedElement('.report-viewer', {
        innerHTML: reportHtml,
        scrollTop: 0,
        scrollHeight: 1200,
        clientHeight: 600,
      }));
    }
  };
  const appElement = {
    _innerHTML: '',
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = String(value || '');
      context.__appRenderCount += 1;
      materializeAppHtml(this._innerHTML);
    },
    appendChild(child) {
      this.innerHTML = child?.innerHTML || '';
    },
  };
  trackElement('#app', appElement);
  const context = {
    console,
    __appRenderCount: 0,
    __elements: elements,
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
      get activeElement() {
        return activeElement;
      },
      documentElement: {
        dataset: {},
        style: {
          removeProperty() {},
          setProperty() {},
        },
      },
      addEventListener() {},
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: () => [],
      createElement: () => ({
        className: '',
        innerHTML: '',
      }),
    },
    window: {
      innerWidth: overrides.viewportWidth ?? 390,
      location: {
        pathname: overrides.pathname || '/',
        reload() {},
      },
      addEventListener() {},
      matchMedia: overrides.matchMedia || ((query: string) => ({
        matches: Boolean(overrides.desktopPointer) && query === '(hover: hover) and (pointer: fine)',
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })),
      scrollTo() {},
    },
    navigator: {
      userAgent: 'Node test',
    },
    requestAnimationFrame: (callback) => {
      callback();
    },
    setTimeout: overrides.setTimeout || setTimeout,
    clearTimeout: overrides.clearTimeout || clearTimeout,
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
  context: globalThis,
  render: typeof render === 'function' ? render : null,
  DESKTOP_WORKSPACE_MIN_WIDTH: typeof DESKTOP_WORKSPACE_MIN_WIDTH === 'number' ? DESKTOP_WORKSPACE_MIN_WIDTH : null,
  isDesktopLayout: typeof isDesktopLayout === 'function' ? isDesktopLayout : null,
  handleLayoutResize: typeof handleLayoutResize === 'function' ? handleLayoutResize : null,
  renderDesktopWorkspace: typeof renderDesktopWorkspace === 'function' ? renderDesktopWorkspace : null,
  renderDesktopSidebar: typeof renderDesktopSidebar === 'function' ? renderDesktopSidebar : null,
  renderDesktopChatPane: typeof renderDesktopChatPane === 'function' ? renderDesktopChatPane : null,
  ensureDesktopActiveSession: typeof ensureDesktopActiveSession === 'function' ? ensureDesktopActiveSession : null,
  MAX_TIMELINE_CACHE_MAP_ITEMS: typeof MAX_TIMELINE_CACHE_MAP_ITEMS === 'number' ? MAX_TIMELINE_CACHE_MAP_ITEMS : null,
  MAX_TIMELINE_SUMMARY_TEXT: typeof MAX_TIMELINE_SUMMARY_TEXT === 'number' ? MAX_TIMELINE_SUMMARY_TEXT : null,
  firstInputForSession,
  previewInputForSession: typeof previewInputForSession === 'function' ? previewInputForSession : null,
  renderSessionCards: typeof renderSessionCards === 'function' ? renderSessionCards : null,
  renderSessionList: typeof renderSessionList === 'function' ? renderSessionList : null,
  renderNewSession: typeof renderNewSession === 'function' ? renderNewSession : null,
  renderAdminConsole: typeof renderAdminConsole === 'function' ? renderAdminConsole : null,
  upsertSession: typeof upsertSession === 'function' ? upsertSession : null,
  renderChat: typeof renderChat === 'function' ? renderChat : null,
  renderChatContent: typeof renderChatContent === 'function' ? renderChatContent : null,
  renderReportsPage: typeof renderReportsPage === 'function' ? renderReportsPage : null,
  renderReportViewer: typeof renderReportViewer === 'function' ? renderReportViewer : null,
  renderTimelineItem: typeof renderTimelineItem === 'function' ? renderTimelineItem : null,
  renderComposerStatus: typeof renderComposerStatus === 'function' ? renderComposerStatus : null,
  applyMessageFontSize: typeof applyMessageFontSize === 'function' ? applyMessageFontSize : null,
  setMessageFontSize: typeof setMessageFontSize === 'function' ? setMessageFontSize : null,
  updateComposerExpansionState: typeof updateComposerExpansionState === 'function' ? updateComposerExpansionState : null,
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
  loadSharedSessionFromLocation: typeof loadSharedSessionFromLocation === 'function' ? loadSharedSessionFromLocation : null,
  ensureSession: typeof ensureSession === 'function' ? ensureSession : null,
  refreshProjectsList: typeof refreshProjectsList === 'function' ? refreshProjectsList : null,
	  refreshReportsList: typeof refreshReportsList === 'function' ? refreshReportsList : null,
	  openReportsPage: typeof openReportsPage === 'function' ? openReportsPage : null,
	  closeReportsPage: typeof closeReportsPage === 'function' ? closeReportsPage : null,
	  handleReportsBackNavigation: typeof handleReportsBackNavigation === 'function' ? handleReportsBackNavigation : null,
	  toggleReportFavorite: typeof toggleReportFavorite === 'function' ? toggleReportFavorite : null,
	  showSessionList: typeof showSessionList === 'function' ? showSessionList : null,
	  openAppSettingsPage: typeof openAppSettingsPage === 'function' ? openAppSettingsPage : null,
	  openAdminConsole: typeof openAdminConsole === 'function' ? openAdminConsole : null,
	  openNewSessionPage: typeof openNewSessionPage === 'function' ? openNewSessionPage : null,
	  openReportById: typeof openReportById === 'function' ? openReportById : null,
	  closeReportViewer: typeof closeReportViewer === 'function' ? closeReportViewer : null,
  openReportByPath: typeof openReportByPath === 'function' ? openReportByPath : null,
  getActiveScrollContainer: typeof getActiveScrollContainer === 'function' ? getActiveScrollContainer : null,
  setSessionSortMode: typeof setSessionSortMode === 'function' ? setSessionSortMode : null,
  selectSession: typeof selectSession === 'function' ? selectSession : null,
  onComposerSubmit: typeof onComposerSubmit === 'function' ? onComposerSubmit : null,
  onNewSessionSubmit: typeof onNewSessionSubmit === 'function' ? onNewSessionSubmit : null,
  handlePromptKeydown: typeof handlePromptKeydown === 'function' ? handlePromptKeydown : null,
  attachTimelineScrollTracking: typeof attachTimelineScrollTracking === 'function' ? attachTimelineScrollTracking : null,
  updateTimelineFollowState: typeof updateTimelineFollowState === 'function' ? updateTimelineFollowState : null,
  scrollTimelineToBottomIfFollowingLatest: typeof scrollTimelineToBottomIfFollowingLatest === 'function' ? scrollTimelineToBottomIfFollowingLatest : null,
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
