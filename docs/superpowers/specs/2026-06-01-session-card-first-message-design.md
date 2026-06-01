# Session Card First Message Design

## Goal

Change the sessions list from a cwd-oriented card layout to a summary-oriented
layout that highlights the first user message.

## Scope

- Remove the `No cwd` / cwd metadata row from session cards.
- Render the first user message as the primary session summary.
- Keep session cards at a consistent height even when a session has no first
  message yet.
- Limit the summary to two visible lines and hide overflow.

## Design

### Card content

Each session card keeps the project name as the title.

The body summary switches from `lastUserInput` / preview text to
`firstUserInput`. When `firstUserInput` is missing, the summary area stays empty
instead of showing fallback copy.

The card footer keeps only the timestamp.

### Layout behavior

The summary area always reserves the height of two lines. Long first messages
are truncated visually after two lines. Short messages and empty summaries keep
the same reserved space so the list remains visually aligned.

### Data flow

The frontend already normalizes `firstUserInput` in session summaries, so this
change stays within the existing `/api/sessions` payload. No API or backend
changes are required.

## Testing

- UI tests cover using `firstUserInput` instead of the latest preview text.
- UI tests cover removing the cwd fallback text from cards.
- Style tests cover the fixed two-line summary clamp and reserved height.
