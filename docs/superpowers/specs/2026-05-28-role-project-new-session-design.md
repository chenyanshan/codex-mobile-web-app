# Role Project New Session Design

## Goal

Remove the admin-only `canNewSession` toggle and make project assignment the
single source of truth for whether a user can create a new session.

## Scope

- Remove `canNewSession` controls from the admin user management UI.
- Treat role or direct project access as sufficient for `New Session`.
- Stop requiring admin user create/update flows to send `canNewSession`.
- Preserve backward compatibility with existing identity state files that still
  contain `canNewSession`.

## Design

### Permission model

Project access now implies session creation access. For a non-admin principal,
if the effective role/direct grants include a project, `canCreateProjectSession`
returns `true` for that project.

Admin principals remain unchanged and can still access all projects and
sessions.

### Admin UI

The admin console user pages no longer expose:

- the create-user `Can New Session` checkbox
- the per-user inline `Can New` checkbox

User management keeps only role assignment and enabled/disabled state. The user
row meta text no longer advertises new-session capability separately.

### API behavior

`/api/admin/users` POST and PATCH continue to accept legacy payloads safely, but
the web UI no longer sends `canNewSession` and the permission checks no longer
depend on it.

### Backward compatibility

Existing persisted users may still carry `canNewSession` in state. That field is
treated as legacy data and ignored for project create permission evaluation.

## Testing

- UI tests cover removal of both admin `canNewSession` controls.
- Access-control tests cover project assignment implying `canCreate: true`.
- Server tests cover role-assigned users being able to create sessions without a
  separate per-user toggle.
