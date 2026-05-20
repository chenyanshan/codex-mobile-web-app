import fs from 'node:fs/promises';
import path from 'node:path';

export type CodexWebReportKind = 'markdown' | 'html';

export interface CodexWebReport {
  id: string;
  project: string;
  title: string;
  kind: CodexWebReportKind;
  path: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
}

export interface CodexWebReportContent {
  report: CodexWebReport;
  content: string;
}

interface ReportIndexFile {
  version: 1;
  reports: Record<string, ReportIndexEntry>;
}

interface ReportIndexEntry {
  favorite?: boolean;
  title?: string;
  project?: string;
  createdAt?: string;
  updatedAt?: string;
}

const REPORT_EXTENSIONS = new Map<string, CodexWebReportKind>([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.html', 'html'],
  ['.htm', 'html'],
]);

export class FileReportStore {
  private readonly reportsDir: string;

  private readonly indexPath: string;

  private indexCache: ReportIndexFile | null = null;

  constructor({ reportsDir, indexPath }: { reportsDir: string; indexPath: string }) {
    this.reportsDir = path.resolve(reportsDir);
    this.indexPath = indexPath;
  }

  async listReports(): Promise<CodexWebReport[]> {
    const entries = await this.scanDirectory(this.reportsDir);
    entries.sort((left, right) => {
      if (left.favorite !== right.favorite) {
        return left.favorite ? -1 : 1;
      }
      return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
    });
    return entries;
  }

  async readReport(reportId: string): Promise<CodexWebReport | null> {
    const absolutePath = await this.resolveReportPath(reportId);
    const stat = await fs.stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!stat?.isFile()) {
      return null;
    }
    const id = await this.reportIdFromPath(absolutePath);
    return this.toReport(id, absolutePath, stat);
  }

  async readContent(reportId: string): Promise<CodexWebReportContent | null> {
    const report = await this.readReport(reportId);
    if (!report) {
      return null;
    }
    return {
      report,
      content: await fs.readFile(report.path, 'utf8'),
    };
  }

  async resolveReport(inputPath: string): Promise<CodexWebReport | null> {
    const absolutePath = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : await this.resolveReportPath(inputPath);
    const id = await this.reportIdFromPath(absolutePath);
    return this.readReport(id);
  }

  async setFavorite(reportId: string, favorite: boolean): Promise<CodexWebReport | null> {
    const report = await this.readReport(reportId);
    if (!report) {
      return null;
    }
    const index = await this.readIndex();
    index.reports[report.id] = {
      ...index.reports[report.id],
      favorite,
      title: report.title,
      project: report.project,
      updatedAt: new Date().toISOString(),
    };
    await this.writeIndex(index);
    return {
      ...report,
      favorite,
    };
  }

  private async scanDirectory(directory: string): Promise<CodexWebReport[]> {
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const reports: CodexWebReport[] = [];
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        reports.push(...await this.scanDirectory(absolutePath));
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }
      if (!REPORT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
          continue;
        }
        const id = await this.reportIdFromPath(absolutePath);
        reports.push(await this.toReport(id, absolutePath, stat));
      } catch (error) {
        if (!isPathEscapeError(error)) {
          throw error;
        }
      }
    }
    return reports;
  }

  private async toReport(
    id: string,
    absolutePath: string,
    stat: import('node:fs').Stats,
  ): Promise<CodexWebReport> {
    const index = await this.readIndex();
    const indexed = index.reports[id] ?? {};
    const parts = id.split('/');
    const fallbackTitle = path.basename(id, path.extname(id));
    return {
      id,
      project: normalizeIndexedString(indexed.project) || parts[0] || 'reports',
      title: normalizeIndexedString(indexed.title) || fallbackTitle,
      kind: REPORT_EXTENSIONS.get(path.extname(id).toLowerCase()) ?? 'markdown',
      path: absolutePath,
      sizeBytes: stat.size,
      createdAt: normalizeIndexedString(indexed.createdAt) || stat.birthtime.toISOString(),
      updatedAt: normalizeIndexedString(indexed.updatedAt) || stat.mtime.toISOString(),
      favorite: indexed.favorite === true,
    };
  }

  private async resolveReportPath(reportId: string): Promise<string> {
    const normalized = normalizeReportId(reportId);
    return this.assertInsideReportsRoot(path.join(this.reportsDir, ...normalized.split('/')));
  }

  private async reportIdFromPath(absolutePath: string): Promise<string> {
    const insidePath = await this.assertInsideReportsRoot(absolutePath);
    if (!REPORT_EXTENSIONS.has(path.extname(insidePath).toLowerCase())) {
      throw new Error('Report must be a markdown or html file.');
    }
    return path.relative(this.reportsDir, insidePath).split(path.sep).join('/');
  }

  private async assertInsideReportsRoot(absolutePath: string): Promise<string> {
    const root = await realpathIfExists(this.reportsDir);
    const target = await fs.realpath(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return path.resolve(absolutePath);
      }
      throw error;
    });
    if (!isPathInside(root, target)) {
      throw new Error('Report path is outside the reports directory.');
    }
    return path.resolve(absolutePath);
  }

  private async readIndex(): Promise<ReportIndexFile> {
    if (this.indexCache) {
      return this.indexCache;
    }
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8')) as Partial<ReportIndexFile>;
      this.indexCache = {
        version: 1,
        reports: isRecord(parsed.reports) ? parsed.reports as Record<string, ReportIndexEntry> : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      this.indexCache = { version: 1, reports: {} };
    }
    return this.indexCache;
  }

  private async writeIndex(index: ReportIndexFile): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true, mode: 0o700 });
    const tmpPath = `${this.indexPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmpPath, this.indexPath);
    this.indexCache = index;
  }
}

function normalizeReportId(value: string): string {
  const normalized = String(value || '').replace(/\\/gu, '/').replace(/^\/+/u, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid report id.');
  }
  return parts.join('/');
}

async function realpathIfExists(directory: string): Promise<string> {
  try {
    return await fs.realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return path.resolve(directory);
    }
    throw error;
  }
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isPathEscapeError(error: unknown): boolean {
  return error instanceof Error && /outside the reports directory/u.test(error.message);
}

function normalizeIndexedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
