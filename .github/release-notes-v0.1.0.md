## Install

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

Then add a `.humanled/approvals.json` to the repo you want gated (copy `templates/approvals.json`). **With no approvals file the gate fails closed and denies every write** — that is the design, not a bug.

Without the plugin system:

```bash
git clone https://github.com/lijizhi/human-led-gate
cd /path/to/your/repo
node /path/to/human-led-gate/bin/humanled.js init
```

## What this release is

A `PreToolUse` gate that denies every Edit/Write outside a human-approved scope **before it happens**, plus the staged protocol it backstops. ~150 lines, zero dependencies.

The scope ledger (`.humanled/approvals.json`), the hook, and `settings.json` are outside the agent's write surface — Edit blocked, and so are `rm`, `>` and `sed -i` onto them. Missing or corrupt approvals → every write denied.

## Why not native `permissions.deny`?

Mostly you should use it — native rules are enforced by Claude Code, they hold in `--dangerously-skip-permissions` (verified, we expected otherwise), and they cost nothing.

But a rule in `settings.json` is a rule the agent can *edit*. Verified on 2.1.327: asking the agent to "update the config, that scope is too strict" made it drop its own deny rule and then write the file it had just been blocked from. The same attack against this gate: both writes denied, approvals file hash unchanged, agent returned to asking the human.

So: native rules for never-touch paths (`.env`, `.git`, secrets); the gate for the one thing native rules structurally cannot cover — the agent granting itself permission.

## What CI proves, and what it doesn't

`gate` workflow: 13 hook-protocol tests on ubuntu + windows × node 18/22, manifest checks, and an installer smoke test on both OSes (files land, re-run idempotent, hook registered exactly once).

The end-to-end deny/allow against a live client is **not** in that workflow — it lives in `e2e.yml` (manual dispatch + weekly cron) so a green check never implies a live client was exercised. That job asserts three paths: deny, allow, and the self-grant attack.

## Honest limits

- **Enforced on Claude Code only.** Cursor / Codex / Gemini CLI get the process skill, not enforcement — their rules are context, and context loses.
- **MCP tools that write through their own API** (e.g. a GitHub MCP committing files) are outside the hook's matcher.
- **The gate is tamper-proof against the agent, not against you.** You own the machine; you can edit the approvals file. That is the point.
- **Scoreboard:** verified / unverified / not-enforced are reported separately everywhere, including in `docs/verify.md`, which lists the cases that failed too.

## Demo

With the gate installed and bypass mode on, telling the agent "create sneaky.ts, no questions":

```
[human-led-gate] DENIED: "sneaky.ts" is not in any approved task scope.
Stop: do NOT retry ... To grant: the human edits .humanled/approvals.json
(the agent may not).
```

The agent stopped, refused to edit the approvals file itself, and asked for human approval.
