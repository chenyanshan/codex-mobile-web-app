import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylesUrl = new URL('../public/styles.css', import.meta.url);
const appUrl = new URL('../public/app.js', import.meta.url);

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

test('mobile UI uses session list, compact composer, settings drawer, and history restore', async () => {
  const app = await readFile(appUrl, 'utf8');

  assert.match(app, /view:\s*'sessions'/u);
  assert.match(app, /renderSessionList\(\)/u);
  assert.match(app, /renderNewSession\(\)/u);
  assert.match(app, /renderChat\(\)/u);
  assert.match(app, /timelineCache:\s*new Map\(\)/u);
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
