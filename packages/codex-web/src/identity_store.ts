import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const PASSWORD_ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';
const DEFAULT_SITE_TITLE = 'Codex Web';

export interface CodexWebProjectGrant {
  projectId: string;
  canRead: boolean;
  canCreate: boolean;
  canWrite: boolean;
}

export interface CodexWebUser {
  id: string;
  username: string;
  enabled: boolean;
  canNewSession: boolean;
  passwordHash?: string;
  passwordSalt?: string;
  passwordIterations?: number;
  roleIds: string[];
  directProjectGrants: CodexWebProjectGrant[];
  favoriteProjectIds: string[];
}

export interface CodexWebRole {
  id: string;
  name: string;
  isAdmin: boolean;
  projectGrants: CodexWebProjectGrant[];
}

export interface CodexWebProject {
  id: string;
  internalName: string;
  cwd: string;
  displayName: string;
  enabled: boolean;
}

export interface CodexWebAppSession {
  id: string;
  codexThreadId: string;
  projectId: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodexWebShare {
  id: string;
  tokenHash: string;
  sessionId: string;
  createdByUserId: string;
  enabled: boolean;
  createdAt: string;
}

export interface CodexWebUserSession {
  id: string;
  tokenHash: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  userId: string;
}

export interface CodexWebIdentityState {
  settings: {
    multiUserEnabled: boolean;
    siteTitle: string;
  };
  users: CodexWebUser[];
  roles: CodexWebRole[];
  projects: CodexWebProject[];
  sessions: CodexWebAppSession[];
  shares: CodexWebShare[];
  userSessions: CodexWebUserSession[];
}

export interface UpsertUserWithPasswordInput {
  id: string;
  username: string;
  password: string;
  enabled?: boolean;
  canNewSession?: boolean;
  roleIds?: string[];
  directProjectGrants?: CodexWebProjectGrant[];
}

export interface UpdateUserAccessInput {
  id: string;
  enabled?: boolean;
  canNewSession?: boolean;
  roleIds?: string[];
  directProjectGrants?: CodexWebProjectGrant[];
}

export interface UpdateUserProjectFavoriteInput {
  userId: string;
  projectId: string;
  favorite: boolean;
}

export interface BootstrapAdminPasswordHashInput {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations?: number;
}

export class FileIdentityStore {
  private readonly identityPath: string;

  private mutationLock: Promise<void> = Promise.resolve();

  constructor({ identityPath }: { identityPath: string }) {
    this.identityPath = identityPath;
  }

  async readState(): Promise<CodexWebIdentityState> {
    try {
      const raw = await fs.readFile(this.identityPath, 'utf8');
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyState();
      }
      throw error;
    }
  }

  async setMultiUserEnabled(enabled: boolean): Promise<CodexWebIdentityState> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      state.settings.multiUserEnabled = enabled;
      await this.writeState(state);
      return state;
    });
  }

  async setSiteTitle(siteTitle: string): Promise<CodexWebIdentityState> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      state.settings.siteTitle = normalizeSiteTitle(siteTitle);
      await this.writeState(state);
      return state;
    });
  }

  async ensureBootstrapAdminFromPasswordHash(input: BootstrapAdminPasswordHashInput): Promise<CodexWebIdentityState> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const adminRole: CodexWebRole = {
        id: 'role_admin',
        name: 'Admin',
        isAdmin: true,
        projectGrants: [],
      };
      state.roles = upsertById(state.roles, adminRole);
      const existingAdmin = state.users.find((user) => user.username === 'admin' || user.id === 'user_admin');
      const adminUser: CodexWebUser = {
        ...(existingAdmin ?? {
          id: 'user_admin',
          username: 'admin',
          enabled: true,
          canNewSession: true,
          roleIds: [],
          directProjectGrants: [],
          favoriteProjectIds: [],
        }),
        id: existingAdmin?.id ?? 'user_admin',
        username: existingAdmin?.username ?? 'admin',
        enabled: existingAdmin?.enabled !== false,
        canNewSession: true,
        passwordHash: normalizeRequiredId(input.passwordHash, 'password hash'),
        passwordSalt: normalizeRequiredId(input.passwordSalt, 'password salt'),
        passwordIterations: Number.isFinite(input.passwordIterations)
          ? Number(input.passwordIterations)
          : PASSWORD_ITERATIONS,
        roleIds: uniqueStrings([...(existingAdmin?.roleIds ?? []), adminRole.id]),
        directProjectGrants: normalizeProjectGrants(existingAdmin?.directProjectGrants ?? []),
        favoriteProjectIds: normalizeStringArray(existingAdmin?.favoriteProjectIds ?? []),
      };
      state.users = upsertById(state.users, adminUser);
      await this.writeState(state);
      return state;
    });
  }

  async upsertUserWithPassword(input: UpsertUserWithPasswordInput): Promise<CodexWebUser> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizePassword(input.password);
      const salt = crypto.randomBytes(32).toString('base64url');
      const user: CodexWebUser = {
        id: normalizeRequiredId(input.id, 'user id'),
        username: normalizeUsername(input.username),
        enabled: input.enabled !== false,
        canNewSession: input.canNewSession !== false,
        passwordHash: await hashPassword(normalized, salt, PASSWORD_ITERATIONS),
        passwordSalt: salt,
        passwordIterations: PASSWORD_ITERATIONS,
        roleIds: normalizeStringArray(input.roleIds),
        directProjectGrants: normalizeProjectGrants(input.directProjectGrants),
        favoriteProjectIds: [],
      };
      state.users = upsertById(state.users, user);
      await this.writeState(state);
      return user;
    });
  }

  async updateUserAccess(input: UpdateUserAccessInput): Promise<CodexWebUser> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const userId = normalizeRequiredId(input.id, 'user id');
      const existing = state.users.find((user) => user.id === userId);
      if (!existing) {
        throw new Error(`Unknown user: ${userId}`);
      }
      const user: CodexWebUser = {
        ...existing,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
        canNewSession: typeof input.canNewSession === 'boolean' ? input.canNewSession : existing.canNewSession,
        roleIds: Array.isArray(input.roleIds) ? normalizeStringArray(input.roleIds) : existing.roleIds,
        directProjectGrants: Array.isArray(input.directProjectGrants)
          ? normalizeProjectGrants(input.directProjectGrants)
          : existing.directProjectGrants,
      };
      state.users = upsertById(state.users, user);
      await this.writeState(state);
      return user;
    });
  }

  async deleteUser(userId: string): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalizedUserId = normalizeRequiredId(userId, 'user id');
      const existing = state.users.find((user) => user.id === normalizedUserId);
      if (!existing) {
        throw new Error(`Unknown user: ${normalizedUserId}`);
      }
      const removedSessionIds = new Set(
        state.sessions
          .filter((session) => session.ownerUserId === normalizedUserId)
          .map((session) => session.id),
      );
      state.users = state.users.filter((user) => user.id !== normalizedUserId);
      state.sessions = state.sessions.filter((session) => session.ownerUserId !== normalizedUserId);
      state.shares = state.shares.filter((share) => share.createdByUserId !== normalizedUserId && !removedSessionIds.has(share.sessionId));
      state.userSessions = state.userSessions.filter((session) => session.userId !== normalizedUserId);
      await this.writeState(state);
    });
  }

  async updateUserProjectFavorite(input: UpdateUserProjectFavoriteInput): Promise<CodexWebUser> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const userId = normalizeRequiredId(input.userId, 'user id');
      const projectId = normalizeRequiredId(input.projectId, 'project id');
      const existing = state.users.find((user) => user.id === userId);
      if (!existing) {
        throw new Error(`Unknown user: ${userId}`);
      }
      const current = new Set(normalizeStringArray(existing.favoriteProjectIds));
      if (input.favorite) {
        current.add(projectId);
      } else {
        current.delete(projectId);
      }
      const user: CodexWebUser = {
        ...existing,
        favoriteProjectIds: [...current],
      };
      state.users = upsertById(state.users, user);
      await this.writeState(state);
      return user;
    });
  }

  async upsertRole(role: CodexWebRole): Promise<CodexWebRole> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeRole(role);
      state.roles = upsertById(state.roles, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async upsertProject(project: CodexWebProject): Promise<CodexWebProject> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeProject(project);
      state.projects = upsertById(state.projects, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async upsertSession(session: CodexWebAppSession): Promise<CodexWebAppSession> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeAppSession(session);
      state.sessions = upsertById(state.sessions, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      state.sessions = state.sessions.filter((session) => session.id !== sessionId);
      await this.writeState(state);
    });
  }

  async verifyUserPassword(username: string, password: string): Promise<string | null> {
    const state = await this.readState();
    const normalizedUsername = normalizeUsername(username);
    const user = state.users.find((item) => item.username === normalizedUsername && item.enabled !== false);
    if (!user?.passwordHash || !user.passwordSalt) {
      return null;
    }
    const candidate = await hashPassword(
      String(password ?? ''),
      user.passwordSalt,
      user.passwordIterations ?? PASSWORD_ITERATIONS,
    );
    return safeEqual(candidate, user.passwordHash) ? user.id : null;
  }

  async createShare({
    sessionId,
    createdByUserId,
  }: {
    sessionId: string;
    createdByUserId: string;
  }): Promise<{ token: string; share: CodexWebShare }> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const now = new Date().toISOString();
      const token = createShareToken();
      const share: CodexWebShare = {
        id: crypto.randomUUID(),
        tokenHash: hashToken(token),
        sessionId: normalizeRequiredId(sessionId, 'session id'),
        createdByUserId: normalizeRequiredId(createdByUserId, 'user id'),
        enabled: true,
        createdAt: now,
      };
      state.shares = [...state.shares, share];
      await this.writeState(state);
      return { token, share };
    });
  }

  async addUserSession(session: CodexWebUserSession): Promise<CodexWebUserSession> {
    return this.withMutationLock(async () => {
      const state = await this.readState();
      const normalized = normalizeUserSession(session);
      state.userSessions = upsertById(state.userSessions, normalized);
      await this.writeState(state);
      return normalized;
    });
  }

  async touchUserSession(sessionId: string, lastSeenAt: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      const index = state.userSessions.findIndex((session) => session.id === sessionId);
      if (index < 0) {
        return;
      }
      state.userSessions[index] = {
        ...state.userSessions[index]!,
        lastSeenAt,
      };
      await this.writeState(state);
    });
  }

  async deleteUserSession(sessionId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await this.readState();
      state.userSessions = state.userSessions.filter((session) => session.id !== sessionId);
      await this.writeState(state);
    });
  }

  async findShareByToken(token: string): Promise<string | null> {
    const tokenHash = hashToken(String(token ?? '').trim());
    const state = await this.readState();
    return state.shares.find((share) => share.enabled !== false && safeEqual(share.tokenHash, tokenHash))?.id ?? null;
  }

  private async writeState(state: CodexWebIdentityState): Promise<void> {
    await fs.mkdir(path.dirname(this.identityPath), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify(normalizeState(state), null, 2)}\n`;
    const tempPath = path.join(
      path.dirname(this.identityPath),
      `.${path.basename(this.identityPath)}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, payload, { mode: 0o600 });
      await fs.rename(tempPath, this.identityPath);
      await fs.chmod(this.identityPath, 0o600).catch(() => {});
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.mutationLock;
    let release!: () => void;
    this.mutationLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function emptyState(): CodexWebIdentityState {
  return {
    settings: { multiUserEnabled: false, siteTitle: DEFAULT_SITE_TITLE },
    users: [],
    roles: [],
    projects: [],
    sessions: [],
    shares: [],
    userSessions: [],
  };
}

function normalizeState(value: unknown): CodexWebIdentityState {
  const record = isRecord(value) ? value : {};
  const settings = isRecord(record.settings) ? record.settings : {};
  return {
    settings: {
      multiUserEnabled: settings.multiUserEnabled === true,
      siteTitle: normalizeSiteTitle(settings.siteTitle),
    },
    users: Array.isArray(record.users) ? record.users.map(normalizeUserOrNull).filter(isPresent) : [],
    roles: Array.isArray(record.roles) ? record.roles.map(normalizeRoleOrNull).filter(isPresent) : [],
    projects: Array.isArray(record.projects) ? record.projects.map(normalizeProjectOrNull).filter(isPresent) : [],
    sessions: Array.isArray(record.sessions) ? record.sessions.map(normalizeAppSessionOrNull).filter(isPresent) : [],
    shares: Array.isArray(record.shares) ? record.shares.map(normalizeShareOrNull).filter(isPresent) : [],
    userSessions: Array.isArray(record.userSessions) ? record.userSessions.map(normalizeUserSessionOrNull).filter(isPresent) : [],
  };
}

function normalizeUserOrNull(value: unknown): CodexWebUser | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.username !== 'string') {
    return null;
  }
  return {
    id: value.id,
    username: value.username,
    enabled: value.enabled !== false,
    canNewSession: value.canNewSession !== false,
    passwordHash: typeof value.passwordHash === 'string' ? value.passwordHash : undefined,
    passwordSalt: typeof value.passwordSalt === 'string' ? value.passwordSalt : undefined,
    passwordIterations: Number.isFinite(value.passwordIterations) ? Number(value.passwordIterations) : undefined,
    roleIds: normalizeStringArray(value.roleIds),
    directProjectGrants: normalizeProjectGrants(value.directProjectGrants),
    favoriteProjectIds: normalizeStringArray(value.favoriteProjectIds),
  };
}

function normalizeRoleOrNull(value: unknown): CodexWebRole | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }
  return normalizeRole(value as CodexWebRole);
}

function normalizeRole(role: CodexWebRole): CodexWebRole {
  return {
    id: normalizeRequiredId(role.id, 'role id'),
    name: String(role.name ?? '').trim() || role.id,
    isAdmin: role.isAdmin === true,
    projectGrants: normalizeProjectGrants(role.projectGrants),
  };
}

function normalizeProjectOrNull(value: unknown): CodexWebProject | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.cwd !== 'string') {
    return null;
  }
  return normalizeProject(value as CodexWebProject);
}

function normalizeProject(project: CodexWebProject): CodexWebProject {
  const id = normalizeRequiredId(project.id, 'project id');
  const cwd = normalizeRequiredId(project.cwd, 'project cwd');
  return {
    id,
    internalName: String(project.internalName ?? '').trim() || id,
    cwd,
    displayName: cwdLeafName(String(project.displayName ?? '').trim()) || cwdLeafName(cwd) || id,
    enabled: project.enabled !== false,
  };
}

function cwdLeafName(cwd: string): string {
  const parts = String(cwd || '').split(/[\\/]+/u).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : '';
}

function normalizeAppSessionOrNull(value: unknown): CodexWebAppSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.codexThreadId !== 'string') {
    return null;
  }
  return normalizeAppSession(value as CodexWebAppSession);
}

function normalizeAppSession(session: CodexWebAppSession): CodexWebAppSession {
  const now = new Date().toISOString();
  return {
    id: normalizeRequiredId(session.id, 'session id'),
    codexThreadId: normalizeRequiredId(session.codexThreadId, 'codex thread id'),
    projectId: normalizeRequiredId(session.projectId, 'project id'),
    ownerUserId: normalizeRequiredId(session.ownerUserId, 'owner user id'),
    createdAt: String(session.createdAt ?? '').trim() || now,
    updatedAt: String(session.updatedAt ?? '').trim() || now,
  };
}

function normalizeShareOrNull(value: unknown): CodexWebShare | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tokenHash !== 'string') {
    return null;
  }
  return {
    id: value.id,
    tokenHash: value.tokenHash,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    createdByUserId: typeof value.createdByUserId === 'string' ? value.createdByUserId : '',
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
  };
}

function normalizeUserSessionOrNull(value: unknown): CodexWebUserSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tokenHash !== 'string') {
    return null;
  }
  return normalizeUserSession(value as CodexWebUserSession);
}

function normalizeUserSession(session: CodexWebUserSession): CodexWebUserSession {
  const now = new Date().toISOString();
  return {
    id: normalizeRequiredId(session.id, 'auth session id'),
    tokenHash: normalizeRequiredId(session.tokenHash, 'token hash'),
    deviceName: String(session.deviceName ?? '').trim().slice(0, 120) || 'Unknown device',
    createdAt: String(session.createdAt ?? '').trim() || now,
    lastSeenAt: String(session.lastSeenAt ?? '').trim() || now,
    userId: normalizeRequiredId(session.userId, 'user id'),
  };
}

function normalizeProjectGrants(value: unknown): CodexWebProjectGrant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((grant): CodexWebProjectGrant | null => {
      if (!isRecord(grant) || typeof grant.projectId !== 'string' || !grant.projectId.trim()) {
        return null;
      }
      return {
        projectId: grant.projectId.trim(),
        canRead: grant.canRead === true,
        canCreate: grant.canCreate === true,
        canWrite: grant.canWrite === true,
      };
    })
    .filter(isPresent);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean));
}

function uniqueStrings(value: string[]): string[] {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeUsername(username: string): string {
  const normalized = String(username ?? '').trim();
  if (!normalized) {
    throw new Error('username is required');
  }
  return normalized;
}

function normalizePassword(password: string): string {
  const normalized = String(password ?? '');
  if (normalized.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  return normalized;
}

function normalizeSiteTitle(siteTitle: unknown): string {
  const normalized = typeof siteTitle === 'string' ? siteTitle.trim() : '';
  return normalized || DEFAULT_SITE_TITLE;
}

function normalizeRequiredId(value: string, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function hashPassword(password: string, salt: string, iterations: number): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey.toString('base64url'));
    });
  });
}

function createShareToken(): string {
  return `cws_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashToken(token: string): string {
  return crypto.createHash(DIGEST).update(token).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
