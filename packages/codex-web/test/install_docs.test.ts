import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('install.md is the AI install entrypoint for GitHub blob links and local project installs', async () => {
  const installDoc = await readRepoFile('install.md');

  assert.match(installDoc, /ai_entrypoint:\s*true/u);
  assert.match(installDoc, /README\.md/u);
  assert.match(installDoc, /install\.md/u);
  assert.match(installDoc, /Windows.*unsupported/iu);
  assert.match(installDoc, /scripts\/install\/install-codex-web-macos\.sh/u);
  assert.match(installDoc, /--password/u);
  assert.match(installDoc, /--autostart/u);
  assert.match(installDoc, /skills\/codex-mobile-report/u);
  assert.match(installDoc, /~\/\.codex-web\/reports\//u);
  assert.match(installDoc, /phone-readable report/u);
});

test('README files point AI installers to install.md and include PWA setup guidance', async () => {
  const readme = await readRepoFile('README.md');
  const readmeZh = await readRepoFile('README.zh-CN.md');

  assert.match(readme, /install\.md/u);
  assert.match(readme, /AI install/i);
  assert.match(readme, /Help me install https:\/\/github\.com\/chenyanshan\/codex-mobile-web-app\/blob\/main\/README\.md/u);
  assert.match(readme, /codex-mobile-report/u);
  assert.match(readme, /Add to Home Screen/u);
  assert.match(readme, /Android/u);

  assert.match(readmeZh, /install\.md/u);
  assert.match(readmeZh, /AI 安装/u);
  assert.match(readmeZh, /帮我安装 https:\/\/github\.com\/chenyanshan\/codex-mobile-web-app\/blob\/main\/README\.md/u);
  assert.match(readmeZh, /codex-mobile-report/u);
  assert.match(readmeZh, /添加到主屏幕/u);
  assert.match(readmeZh, /Android/u);
});
