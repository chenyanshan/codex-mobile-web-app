import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileReportStore } from '../src/report_store.js';

test('file report store lists markdown and html reports grouped by project', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  await fs.mkdir(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19'), { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19', 'summary.md'), '# Summary\n', 'utf8');
  await fs.writeFile(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19', 'audit.html'), '<h1>Audit</h1>\n', 'utf8');
  await fs.writeFile(path.join(reportsDir, 'codex-mobile-web-app', '2026-05-19', 'notes.txt'), 'ignored\n', 'utf8');

  const store = new FileReportStore({ reportsDir, indexPath });
  const reports = await store.listReports();

  assert.deepEqual(reports.map((report) => ({
    id: report.id,
    project: report.project,
    title: report.title,
    kind: report.kind,
    favorite: report.favorite,
  })), [
    {
      id: 'codex-mobile-web-app/2026-05-19/audit.html',
      project: 'codex-mobile-web-app',
      title: 'audit',
      kind: 'html',
      favorite: false,
    },
    {
      id: 'codex-mobile-web-app/2026-05-19/summary.md',
      project: 'codex-mobile-web-app',
      title: 'summary',
      kind: 'markdown',
      favorite: false,
    },
  ]);
});

test('file report store persists favorite state in report index', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  await fs.mkdir(path.join(reportsDir, 'project-a', '2026-05-19'), { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'project-a', '2026-05-19', 'summary.md'), '# Summary\n', 'utf8');

  const store = new FileReportStore({ reportsDir, indexPath });
  const updated = await store.setFavorite('project-a/2026-05-19/summary.md', true);
  const reloaded = new FileReportStore({ reportsDir, indexPath });
  const report = await reloaded.readReport('project-a/2026-05-19/summary.md');

  assert.equal(updated?.favorite, true);
  assert.equal(report?.favorite, true);
  const raw = JSON.parse(await fs.readFile(indexPath, 'utf8')) as {
    reports: Record<string, { favorite: boolean }>;
  };
  assert.equal(raw.reports['project-a/2026-05-19/summary.md']?.favorite, true);
});

test('file report store resolves absolute paths only under reports root', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  const reportPath = path.join(reportsDir, 'project-a', '2026-05-19', 'summary.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, '# Summary\n', 'utf8');

  const store = new FileReportStore({ reportsDir, indexPath });
  const resolved = await store.resolveReport(reportPath);

  assert.equal(resolved?.id, 'project-a/2026-05-19/summary.md');
  await assert.rejects(
    () => store.resolveReport(path.join(dir, 'outside.md')),
    /outside the reports directory/u,
  );
});

test('file report store rejects symlinks that escape reports root', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-reports-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const reportsDir = path.join(dir, 'reports');
  const indexPath = path.join(dir, 'report-index.json');
  const outside = path.join(dir, 'outside.md');
  const link = path.join(reportsDir, 'project-a', '2026-05-19', 'outside.md');
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.writeFile(outside, '# Outside\n', 'utf8');
  await fs.symlink(outside, link);

  const store = new FileReportStore({ reportsDir, indexPath });

  await assert.rejects(
    () => store.readReport('project-a/2026-05-19/outside.md'),
    /outside the reports directory/u,
  );
});
