#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as defaultStdin, stdout as defaultStdout, stderr as defaultStderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { AuthStore, type PublicAuthSession } from './auth_store.js';
import { loadServiceConfig, type CodexWebConfig } from './config.js';
import { HybridAuthStore } from './hybrid_auth_store.js';
import { FileIdentityStore } from './identity_store.js';
import { CodexWebRuntime } from './runtime.js';
import { createCodexWebServer, type CodexWebAuthLike, type CodexWebServerHandle } from './server.js';
import { FileSessionSettingsStore } from './session_settings_store.js';
import { FileSessionTimelineStore } from './session_timeline_store.js';

const HELP_REPORT_PROJECT = 'codex-mobile-web-app';
const HELP_REPORT_DATE = '2026-05-22';
const HELP_REPORT_FILENAME = 'codex-web-help.md';
const HELP_REPORT_CONTENT = `# Codex Web 帮助

Codex Web 会在启动正常的 Codex turn 之前，先处理少量应用层 slash 命令。命令只作用于当前会话。每个会话维护一个目标。

## 支持的命令

| 命令 | 作用 | 会启动 Codex turn |
| :--- | :--- | :---: |
| \`/help\` | 显示支持的命令列表，并返回本说明链接。 | 否 |
| \`/goal\` | 显示当前会话的目标和状态。 | 否 |
| \`/goal <objective>\` | 设置或替换当前会话目标。 | 否 |
| \`/goal set <objective>\` | 显式设置或替换当前会话目标。 | 否 |
| \`/goal edit <objective>\` | 与 \`/goal set <objective>\` 相同；适合以编辑目标的方式思考时使用。 | 否 |
| \`/goal pause\` | 将当前目标标记为已暂停。 | 否 |
| \`/goal resume\` | 将当前目标重新标记为进行中。 | 否 |
| \`/goal clear\` | 清除当前会话目标。 | 否 |

## 工作方式

- 移动端应用通过正常的输入框接口发送 slash 命令文本。
- Web 后端会在调用 Codex turn start 之前识别这些受支持的命令。
- 已处理的命令会以系统消息的形式写入时间线。
- 已处理的命令不会打开 \`/api/turns/<turnId>/events\`，也不会创建原生 Codex turn。
- 看起来像 slash 命令但不受支持的输入，会按普通用户文本处理。

## 目标行为

| 操作 | 结果 |
| :--- | :--- |
| 设置 | 在当前 Codex 线程上保存一个目标。 |
| 查看 | 从原生 Codex app-server 读取线程目标。 |
| 暂停 | 保留目标内容，但把状态改为 paused。 |
| 恢复 | 把状态改回 active。 |
| 清除 | 从线程中移除目标。 |

## 说明

- 目标状态由 Codex 原生 app-server RPC 提供：\`thread/goal/get\`、\`thread/goal/set\` 和 \`thread/goal/clear\`。
- Codex Web 不会额外保存一份浏览器侧目标状态。
- UI 故意保留为文本命令方式，而不是再做一个复杂的目标编辑器。
`;

export type ParsedCliArgs =
  | {
    command: 'auth-set-password';
  }
  | {
    command: 'serve';
    host: string | null;
    port: number | null;
  };

interface WritableLike {
  write(chunk: string): boolean;
}

interface ReadableLike {
  isTTY?: boolean;
}

interface ServeCommandDependencies {
  env: NodeJS.ProcessEnv;
  loadConfig: (options?: { env?: NodeJS.ProcessEnv }) => CodexWebConfig;
  createAuthStore: (args: { authPath: string }) => CodexWebAuthLike & {
    isConfigured(): Promise<boolean>;
    setPassword(password: string): Promise<void>;
  };
  createRuntime: (args: { config: CodexWebConfig }) => CodexWebRuntime;
  createServer: (args: {
    auth: CodexWebAuthLike;
    runtime: CodexWebRuntime;
    config: CodexWebConfig;
  }) => CodexWebServerHandle;
  stdout: WritableLike;
}

interface AuthSetPasswordDependencies {
  env: NodeJS.ProcessEnv;
  loadConfig: (options?: { env?: NodeJS.ProcessEnv }) => CodexWebConfig;
  createAuthStore: (args: { authPath: string }) => {
    setPassword(password: string): Promise<void>;
  };
  promptForPassword: () => Promise<string>;
  stdout: WritableLike;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = parseCliArgs(argv);
  if (command.command === 'auth-set-password') {
    await runAuthSetPasswordCommand();
    return;
  }

  const server = await startServeCommand(command);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    defaultStdout.write(`stopping: ${signal}\n`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => { void stop('SIGINT'); });
  process.on('SIGTERM', () => { void stop('SIGTERM'); });

  await new Promise<void>(() => {});
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [first = '', second = '', ...rest] = argv;

  if (first === 'auth') {
    if (second !== 'set-password') {
      throw new Error('Unknown auth command. Expected: codex-web auth set-password');
    }
    if (rest.length > 0) {
      throw new Error('codex-web auth set-password does not accept additional arguments');
    }
    return { command: 'auth-set-password' };
  }

  const serveArgs = first === 'serve' ? [second, ...rest] : argv;
  return {
    command: 'serve',
    ...parseServeOptions(serveArgs),
  };
}

export async function runAuthSetPasswordCommand(
  dependencies: Partial<AuthSetPasswordDependencies> = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const loadConfigFn = dependencies.loadConfig ?? ((options?: { env?: NodeJS.ProcessEnv }) => loadServiceConfig(options));
  const config = loadConfigFn({ env });
  const identityStore = new FileIdentityStore({
    identityPath: path.join(config.stateDir, 'identity.json'),
  });
  const createAuthStoreFn = dependencies.createAuthStore ?? (({ authPath }) => new HybridAuthStore({
    legacyAuth: new AuthStore({ authPath }),
    identityStore,
  }));
  const promptForPassword = dependencies.promptForPassword ?? (() => readPasswordFromStdin({
    stdin: defaultStdin,
    stdout: defaultStdout,
  }));
  const stdout = dependencies.stdout ?? defaultStdout;
  const envPassword = takeOneTimePassword(env);
  const password = envPassword ?? await promptForPassword();

  await createAuthStoreFn({ authPath: config.authPath }).setPassword(password);
  stdout.write(`password_saved: ${config.authPath}\n`);
}

export async function startServeCommand(
  parsed: Extract<ParsedCliArgs, { command: 'serve' }>,
  dependencies: Partial<ServeCommandDependencies> = {},
): Promise<CodexWebServerHandle> {
  const env = dependencies.env ?? process.env;
  const loadConfigFn = dependencies.loadConfig ?? ((options?: { env?: NodeJS.ProcessEnv }) => loadServiceConfig(options));
  const baseConfig = loadConfigFn({ env });
  const config: CodexWebConfig = {
    ...baseConfig,
    host: parsed.host ?? baseConfig.host,
    port: parsed.port ?? baseConfig.port,
  };
  const bootstrapPassword = takeOneTimePassword(env);
  await ensureRuntimeDirectories(config);
  await ensureBundledReports(config);
  const identityStore = new FileIdentityStore({
    identityPath: path.join(config.stateDir, 'identity.json'),
  });
  const createAuthStoreFn = dependencies.createAuthStore ?? (({ authPath }) => new HybridAuthStore({
    legacyAuth: new AuthStore({ authPath }),
    identityStore,
  }));
  const auth = createAuthStoreFn({ authPath: config.authPath });

  if (!(await auth.isConfigured())) {
    if (bootstrapPassword) {
      await auth.setPassword(bootstrapPassword);
    }
  }

  const createRuntimeFn = dependencies.createRuntime ?? (({ config: runtimeConfig }) => new CodexWebRuntime({
    codexBin: runtimeConfig.codexBin,
    defaultCwd: runtimeConfig.defaultCwd,
    helpReportPath: helpReportPath(runtimeConfig),
    logger: runtimeConfig.debug
      ? {
        debug: writeDebugStderrLine,
        info: writeDebugStderrLine,
        warn: writeDebugStderrLine,
        error: writeDebugStderrLine,
      }
      : undefined,
    settingsStore: new FileSessionSettingsStore({
      settingsPath: path.join(runtimeConfig.stateDir, 'session-settings.json'),
    }),
    timelineStore: new FileSessionTimelineStore({
      timelinePath: path.join(runtimeConfig.stateDir, 'session-timeline.json'),
    }),
  }));
  const runtime = createRuntimeFn({ config });
  const createServerFn = dependencies.createServer ?? ((args) => createCodexWebServer({
    ...args,
    identityStore,
  }));
  const server = createServerFn({ auth, runtime, config });
  const stdout = dependencies.stdout ?? defaultStdout;

  await server.start();
  stdout.write('codex-web started\n');
  stdout.write(`base_url: ${server.baseUrl}\n`);
  stdout.write(`state_dir: ${config.stateDir}\n`);
  stdout.write(`auth_path: ${config.authPath}\n`);

  return server;
}

async function ensureRuntimeDirectories(config: CodexWebConfig): Promise<void> {
  await fs.promises.mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  await fs.promises.mkdir(path.join(config.stateDir, 'logs'), { recursive: true, mode: 0o700 });
  await fs.promises.mkdir(config.reportsDir, { recursive: true, mode: 0o700 });
}

async function ensureBundledReports(config: CodexWebConfig): Promise<void> {
  const reportPath = helpReportPath(config);
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(reportPath, HELP_REPORT_CONTENT, { mode: 0o600 });
}

function helpReportPath(config: CodexWebConfig): string {
  return path.join(
    config.reportsDir,
    HELP_REPORT_PROJECT,
    HELP_REPORT_DATE,
    HELP_REPORT_FILENAME,
  );
}

async function readPasswordFromStdin({
  stdin,
  stdout,
}: {
  stdin: ReadableLike & NodeJS.ReadStream;
  stdout: WritableLike;
}): Promise<string> {
  stdout.write('Password: ');
  const rl = readline.createInterface({
    input: stdin,
    output: stdout as NodeJS.WritableStream,
    terminal: Boolean(stdin.isTTY),
  });
  try {
    const password = await rl.question('');
    stdout.write('\n');
    return password;
  } finally {
    rl.close();
  }
}

function parseServeOptions(argv: string[]): { host: string | null; port: number | null } {
  let host: string | null = null;
  let port: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? '').trim();
    if (!arg) {
      continue;
    }
    if (arg === '--host') {
      host = requireOptionValue(argv, ++index, '--host');
      continue;
    }
    if (arg === '--port') {
      port = parsePort(requireOptionValue(argv, ++index, '--port'));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { host, port };
}

function requireOptionValue(argv: string[], index: number, flag: string): string {
  const value = String(argv[index] ?? '').trim();
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function takeOneTimePassword(env: NodeJS.ProcessEnv): string | null {
  const password = typeof env.CODEX_WEB_PASSWORD === 'string' && env.CODEX_WEB_PASSWORD.length > 0
    ? env.CODEX_WEB_PASSWORD
    : null;
  delete env.CODEX_WEB_PASSWORD;
  return password;
}

function writeDebugStderrLine(message: string): void {
  const normalized = String(message ?? '').trim();
  if (!normalized) {
    return;
  }
  for (const line of normalized.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (trimmed) {
      defaultStderr.write(`${trimmed}\n`);
    }
  }
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function formatCliError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function isCliEntrypoint(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }
  return normalizeEntrypointPath(fileURLToPath(import.meta.url)) === normalizeEntrypointPath(path.resolve(argvPath));
}

function normalizeEntrypointPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

if (isCliEntrypoint()) {
  void main().catch((error) => {
    defaultStderr.write(`${formatCliError(error)}\n`);
    process.exit(1);
  });
}
