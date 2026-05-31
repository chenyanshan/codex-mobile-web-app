# Codex Web Attachments Design

## Goal

Add per-message file and image attachments to Codex Web. A phone browser can
select files, the Mac backend stores them locally, and each Codex turn receives
attachment metadata and local paths so Codex can inspect them.

## Scope

- Composer attachment button next to the message input.
- Upload files and images for the current session/project.
- Prefer project-local storage under `uploads/<user>/`.
- Fall back to `~/.codex-web/uploads/projects/<project>/<user>/` when the
  project directory is not writable.
- Send attachment references with the next turn.
- Move the session `Set` entry from the composer leading controls to the chat
  topbar.

## Storage

For a writable project directory, uploads are stored at:

```text
<project-cwd>/uploads/<safe-user-id>/<upload-id>-<safe-original-name>
```

If that write fails with a project-directory access error, uploads fall back to:

```text
~/.codex-web/uploads/projects/<project-key>/<safe-user-id>/<upload-id>-<safe-original-name>
```

`project-key` is the app project id when available. Legacy single-user sessions
use a stable hash of the session cwd.

The upload API returns the actual `localPath`, `displayPath`, `storage`, and
metadata. Turn prompts must use the returned actual path rather than assuming
project-local storage.

## API

Add:

```text
POST /api/sessions/:sessionId/attachments
```

The route requires the same write permission as starting a turn. The request is
`multipart/form-data` with one or more `files` fields. The response returns a
list of attachment objects.

Start-turn payloads gain:

```json
{
  "text": "question",
  "attachmentIds": ["att_..."],
  "attachments": []
}
```

The frontend sends the uploaded attachment objects with the turn. The backend
validates each attachment path against the configured upload roots before
passing it to runtime.

## Runtime

`CodexWebRuntime.startTurn` builds Codex input from text plus attachments:

- always include a text item containing the user text and attachment list
- include `localImage` items for image attachments
- include non-image files only as local paths in the text item

This mirrors `codex-native-api` default provider attachment handling.

## UI

The composer gets an icon-only attachment button before the textarea. Selected
files appear in a compact tray above the composer row with status, size, and
remove controls. Send is disabled while uploads are pending. Failed uploads can
be removed and do not go out with the turn.

The `Set` button moves to the chat topbar actions so composer leading controls
only contain editor controls such as expand/collapse.

## Errors

- `413 payload_too_large`: file body exceeds the upload limit
- `403 project_upload_not_writable`: project and fallback storage are not
  writable or the session is not writable
- `400 invalid_upload`: malformed multipart data or missing files

Upload failures stay visible in the attachment tray and do not start a turn.

## Testing

- Server tests cover project-local upload, fallback storage, and auth/session
  write permission.
- Runtime tests cover text prompt construction and image `localImage` input.
- Public UI tests cover attachment controls, attachment IDs in the turn payload,
  disabled send while uploading, and `Set` moving to the topbar.
