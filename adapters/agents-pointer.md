# Human-led development (pointer — single source of truth: .claude/skills/human-led-development/SKILL.md)

For any development, fix, refactor, or config change in this repo, first read and follow
`.claude/skills/human-led-development/SKILL.md`. Do not copy its text here.

- No coding without explicit plan-and-scope approval from a human. Out-of-scope work,
  expired authorization, or a plan-version mismatch → stop and re-confirm.
- Same file, multiple tasks → serial; the human sets the order.
- Commit, push, MR, merge, release → separately authorized.
- Discussion and read-only explanation create no coding permission.
- A technical gate is installed: writes outside `.humanled/approvals.json` scopes are
  denied by a PreToolUse hook before they happen. The agent may never edit the gate,
  its approvals, or its settings — only the human does.
