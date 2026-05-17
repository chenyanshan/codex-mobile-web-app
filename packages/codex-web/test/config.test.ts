import assert from 'node:assert/strict';
import test from 'node:test';
import { loadServiceConfig } from '../src/config.js';

test('service config defaults to LAN-facing binding and external state paths', () => {
  const config = loadServiceConfig({ env: {}, homeDir: '/Users/alice' });

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 43210);
  assert.equal(config.defaultCwd, '/Users/alice');
  assert.equal(config.stateDir, '/Users/alice/.codex-web');
  assert.equal(config.authPath, '/Users/alice/.codex-web/auth.json');
  assert.equal(config.envPath, '/Users/alice/.config/codex-web/service.env');
});

test('service config accepts explicit local-only host and port', () => {
  const config = loadServiceConfig({
    env: {
      CODEX_WEB_HOST: '127.0.0.1',
      CODEX_WEB_PORT: '45678',
      CODEX_WEB_DEFAULT_CWD: '/workspace',
      CODEX_REAL_BIN: '/opt/homebrew/bin/codex',
    },
    homeDir: '/Users/alice',
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 45678);
  assert.equal(config.defaultCwd, '/workspace');
  assert.equal(config.codexBin, '/opt/homebrew/bin/codex');
});
