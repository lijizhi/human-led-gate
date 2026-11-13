# human-led-gate

**A pre-edit permission gate for AI coding agents — plus the collaboration protocol it enforces.**

"AI proposes, human approves" is not human-led. The moment the AI draws the option space, the human is just clicking a button. And clicking gets rubber-stamped.

This repo makes the human's decisions **technically enforced**:

- `hooks/pretooluse-gate.js` — a Claude Code `PreToolUse` hook that **denies every Edit/Write outside a human-approved scope, before it happens**. Not a reminder in a prompt. A deny at the tool layer.
- `.humanled/approvals.json` — the scope list. Only the human edits it; the hook blocks the agent from touching its own gate — through Edit **and** through shell side doors (`rm`, `>`, `sed -i`).
- `skills/human-led-development/` — the staged protocol the gate backs up: INIT → MODULE_CONFIRM → PUBLIC_RISK_SCAN → DESIGN_CONFIRM → SKELETON_REVIEW → CODING → ACCEPTANCE → FINAL_REVIEW, each breakpoint owned by a human decision.

```bash
git clone https://github.com/lijizhi/human-led-gate
cd /path/to/your/repo
node /path/to/human-led-gate/bin/humanled.js init
```

*(Not on npm — by choice. Clone + one node command; an `npx` line here would be a lie, and this project's whole credibility is saying what's actually true.)*

## The demo that matters

![gate denies an unauthorized write in bypass mode](docs/demo.gif)
*Rendered replay of the real 2026-11-13 transcript below (Claude Code 2.1.323; repro commands in [docs/verify.md](docs/verify.md), regenerate via `docs/render_demo.py`).*

With the gate installed and `--dangerously-skip-permissions` on (yes, *that* mode — per [official docs](https://code.claude.com/docs/en/hooks-guide), a PreToolUse deny holds in every permission mode), telling the agent "create sneaky.ts, no questions":

```
[human-led-gate] DENIED: "sneaky.ts" is not in any approved task scope.
Stop: do NOT retry. Report to the human ... To grant: the human edits
.humanled/approvals.json (the agent may not).
```

The agent stopped, refused to edit the approvals file itself, and asked for human approval. Verified on Claude Code 2.1.323, Windows — commands and results in [`docs/verify.md`](docs/verify.md).

## Why not just rules in AGENTS.md?

Because rules are context and context loses. Long sessions, model updates, a confident agent: "please don't modify the checker" is exactly the sentence an agent under pressure re-reads as a suggestion. There are hundreds of excellent AGENTS.md rule repos. None of them can *deny a tool call*. Rules tell the model what you prefer; the gate makes the unauthorized edit impossible to unilaterally perform.

The doctrine underneath, condensed (full text in the skill):

| Principle | Mechanism |
|---|---|
| Design decisions stay human — not just the approve button | INIT/DESIGN_CONFIRM breakpoints; AI drafts only on explicit request; "OK/go ahead" approves exactly one pending item |
| AI's self-report is not evidence | every completion claim needs commands, exit codes, `path:line` |
| Machine-checkable ≠ human-checkable | scope/deps/tests go to tooling; business intent, exceptions, risk stay with the human |
| Human attention is the scarcest resource | fewer confirmations, each one heavier; the gate spends AI enforcement, not your clicks |
| Fail closed | corrupt/missing approvals = deny; hook crash = block |
| Say what is NOT enforced | see the honesty matrix below |

## Capability matrix — honest, because that's the point

| Client | Pre-edit deny | Status |
|---|---|---|
| Claude Code (2.1.x) | ✅ verified end-to-end, incl. `--dangerously-skip-permissions` | tested 2026-11-13, see `docs/verify.md` |
| Codex / Gemini CLI | ❌ no equivalent hook contract shipped here | not enforced; process skill only |
| Cursor | ❌ rules are context, not enforcement | pointer installed, says so in-file |
| Remote CI / merge protection | ❌ out of scope | that's branch protection's job |

The gate is tamper-proof **against the agent**, not against the human who owns the machine. That's the threat model: your AI granting itself permission.

## What you're adopting

```
hooks/pretooluse-gate.js          # the enforcement (zero deps, ~150 lines)
templates/approvals.json          # human-owned scope ledger (+ JSON schema)
skills/human-led-development/     # the protocol + task-record template
adapters/                         # AGENTS.md / .cursor/rules pointers (single source, no copies)
bin/humanled.js                   # npx installer
docs/verify.md                    # verification matrix — run it before trusting any of this
```

## FAQ

**Doesn't this slow me down?** The breakpoints cost minutes. The protocol's whole thesis: minutes per task is what "the human actually decided things" costs. If you want a lighter path, grade the change (the skill's L0–L3 table) — but a human sets the grade, not the AI.

**Can the agent just ask me to approve its scope?** That's the design. What it can't do is write first and present the approval as a formality.

**Why should I trust a rules repo?** You shouldn't — same doctrine, applied to us: run `docs/verify.md` against your own client version. We report verified / unverified / not-enforced separately and never claim more.

## License

MIT
