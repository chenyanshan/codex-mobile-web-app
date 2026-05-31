# Codex Web Workspace Redesign Design

## Goal

Reshape the web app into a project-first workspace that matches the provided desktop reference more closely while keeping the existing Codex session, chat, and admin behaviors intact.

## Scope

- Desktop becomes a true three-pane workspace:
  - left: project rail with global actions
  - middle: session list filtered by project
  - right: chat or new-session workspace
- Mobile keeps a single-column flow, but adopts the same information architecture through a drawer-based project rail.
- `Admin Console` remains a dedicated full-screen page and does not render inside the workspace shell.

## Requirements

### Information Architecture

- The workspace must expose a top-level `All Sessions` entry plus concrete projects.
- Project selection filters the session pane to that project.
- On desktop, selecting a project opens its most recent session automatically.
- On desktop, if the project has no sessions yet, the workspace opens the `New` view with that project preselected.
- On mobile, selecting a project closes the drawer and shows that project's filtered session list without auto-opening a session.
- `Sessions` returns to the session/chat workspace without clearing the active project filter.
- `New` opens inside the workspace pane and defaults to the currently selected project, while still allowing project changes.
- `New` is available in the session pane topbar.
- `Set` lives in the project rail and opens app settings.
- `Admin Console` opens as its own full-screen management page.
- Reports keep a neutral `Reports` title when a report project is selected and do not repeat the project heading above the report list.

### Project Model

- The frontend must support both managed projects and older single-user sessions.
- Project grouping therefore uses a unified derived project list:
  - prefer explicit `projectId` and `projectDisplayName`
  - fall back to `cwd`-derived project labels for legacy sessions
- `All Sessions` remains available regardless of project availability.

### Desktop Layout

- The workspace shell becomes three columns.
- The first column contains:
  - product branding
  - `All Sessions`
  - project list
  - bottom actions for `Sessions`, `Set`, and `Admin Console`
- The second column contains:
  - a fixed `Sessions` title so long project names do not push `Reports` and `New` offscreen
  - `Favorites` / `Recents` switch
  - `Reports` and `New` actions
  - session cards
- The third column contains:
  - empty state
  - chat pane
  - new-session pane

### Mobile Layout

- The first column collapses into a drawer.
- The default mobile route remains the session list, then chat on selection.
- Opening a project from the drawer applies project filtering and returns to the filtered session list.
- The drawer exposes `Sessions`, `Set`, and `Admin Console`.
- The drawer-open button uses a full touch target with visible button styling.
- The mobile drawer has no explicit `Close` button; tapping the uncovered backdrop closes it.
- Drawer branding uses the website title configured in Settings.

### Filtering And Sorting

- Session filtering order is:
  1. project selection
  2. favorites/recents scope
- Favorites is only a filter. It uses the same newest-message-time ordering as Recents and does not expose manual sorting controls.

### Compatibility

- Existing reports, share mode, observer mode, settings, queued messages, pull-to-refresh, and active-turn recovery flows must continue to work.
- Existing admin rendering stays functionally intact, only its entry/navigation changes.
- App settings include a persisted website title control that updates the browser title from the default `Codex Web`.
- Queued messages hide from the deletable queue row once they start sending, so users cannot delete an in-flight message that is already shown in the conversation.

## Testing

- Add UI tests for:
  - desktop workspace rendering the project rail and separate session pane
  - project selection filtering sessions and opening the newest session
  - project selection opening `New` when the project has no sessions
  - mobile project selection filtering to sessions without opening a session
  - `New` defaulting to the active project
  - mobile drawer rendering the same navigation model
  - Settings persisting a custom website title
  - admin remaining full-screen
- Keep existing public UI tests passing.
