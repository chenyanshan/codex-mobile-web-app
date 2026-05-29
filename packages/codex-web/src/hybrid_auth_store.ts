import crypto from 'node:crypto';
import type { AuthStore, PasswordHashRecord, PublicAuthSession } from './auth_store.js';
import { localAdminPrincipal, type CodexWebPrincipal } from './access_control.js';
import type { CodexWebUserSession, FileIdentityStore } from './identity_store.js';

const DIGEST = 'sha256';

interface LegacyAuthLike {
  isConfigured(): Promise<boolean>;
  login(args: {
    password: string;
    deviceName?: string | null;
  }): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean }>;
  verifyToken(token: string | null | undefined): Promise<PublicAuthSession | null>;
  logout(token: string | null | undefined): Promise<void>;
  setPassword?(password: string): Promise<void>;
  readPasswordHash?(): Promise<PasswordHashRecord | null>;
}

interface IdentityStoreLike {
  readState(): ReturnType<FileIdentityStore['readState']>;
  setMultiUserEnabled?(enabled: boolean): ReturnType<FileIdentityStore['setMultiUserEnabled']>;
  ensureBootstrapAdminFromPasswordHash?(input: PasswordHashRecord): ReturnType<FileIdentityStore['ensureBootstrapAdminFromPasswordHash']>;
  verifyUserPassword(username: string, password: string): Promise<string | null>;
  addUserSession?(session: CodexWebUserSession): Promise<CodexWebUserSession>;
  touchUserSession?(sessionId: string, lastSeenAt: string): Promise<void>;
  deleteUserSession?(sessionId: string): Promise<void>;
}

interface HybridSession {
  id: string;
  tokenHash: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  userId: string;
}

export class HybridAuthStore {
  private readonly legacyAuth: LegacyAuthLike;

  private readonly identityStore: IdentityStoreLike;

  private readonly sessions = new Map<string, HybridSession>();

  constructor({
    legacyAuth,
    identityStore,
  }: {
    legacyAuth: AuthStore | LegacyAuthLike;
    identityStore: IdentityStoreLike;
  }) {
    this.legacyAuth = legacyAuth;
    this.identityStore = identityStore;
  }

  async isConfigured(): Promise<boolean> {
    const state = await this.identityStore.readState();
    if (state.settings.multiUserEnabled) {
      return state.users.some((user) => user.enabled !== false && Boolean(user.passwordHash && user.passwordSalt));
    }
    return this.legacyAuth.isConfigured();
  }

  async setPassword(password: string): Promise<void> {
    if (typeof this.legacyAuth.setPassword !== 'function') {
      throw new Error('Legacy auth store does not support password setup');
    }
    await this.legacyAuth.setPassword(password);
  }

  async setMultiUserEnabled(enabled: boolean): ReturnType<FileIdentityStore['setMultiUserEnabled']> {
    if (!this.identityStore.setMultiUserEnabled) {
      throw new Error('Identity store does not support multi-user settings');
    }
    if (enabled) {
      const state = await this.identityStore.readState();
      const hasAdmin = state.users.some((user) => user.enabled !== false
        && user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin === true))
        && Boolean(user.passwordHash && user.passwordSalt));
      if (!hasAdmin) {
        const legacyPasswordHash = await this.legacyAuth.readPasswordHash?.();
        if (!legacyPasswordHash) {
          throw new Error('Legacy password is not configured');
        }
        if (!this.identityStore.ensureBootstrapAdminFromPasswordHash) {
          throw new Error('Identity store does not support admin password migration');
        }
        await this.identityStore.ensureBootstrapAdminFromPasswordHash(legacyPasswordHash);
      }
    }
    return this.identityStore.setMultiUserEnabled(enabled);
  }

  async login({
    username,
    password,
    deviceName,
  }: {
    username?: string | null;
    password: string;
    deviceName?: string | null;
  }): Promise<{ token: string; session: PublicAuthSession; configuredNow: boolean }> {
    const state = await this.identityStore.readState();
    if (!state.settings.multiUserEnabled) {
      const login = await this.legacyAuth.login({ password, deviceName });
      return {
        ...login,
        session: {
          ...login.session,
          principal: localAdminPrincipal(),
        },
      };
    }
    const normalizedUsername = String(username ?? '').trim();
    if (!normalizedUsername) {
      throw new Error('Invalid username or password');
    }
    const userId = await this.identityStore.verifyUserPassword(normalizedUsername, password);
    if (!userId) {
      throw new Error('Invalid username or password');
    }
    const user = state.users.find((item) => item.id === userId && item.enabled !== false);
    if (!user) {
      throw new Error('Invalid username or password');
    }
    const principal: CodexWebPrincipal = {
      userId: user.id,
      username: user.username,
      roleIds: [...user.roleIds],
      isAdmin: user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin === true)),
      mode: 'multi',
    };
    const now = new Date().toISOString();
    const token = createToken();
    const session: HybridSession = {
      id: crypto.randomUUID(),
      tokenHash: hashToken(token),
      deviceName: normalizeDeviceName(deviceName),
      createdAt: now,
      lastSeenAt: now,
      userId: user.id,
    };
    this.sessions.set(session.id, session);
    await this.identityStore.addUserSession?.(session);
    return {
      token,
      session: toPublicSession(session, principal),
      configuredNow: false,
    };
  }

  async verifyToken(token: string | null | undefined): Promise<PublicAuthSession | null> {
    const normalized = typeof token === 'string' ? token.trim() : '';
    if (!normalized) {
      return null;
    }
    const state = await this.identityStore.readState();
    if (!state.settings.multiUserEnabled) {
      const session = await this.legacyAuth.verifyToken(normalized);
      return session ? { ...session, principal: localAdminPrincipal() } : null;
    }
    const tokenHash = hashToken(normalized);
    const persistedSessions = [
      ...this.sessions.values(),
      ...state.userSessions.filter((session) => !this.sessions.has(session.id)),
    ];
    for (const session of persistedSessions) {
      if (!safeEqual(session.tokenHash, tokenHash)) {
        continue;
      }
      const user = state.users.find((item) => item.id === session.userId && item.enabled !== false);
      if (!user) {
        this.sessions.delete(session.id);
        await this.identityStore.deleteUserSession?.(session.id);
        return null;
      }
      const updated = {
        ...session,
        lastSeenAt: new Date().toISOString(),
      };
      this.sessions.set(session.id, updated);
      await this.identityStore.touchUserSession?.(session.id, updated.lastSeenAt);
      return toPublicSession(updated, {
        userId: user.id,
        username: user.username,
        roleIds: [...user.roleIds],
        isAdmin: user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin === true)),
        mode: 'multi',
      });
    }
    const legacy = await this.legacyAuth.verifyToken(normalized);
    if (!legacy) {
      return null;
    }
    const migratedAdmin = migratedAdminPrincipal(state);
    return {
      ...legacy,
      principal: migratedAdmin ?? localAdminPrincipal(),
    };
  }

  async logout(token: string | null | undefined): Promise<void> {
    const normalized = typeof token === 'string' ? token.trim() : '';
    if (!normalized) {
      return;
    }
    const tokenHash = hashToken(normalized);
    for (const [sessionId, session] of this.sessions.entries()) {
      if (safeEqual(session.tokenHash, tokenHash)) {
        this.sessions.delete(sessionId);
        await this.identityStore.deleteUserSession?.(sessionId);
        return;
      }
    }
    const state = await this.identityStore.readState();
    const persisted = state.userSessions.find((session) => safeEqual(session.tokenHash, tokenHash));
    if (persisted) {
      await this.identityStore.deleteUserSession?.(persisted.id);
      return;
    }
    await this.legacyAuth.logout(normalized);
  }
}

function migratedAdminPrincipal(state: Awaited<ReturnType<IdentityStoreLike['readState']>>): CodexWebPrincipal | null {
  const adminUser = state.users.find((user) => user.enabled !== false
    && user.roleIds.some((roleId) => state.roles.some((role) => role.id === roleId && role.isAdmin === true)));
  if (!adminUser) {
    return null;
  }
  return {
    userId: adminUser.id,
    username: adminUser.username,
    roleIds: [...adminUser.roleIds],
    isAdmin: true,
    mode: 'multi',
  };
}

function toPublicSession(session: HybridSession, principal: CodexWebPrincipal): PublicAuthSession {
  return {
    id: session.id,
    deviceName: session.deviceName,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    principal,
  };
}

function createToken(): string {
  return `cw_${crypto.randomBytes(32).toString('base64url')}`;
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

function normalizeDeviceName(deviceName: string | null | undefined): string {
  const normalized = typeof deviceName === 'string' ? deviceName.trim() : '';
  return normalized.slice(0, 120) || 'Unknown device';
}
