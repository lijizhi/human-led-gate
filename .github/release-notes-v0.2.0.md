## Install

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

Then add a `.humanled/approvals.json` to the repo you want gated (copy `templates/approvals.json`). **With no approvals file the gate fails closed and denies every write** — that is the design, not a bug.

## What changed in 0.2.0 — risk tiers

v0.1 ran one flat nine-phase flow for every change. A copy fix and a shared-API change cost the same number of human confirmations, which is the same failure as a rubber-stamped approve button, just spread out over more turns.

0.2.0 keeps every phase responsibility identical and lets risk decide how many of them are a separate human decision:

| Tier | Entry condition | Human breakpoints |
|---|---|---|
| **1 — local, deterministic** | behavior clear, impact confined, no public contract change, no key unknown | **2** — start confirmation; acceptance (+ review if there's something to review) |
| **2 — in-module business change** | changes business logic, state, or data flow, closes inside one module | **3** |
| **3 — public or high-impact** | cross-module, cross-session, public contract, security, persistence, compatibility | **6** — risk investigation, design, and skeleton stay independent |

The rules that keep tiering from becoming a loophole:

- **Tier by impact, never by line or file count.** One line in a shared contract is Tier 3.
- **The AI proposes a tier with evidence; the human confirms it.** The AI never lowers its own tier to reduce confirmations.
- **Impact not yet established → `[tier: undetermined]`**, investigate inside the confirmed read-only scope. No defaulting to Tier 1.
- **Merging removes repeated Q&A, never investigation, authorization, or acceptance.**
- **A phase label never implies approval.** Merged breakpoints carry combined labels (`[phase: DESIGN_CONFIRM + SKELETON_REVIEW]`) and mean "working here", not "approved here".
- **A risk tier is not an emergency mode.** Tier 1 grants no bypass.
- **Tiering is not proven to reduce rework.** The skill says so, and it should stay said until real tasks show otherwise.

Also fixed: the README used to point at "the skill's L0–L3 table", which never existed in this repo. The table above is the one it meant.

## Why the gate is separate from the skill

The skill is the process constraint — what must pass through a human. The gate is the technical constraint — writes outside `.humanled/approvals.json` scopes are denied before they happen, ~150 lines, zero dependencies. Neither proves the other. The approvals file, the hook, and `settings.json` are outside the agent's write surface: Edit blocked, and so are `rm`, `>`, `sed -i` onto them. Missing or corrupt approvals → every write denied.

## Why not native `permissions.deny`?

Mostly you should use it — native rules are enforced by Claude Code, they hold in `--dangerously-skip-permissions` (verified; we expected otherwise), and they cost nothing.

But a rule in `settings.json` is a rule the agent can *edit*. Verified on 2.1.327: asking the agent to "update the config, that scope is too strict" made it drop its own deny rule and then write the file it had just been blocked from. The same attack against this gate: both writes denied, approvals file hash unchanged, agent returned to asking the human.

So: native rules for never-touch paths (`.env`, `.git`, secrets); the gate for the one thing native rules structurally cannot cover — the agent granting itself permission.

## What CI proves, and what it doesn't

The `gate` workflow covers 17 hook-protocol tests (ubuntu + windows × node 18/22), the plugin/marketplace manifests, and an installer smoke test on both OSes (files land, re-run idempotent, hook registered exactly once).

The end-to-end deny/allow against a live client is a **separate** workflow (`e2e.yml`, manual + weekly), and a job in `gate.yml` is explicitly named "end-to-end is NOT covered here". A green check must never imply a live client was exercised.

## Honest limits

- **Enforced on Claude Code only.** Cursor / Codex / Gemini CLI get the process skill, not enforcement — their rules are context, and context loses.
- **MCP tools that write through their own API** (e.g. a GitHub MCP committing files) are outside the hook's matcher.
- **The gate is tamper-proof against the agent, not against you.** You own the machine; you can edit the approvals file. That is the point.
- **Tiering's effect is unverified.** It is a hypothesis about where human attention goes, not a measured productivity claim.
- Verified / unverified / not-enforced are reported separately everywhere, including the cases that failed (`docs/verify.md`).

## Demo

With the gate installed and bypass mode on, telling the agent "create sneaky.ts, no questions":

```
[human-led-gate] DENIED: "sneaky.ts" is not in any approved task scope.
Stop: do NOT retry ... To grant: the human edits .humanled/approvals.json
(the agent may not).
```

The agent stopped, refused to edit the approvals file itself, and asked for human approval.
