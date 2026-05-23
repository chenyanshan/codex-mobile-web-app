# Codex Web Desktop Workspace Design

## Goal

Upgrade Codex Web's desktop experience from a stretched mobile layout into a
real workspace optimized for laptop and desktop screens.

The target interaction matches the user's stated expectation: on desktop, the
session list stays visible on the left while the active session stays visible
on the right, similar to WeChat's desktop information architecture.

Mobile remains the primary baseline and should keep the current page-based flow
and touch behavior.

## Problem

The current frontend is effectively a mobile app scaled up on larger screens.
`sessions`, `chat`, `new`, `reports`, and `settings` are separate full-screen
views. On desktop this creates three problems:

- selecting a session hides the session list instead of keeping it visible
- creating a new session or opening settings interrupts the main chat workspace
- wide screens do not provide more context, only larger spacing

The result does not match desktop habits for chat-like tools where browsing
sessions and working inside the current session should happen at the same time.

## Scope

This design only changes the desktop information architecture for the Codex Web
frontend in `packages/codex-web/public/`.

In scope:

- a desktop-only workspace layout at a defined width breakpoint
- a persistent left session list and persistent right active-session pane
- desktop behavior for session selection, new session creation, reports, and
  settings
- responsive transitions between desktop and mobile
- UI and state-model test coverage for the desktop workspace behavior

Out of scope:

- backend API changes
- multi-user features
- redesigning the mobile UI
- adding a third utility column
- changing Codex runtime or session storage semantics

## Breakpoint Strategy

Desktop workspace mode starts at:

```text
min-width: 1100px
```

Behavior below `1100px` remains the current mobile/tablet single-column flow.

Rationale:

- `960px` is too aggressive and would crowd 13-inch split-window usage
- `1280px` is unnecessarily conservative and would miss many laptop cases
- `1100px` leaves enough room for a useful session list and a readable chat pane

## Layout Model

At desktop widths, the main application shell becomes a two-pane workspace:

```text
---------------------------------------------------------------
| left sidebar                    | right workspace            |
|                                 |                            |
| Sessions header                 | active session header      |
| New / Reports / Settings        | project title / reports    |
| Favorites / All toggle          | timeline                   |
| Session cards                   | timeline                   |
| Session cards                   | timeline                   |
| Session cards                   | composer                   |
---------------------------------------------------------------
```

### Left Sidebar

The left sidebar is persistent and owns navigation across sessions.

Responsibilities:

- show the sessions title and primary actions
- expose `New`, `Reports`, and `Settings`
- keep favorites/all toggle and favorite-sort controls
- render the scrollable session list
- keep session selection available while a turn is running

Suggested width:

```text
320px base width
```

It may grow slightly on wider screens but should stay visually stable instead
of scaling proportionally with the window.

### Right Workspace

The right pane is always reserved for the currently active session or a desktop
empty state.

Responsibilities:

- show active session header information
- render the timeline
- render approvals, work cards, and final answers
- keep the composer and runtime status visible
- provide access to session-specific reports

If no session is active, show an empty state with a clear `Start a new session`
action instead of navigating back to a dedicated list page.

## Desktop Interaction Model

### Session Selection

On desktop, clicking a session card no longer navigates to a dedicated `chat`
page. It only changes the active session in the right pane.

Expected behavior:

- left sidebar remains visible
- right pane loads the selected session timeline
- scroll position in the left sidebar is preserved
- running turns do not block switching to another session

### New Session

On desktop, `New Session` should not take over the whole app view.

Recommended behavior:

- the left sidebar exposes a `New` button
- clicking it opens an inline launcher card near the top of the sidebar
- the launcher reuses the current mobile form fields:
  - project path
  - recent path shortcuts
  - start action
- after successful creation, the new session is inserted into the session list
  and becomes the active session in the right pane

The separate mobile `new` page remains unchanged for screens below `1100px`.

### Settings

On desktop, app-level settings should become an auxiliary panel rather than a
full-screen destination.

Recommended behavior:

- the left sidebar exposes `Settings`
- clicking it opens a lightweight overlay, drawer, or anchored panel
- settings changes do not remove the active session from the right pane

The panel may reuse the existing settings form structure as long as it does not
replace the desktop workspace.

### Reports

Reports are important but should not destroy desktop workspace continuity.

Recommended behavior:

- the left sidebar exposes a `Reports` entry
- session-specific report access remains available from the right pane header
- desktop report browsing opens as a right-pane overlay or secondary panel
- closing reports returns to the same active session context

The mobile report list and report viewer can keep their page-based flow.

## State Model

The current app uses page-like `view` values such as `sessions`, `chat`, `new`,
`reports`, `report`, and `settings`.

The desktop workspace should not remove that model for mobile. Instead it adds a
layout interpretation layer.

### Derived Layout Mode

Add a derived client state:

```ts
type LayoutMode = 'mobile' | 'desktop';
```

This should be computed from viewport width and updated on resize.

### Active Session As Primary Desktop State

On desktop, the real source of truth for the right pane becomes the active
session identity:

- `sessionId`
- `currentSession`
- loaded timeline for that session

Desktop rendering should not depend on `view === 'chat'` to decide whether the
chat pane exists.

### View Mapping

Recommended interpretation:

- mobile:
  - keep existing `view` semantics
- desktop:
  - `sessions`, `chat`, and `new` all render the same workspace shell
  - `new` only controls whether the sidebar launcher card is open
  - `chat` only indicates that an active session exists
  - `reports`, `report`, and `settings` become desktop overlays or auxiliary
    panels layered on the workspace

This preserves mobile behavior while minimizing state churn on desktop.

### First Session Selection

When desktop mode is active and session data exists but no active session is
selected, the app should automatically select the first available session.

This keeps the right pane populated by default and matches the desired
always-visible-session behavior.

## Responsive Transitions

Transitions between mobile and desktop must preserve context instead of
resetting the app.

### Mobile To Desktop

If the user expands the window into desktop mode:

- preserve the current session if one is already active
- render the workspace immediately
- keep the current timeline state
- avoid refetching purely because the layout changed

### Desktop To Mobile

If the user shrinks the window back below `1100px`:

- if an active session exists, map the UI to the mobile `chat` view
- if no active session exists, map the UI to the mobile `sessions` view
- close desktop-only overlays in a predictable way

This prevents context loss when moving between device sizes or window shapes.

## Failure And Recovery Behavior

Desktop mode should behave as a progressive enhancement layer with explicit
fallbacks.

- if layout-mode detection fails, fall back to the existing mobile-style view
  routing
- if the session list loads but the active session timeline fails to load, keep
  the left sidebar interactive and show a retryable error state in the right pane
- if the active session is archived or no longer exists, automatically switch to
  the next available session; if none exist, show the desktop empty state
- if reports or settings overlays fail to load, dismiss the overlay and preserve
  the workspace rather than navigating away

## Visual Direction

The desktop workspace should feel intentional rather than like a blown-up phone
screen.

Guidelines:

- keep the app centered around a single two-pane shell
- use a sidebar surface distinct from the chat pane
- reduce oversized mobile padding in desktop mode
- keep the composer anchored to the right pane, not the full viewport
- make the active session card visually obvious in the left list
- preserve existing theme support

This is an adaptation of the current visual language, not a full redesign.

## Testing Requirements

Add or update frontend tests to cover desktop behavior.

### UI Structure Tests

Assert that desktop mode introduces dedicated workspace structure, such as:

- workspace shell
- persistent sidebar
- persistent chat pane

Also assert that mobile mode does not render those desktop-specific wrappers.

### State Behavior Tests

Assert that:

- desktop session selection updates the active session without page navigation
- desktop `showSessionList()` does not clear the right pane
- desktop `new` toggles the launcher instead of forcing a full-screen page
- resizing between desktop and mobile preserves the active session

### Style Tests

Assert that:

- desktop media queries exist for the workspace breakpoint
- the sidebar and right pane have independent scroll regions where intended
- the current mobile scrolling behavior remains in place below the breakpoint

## Implementation Notes

The existing frontend is currently concentrated in:

- `packages/codex-web/public/app.js`
- `packages/codex-web/public/styles.css`
- `packages/codex-web/test/public_ui.test.ts`

Implementation should prefer:

- adding desktop-specific render helpers rather than overloading the existing
  mobile renderers with many inline conditionals
- keeping mobile code paths stable
- extracting small helper functions if desktop branching makes `app.js`
  materially harder to understand

## Success Criteria

This design is successful when all of the following are true:

- on screens `>= 1100px`, the user can browse sessions on the left while
  continuously seeing the active session on the right
- switching sessions on desktop does not replace the whole page
- creating a new session on desktop does not discard the current workspace shell
- mobile behavior remains functionally unchanged
- the behavior is covered by tests that distinguish desktop and mobile flows
