import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootPackageUrl = new URL('../../../package.json', import.meta.url);
const webPackageUrl = new URL('../package.json', import.meta.url);
const nativePackageUrl = new URL('../../codex-native-api/package.json', import.meta.url);

test('development serve loads codex native api source instead of stale dist', async () => {
  const [rootPackage, webPackage, nativePackage] = await Promise.all([
    readPackage(rootPackageUrl),
    readPackage(webPackageUrl),
    readPackage(nativePackageUrl),
  ]);

  assert.match(String(rootPackage.scripts?.['codex-web'] ?? ''), /--conditions=development/u);
  assert.match(String(webPackage.scripts?.serve ?? ''), /--conditions=development/u);
  assert.equal(nativePackage.exports?.['.']?.development, './src/index.ts');
  assert.equal(nativePackage.exports?.['.']?.default, './dist/index.js');
});

async function readPackage(url: URL): Promise<any> {
  return JSON.parse(await readFile(url, 'utf8'));
}
