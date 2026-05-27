# Codex Web Multi-User RBAC Design

## Goal

Add a single-host multi-user facade to Codex Web. Execution remains local and
single-user at the Codex runtime layer, but Codex Web gains user login,
project-scoped RBAC, admin audit/observer APIs, and read-only share links.

## Product Model

This is not a hosted SaaS or a separate Codex runtime per user. All users share
the same Mac, Codex login state, `CODEX_HOME`, and `codex app-server`.

The isolation boundary is the Codex Web backend:

```text
browser
  -> token-authenticated Codex Web API
  -> principal + RBAC checks
  -> app-level project/session/share metadata
  -> CodexWebRuntime
  -> CodexAppClient
  -> local codex app-server
```

The browser never receives raw project cwd values or Codex thread ids for
ordinary user flows when multi-user mode is enabled.

## Compatibility

`multiUserEnabled` defaults to `false`. In that state the existing password
login and current single-user behavior remain valid. The backend treats the
legacy authenticated session as an implicit local admin principal.

When `multiUserEnabled` is set to `true`, username/password login is accepted
for users configured in the identity store. Legacy admin tokens may continue to
act as bootstrap admin tokens so an owner is not locked out immediately after
enabling the mode.

## Data Model

State remains outside the repo under `~/.codex-web/`.

`identity.json` stores:

- `settings.multiUserEnabled`
- `users[]` with salted password hashes, role ids, and direct project grants
- `roles[]` with admin flag and project grants
- `projects[]` with internal name, cwd, and user-facing display name
- `sessions[]` mapping app session id to Codex thread id, owner user id, and
  project id
- `shares[]` with hashed share tokens mapped to app session ids

Project grants support `canRead`, `canCreate`, and `canWrite`.

## Backend Authorization

All authenticated API requests produce a `Principal`:

```ts
type Principal = {
  userId: string;
  username: string;
  roleIds: string[];
  isAdmin: boolean;
  mode: 'single' | 'multi';
};
```

Session APIs use app session ids, not Codex thread ids. The server resolves:

```text
appSessionId -> AppSession -> projectId + ownerUserId + codexThreadId
```

Then it checks the effective permissions before calling `CodexWebRuntime`.

Ordinary users may:

- list sessions they own in projects with `canRead`
- read sessions they own in projects with `canRead`
- create sessions only for projects with `canCreate`
- write turns/settings/approvals only for sessions they own in projects with
  `canWrite`

Admins bypass project grants for audit and management APIs.

## Runtime Boundary

`CodexWebRuntime` remains unaware of users, roles, and projects. It receives
authorized Codex thread ids only.

The runtime exposes thread ownership lookups for active turn and approval ids
so the server can verify a turn or approval belongs to the authorized app
session before interrupting or resolving it.

## Project Display Names

Projects have a private `cwd` and public `displayName`. In multi-user mode:

- ordinary session create requests provide `projectId`
- the backend supplies `Project.cwd` to `runtime.createSession`
- ordinary session responses use `projectDisplayName`
- raw cwd is returned only to admin APIs

## Admin APIs

Admins receive an admin entry point and use `/api/admin/*` routes for:

- system settings
- users
- roles
- projects
- global session audit
- filtering sessions by user/project
- reading or streaming any session as observer

Observer mode is read-only at both layers. The frontend disables input, and the
backend rejects write operations unless the caller is operating through the
normal owner/write path.

## Share Links

Any authorized owner or admin may create a read-only share link for a session.
The share route uses an independent random token. The backend stores only the
hash.

Share routes do not require bearer auth, but expose only:

- full session history
- live read-only event stream

They never allow turns, approval decisions, settings writes, archive, or
favorite changes.

## Testing

Focused tests cover:

- legacy single-user routes still work
- multi-user users cannot list/read/write sessions they do not own
- project create requests use configured cwd and return display names
- admin can audit and observe any session but cannot inject via observer
- share links read without auth and reject write attempts by route absence
- runtime turn/approval operations can be mapped back to their owning thread

