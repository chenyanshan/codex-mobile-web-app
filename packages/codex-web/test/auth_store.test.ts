import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuthStore } from '../src/auth_store.js';

test('password setup stores only salted hash and login creates reusable session token', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });

  await store.setPassword('correct horse battery staple');
  const raw = await fs.readFile(authPath, 'utf8');
  assert.equal(raw.includes('correct horse battery staple'), false);
  const stat = await fs.stat(authPath);
  assert.equal(stat.mode & 0o777, 0o600);

  const login = await store.login({
    password: 'correct horse battery staple',
    deviceName: 'iPhone Safari',
  });
  assert.match(login.token, /^cw_/);

  const state = JSON.parse(await fs.readFile(authPath, 'utf8'));
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].deviceName, 'iPhone Safari');
  assert.equal(state.sessions[0].tokenHash.includes(login.token), false);

  const session = await store.verifyToken(login.token);
  assert.equal(session?.deviceName, 'iPhone Safari');
});

test('login rejects when password is not configured and does not create auth state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });

  await assert.rejects(
    () => store.login({ password: 'correct horse battery staple', deviceName: 'iPhone Safari' }),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error & { code?: string }).code, 'setup_required');
      assert.match((error as Error).message, /password not configured/i);
      return true;
    },
  );

  await assert.rejects(() => fs.readFile(authPath, 'utf8'), { code: 'ENOENT' });
});

test('invalid login is rejected and logout removes only current session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const store = new AuthStore({ authPath: path.join(dir, 'auth.json') });
  await store.setPassword('password-one');

  await assert.rejects(
    () => store.login({ password: 'wrong', deviceName: 'bad' }),
    /Invalid password/,
  );

  const first = await store.login({ password: 'password-one', deviceName: 'phone-a' });
  const second = await store.login({ password: 'password-one', deviceName: 'phone-b' });
  await store.logout(first.token);

  assert.equal(await store.verifyToken(first.token), null);
  assert.equal((await store.verifyToken(second.token))?.deviceName, 'phone-b');
});

test('concurrent logins preserve every created session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');

  const logins = await Promise.all(Array.from({ length: 8 }, (_, index) => store.login({
    password: 'password-one',
    deviceName: `phone-${index + 1}`,
  })));

  assert.equal(logins.length, 8);
  const persisted = JSON.parse(await fs.readFile(authPath, 'utf8')) as {
    sessions: Array<{ deviceName: string }>;
  };
  assert.equal(persisted.sessions.length, 8);
  assert.deepEqual(
    persisted.sessions.map((session) => session.deviceName).sort(),
    [
      'phone-1',
      'phone-2',
      'phone-3',
      'phone-4',
      'phone-5',
      'phone-6',
      'phone-7',
      'phone-8',
    ],
  );
});

test('logout does not resurrect a token when verification is racing a stale write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const store = new AuthStore({ authPath });
  await store.setPassword('password-one');
  const login = await store.login({ password: 'password-one', deviceName: 'phone-a' });

  const originalWriteState = (store as any).writeState.bind(store) as (state: unknown) => Promise<void>;
  let blockNextWrite = true;
  let releaseBlockedWrite: (() => void) | null = null;
  let notifyBlockedWrite: (() => void) | null = null;
  const blockedWrite = new Promise<void>((resolve) => {
    notifyBlockedWrite = resolve;
  });
  const blockedWriteReleased = new Promise<void>((resolve) => {
    releaseBlockedWrite = resolve;
  });

  (store as any).writeState = async (state: unknown) => {
    if (blockNextWrite) {
      blockNextWrite = false;
      notifyBlockedWrite?.();
      await blockedWriteReleased;
    }
    await originalWriteState(state);
  };

  const verifyPromise = store.verifyToken(login.token);
  await blockedWrite;
  const logoutPromise = store.logout(login.token);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseBlockedWrite?.();

  await Promise.all([verifyPromise, logoutPromise]);
  assert.equal(await store.verifyToken(login.token), null);
});
