import type {
  CodexWebAppSession,
  CodexWebIdentityState,
  CodexWebProjectGrant,
} from './identity_store.js';

export interface CodexWebPrincipal {
  userId: string;
  username: string;
  roleIds: string[];
  isAdmin: boolean;
  mode: 'single' | 'multi';
}

export function localAdminPrincipal(): CodexWebPrincipal {
  return {
    userId: 'local-admin',
    username: 'local-admin',
    roleIds: ['admin'],
    isAdmin: true,
    mode: 'single',
  };
}

export function effectiveProjectGrant(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  projectId: string,
): CodexWebProjectGrant | null {
  if (principal.isAdmin) {
    return {
      projectId,
      canRead: true,
      canCreate: true,
      canWrite: true,
    };
  }
  const user = state.users.find((item) => item.id === principal.userId && item.enabled !== false);
  if (!user) {
    return null;
  }
  const grants = [
    ...state.roles
      .filter((role) => user.roleIds.includes(role.id))
      .flatMap((role) => role.projectGrants),
    ...user.directProjectGrants,
  ].filter((grant) => grant.projectId === projectId);
  if (!grants.length) {
    return null;
  }
  const hasProjectAccess = grants.some((grant) => grant.canRead === true || grant.canCreate === true || grant.canWrite === true);
  return {
    projectId,
    canRead: hasProjectAccess,
    canCreate: hasProjectAccess,
    canWrite: true,
  };
}

export function canCreateProjectSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  projectId: string,
): boolean {
  return effectiveProjectGrant(state, principal, projectId)?.canCreate === true;
}

export function canReadAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  session: CodexWebAppSession,
): boolean {
  if (principal.isAdmin) {
    return true;
  }
  if (session.ownerUserId !== principal.userId) {
    return false;
  }
  return effectiveProjectGrant(state, principal, session.projectId)?.canRead === true;
}

export function canWriteAppSession(
  state: CodexWebIdentityState,
  principal: CodexWebPrincipal,
  session: CodexWebAppSession,
): boolean {
  if (session.ownerUserId !== principal.userId) {
    return false;
  }
  return effectiveProjectGrant(state, principal, session.projectId)?.canWrite === true;
}
