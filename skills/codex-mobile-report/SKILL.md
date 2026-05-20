---
name: codex-mobile-report
description: Use when producing markdown or html reports, summaries, analysis documents, audits, plans, or deliverables intended to be opened from the Codex mobile web app on a phone, including Chinese requests like "最终的报告我要远程看", "最终的报告我要手机看", or "报告以我手机可读的形式总结".
---

# Codex Mobile Report

## Overview

Create phone-readable Markdown or self-contained HTML reports under the Codex
Web reports directory so the mobile app can list, favorite, and open them.

## Trigger Phrases

Use this skill when the user asks for a report, summary, audit, plan, or other
deliverable with wording such as:

- 最终的报告我要远程看
- 最终的报告我要手机看
- 报告以我手机可读的形式总结
- 手机可打开 / 手机可读 / 远程看 / 远程打开

## Report Location

Use this root unless the user gives a different explicit path:

```text
~/.codex-web/reports/
```

Write reports as:

```text
~/.codex-web/reports/<project-slug>/<YYYY-MM-DD>/<short-name>.md
~/.codex-web/reports/<project-slug>/<YYYY-MM-DD>/<short-name>.html
```

Project slug:

- Prefer the current git repo basename.
- Otherwise use the current working directory basename.
- Normalize to lowercase words joined with `-`.

File name:

- Use short lowercase words joined with `-`.
- Include only `.md`, `.markdown`, `.html`, or `.htm`.
- Put images/CSS inline for HTML reports. The first Codex Web viewer treats
  HTML reports as self-contained.

## Workflow

1. Create the project/date directory with mode suitable for private user data.
2. Write the report under that directory.
3. Keep generated reports out of the business repo unless the user explicitly
   asks for a repo-tracked artifact.
4. In the final answer, include a Markdown link to the absolute report path.

Final answer format:

```markdown
手机可打开报告：[Report Title](/Users/<name>/.codex-web/reports/<project>/<date>/<file>.md)
```

Codex Web will turn that local report link into an in-app viewer link.

## Constraints

- Do not copy reports into the old `mobile-web-view` project for this workflow.
- Do not store secrets, raw tokens, local env files, or private credentials in
  reports.
- Use Markdown for text-heavy reports and self-contained HTML only when layout,
  tables, charts, or visual hierarchy matter.
