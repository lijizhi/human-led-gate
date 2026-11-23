# human-led-gate

[![gate](https://github.com/lijizhi/human-led-gate/actions/workflows/gate.yml/badge.svg)](https://github.com/lijizhi/human-led-gate/actions/workflows/gate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Hooks for Claude Code that deny what an agent should not do — out-of-scope writes, secrets in shell commands, force pushes, `curl | sh`, credential edits — plus the collaboration protocol that decides what "should not" means.**

Two things, and they are different layers:

| Layer | What it is | What it stops |
|---|---|---|
| **Protections** | Six runtime rules in a `PreToolUse` hook | secrets leaving via shell, `rm -rf /`, force push, `curl \| sh`, exfiltration, credential-file edits, install-as-root |
| **Scope gate** | A human-owned `.humanled/approvals.json` | any `Edit`/`Write` outside the paths a human approved for this task — the agent cannot widen its own scope |

Most hook collections do the first. The second is the argument: **"AI proposes, human approves" is not human-led** — the moment the AI draws the option space, the human is just clicking a button, and clicking gets rubber-stamped. So scope lives in a file the agent cannot rewrite, not in a prompt it can reinterpret.

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

## The seven things it denies

Every rule below is a test, and every test also has a nearby safe command that must pass — because a gate that blocks `ls .humanled` gets turned off, which costs more than it saves.

| Rule | Denied | Allowed |
|---|---|---|
| **secrets** | `echo sk-ant-…`, `curl -H 'Authorization: Bearer ghp_…'` | `curl -H "Authorization: Bearer $TOKEN"` |
| **destructive** | `rm -rf /`, `rm -rf .git`, `git reset --hard`, `git clean -xfd`, `dd of=/dev/sda` | `rm -rf node_modules`, `git reset --soft` |
| **force push** | `git push --force`, `git push -f`, push that deletes a remote branch | `git push`, `git push --force-with-lease` |
| **pipe-to-shell** | `curl … \| sh`, `wget … \| python3` | `curl -o /tmp/i.sh`, `curl … \| jq` |
| **exfil** | `curl -d @/etc/passwd`, `tar czf - src \| curl -X POST` | `curl -d '{"q":1}'` |
| **credentials** | editing `.env`, `.npmrc`, `id_rsa`, `.aws/credentials`, `secrets.json` | editing `.env.example`, `src/credentials.ts` |
| **install-exec** | `npm install --unsafe-perm` | `npm install`, `npm ci` |

Each maps to a named risk rather than a vague policy. The scope gate and the credential rule together cover the tool-permission half of **OWASP LLM03:2026 Excessive Agency** and **LLM02:2026 Sensitive Information Disclosure** — mapped honestly in [`docs/owasp-mapping.md`](docs/owasp-mapping.md), including the parts an agent-side hook *cannot* address.

The rest of this README is the scope gate, which is what makes this different from a hook pack.

### Scope gate — the part the agent cannot widen

- `hooks/pretooluse-gate.js` — denies every `Edit`/`Write` outside a human-approved scope, **before it happens**. Not a reminder in a prompt. A deny at the tool layer.
- `.humanled/approvals.json` — the scope list. Only the human edits it. Three layers push back on an agent editing its own gate: the hook denies Edit, the hook's shell matcher denies the obvious `rm`/`>`/`sed -i` forms, and the installer writes `permissions.deny` rules so Claude Code itself blocks both file tools and shell commands naming these paths. **None of that is a capability sandbox** — see [What the gate does not stop](#what-the-gate-does-not-stop).
- `skills/human-led-development/` — the staged protocol the gate backs up: 9 phase responsibilities (INIT → MODULE_CONFIRM → PUBLIC_RISK_SCAN → DESIGN_CONFIRM → SKELETON_REVIEW → CODING → ACCEPTANCE → FINAL_REVIEW), grouped into **2, 3, or 6 human breakpoints depending on risk tier** — merging repeated Q&A, never the investigation, authorization, or acceptance itself. A human sets the tier, not the AI.

### Install as a Claude Code plugin (recommended)

The repo is its own plugin marketplace, so the gate installs by name and updates in place:

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

Two manual steps, because a plugin cannot write your `settings.json`:

1. Add a `.humanled/approvals.json` to the repo you want gated (copy `templates/approvals.json`). That file is the human-owned scope ledger — and the reason the plugin cannot be installed blind: **with no approvals file, the gate fails closed and denies every write.** Install it into a repo you didn't mean to gate and that repo stops accepting edits until the file exists. That is the design working, not a bug.
2. Add the sandbox deny rules to that repo's `.claude/settings.json` (the installer does this for you on the other route):

```json
{
  "permissions": {
    "deny": [
      "Edit(.humanled/**)",
      "Edit(.claude/hooks/**)",
      "Edit(.claude/settings.json)",
      "Edit(.claude/settings.local.json)",
      "Bash(*.humanled*)",
      "Bash(*.claude/hooks*)",
      "Bash(*.claude/settings.json*)"
    ]
  }
}
```

Without step 2 the hook still denies Edit and the obvious shell forms, but `permissions.deny` is what stops `find -delete`, `cp` and `cd .humanled && rm` — those are measured gaps, listed in `docs/verify.md`.

### Install without the plugin system (any client, git checkout)

```bash
git clone https://github.com/lijizhi/human-led-gate
cd /path/to/your/repo
node /path/to/human-led-gate/bin/humanled.js init
```

*(Not on npm — by choice. An `npx` line here would be a lie, and this project's whole credibility is saying what's actually true. `git clone` + one `node` command is the honest one-liner.)*

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
| Claude Code (2.1.x), plugin install | ✅ verified end-to-end, incl. `--dangerously-skip-permissions` | tested 2026-11-18 on 2.1.327, see `docs/verify.md` |
| Claude Code (2.1.x), standalone installer | ✅ verified end-to-end, incl. `--dangerously-skip-permissions` | tested 2026-11-13 on 2.1.323, see `docs/verify.md` |
| Codex / Gemini CLI | ❌ no equivalent hook contract shipped here | not enforced; process skill only |
| Cursor | ❌ rules are context, not enforcement | pointer installed, says so in-file |
| Remote CI / merge protection | ❌ out of scope | that's branch protection's job |

The gate is tamper-proof **against the agent**, not against the human who owns the machine. That's the threat model: your AI granting itself permission.

What the badge actually covers: the hook-protocol tests (ubuntu + windows × node 18/22), the plugin/marketplace manifests, and the installer smoke test on both OSes. The end-to-end deny/allow against a live client is a **separate** workflow (`e2e.yml`, manual + weekly), because a green check here must not imply a live client was exercised. When `e2e` hasn't run against your version, treat end-to-end as unverified.

<!-- generated:numbers -->
| Fact | Value |
|---|---|
| Declared hook-protocol tests | 48 |
| `hooks/pretooluse-gate.js` | 310 lines |
| Sandbox deny rules written by the installer | 7 |

_Generated by `node scripts/doc-numbers.js`. Do not edit these rows by hand:
`--check` fails the build when they drift._
<!-- /generated:numbers -->

## Denial log — what the agent tried, not just that it was stopped

Every deny appends one JSON line to `.humanled/denials.log`:

```json
{"ts":"2026-11-23T09:09:30.540Z","tool":"Write","target":"sneaky.ts","task":null,"verdict":"deny-out-of-scope","detail":"..."}
```

`verdict` is one of `deny-out-of-scope`, `deny-forbidden`, `deny-self`, `deny-shell`, `deny-outside`, `deny-failclosed`, `deny-error`. Summarize it in the repo:

```bash
node <gate>/bin/humanled.js denials
```

```
4 denied attempt(s), 2026-11-23T09:08:40Z .. 2026-11-23T09:08:40Z

by verdict:
     2  deny-out-of-scope
     1  deny-self
     1  deny-shell
...
1 attempt(s) targeted the gate itself (verdict deny-self).
That is the threat model this project exists for — read those entries first
```

An agent that stops after one deny and an agent that probes five paths look identical without this. `deny-self` is called out separately because it is a different signal from `deny-out-of-scope`, which is usually just a wrong guess.

Three properties, so you can trust the log:

- **The install adds `.humanled/denials.log` to `.gitignore`.** Whether to commit it is your call — but it should not leak into a repo by default.
- **A logging failure never changes the verdict.** Read-only checkout, missing `.humanled/`, `denials.log` turned into a directory — the deny still denies. A test pins this.
- **An empty log is not proof of good behaviour.** The `permissions.deny` rules the installer writes refuse a write *before* the hook runs, so an attempt on `.humanled/**` is stopped by the sandbox and never reaches the hook to be logged. Verified on a live client: with the deny rules, editing `approvals.json` is blocked by "permission settings" and logs nothing; with the hook alone, the same attempt logs `deny-self`.

## What the gate does not stop

The honest boundary, measured 2026-11-23 (Claude Code 2.1.327) rather than assumed:

| Attempt | Hook alone | Hook + `permissions.deny` |
|---|---|---|
| `Edit`/`Write` on `.humanled/approvals.json` | denied | denied |
| `rm .humanled/approvals.json`, `>`, `sed -i`, `mv` | denied | denied |
| `find .humanled -name approvals.json -delete` | **allowed** | denied |
| `cp /tmp/x.json .humanled/approvals.json` | **allowed** | denied |
| `cd .humanled && rm approvals.json` | **allowed** | denied |
| `git checkout -- .humanled/approvals.json` | **allowed** | denied |
| `D=.humanled; rm $D/approvals.json` (path never spelled) | allowed | **allowed** |
| a script/binary that assembles the path at runtime | allowed | **allowed** |

So: install with the installer (it writes the deny rules), or add them by hand on the plugin route. And know the last two rows — this raises the cost of an agent rewriting its own permissions and leaves a trail in the transcript; it is not a capability sandbox. If you need that guarantee, run the agent in a container with the approvals file on a read-only mount.

Also not covered: Cursor/Codex/Gemini have no equivalent hook contract; MCP tools that write through their own API (a GitHub MCP committing files) are outside the matcher; a missing `node` on PATH means the hook cannot run.

## What you're adopting

```
.claude-plugin/                   # plugin + marketplace manifests (install by name)
hooks/pretooluse-gate.js          # the enforcement (zero deps)
hooks/hooks.json                  # plugin-mode hook wiring (${CLAUDE_PLUGIN_ROOT})
templates/approvals.json          # human-owned scope ledger (+ JSON schema)
skills/human-led-development/     # the protocol + task-record template
adapters/                         # AGENTS.md / .cursor/rules pointers (single source, no copies)
bin/humanled.js                   # standalone installer (non-plugin route)
docs/verify.md                    # verification matrix — run it before trusting any of this
```

## FAQ

**Why not just `permissions.deny` in settings.json?** Mostly you should — native rules are enforced by Claude Code, they hold in bypass mode, and they're free. We tested that before claiming anything (see `docs/verify.md` Layer 4). But a rule in `settings.json` is a rule the agent can *edit*: tell it "that scope is too strict, update the config and proceed" and it removes its own restriction, then acts. Verified on 2.1.327 — the native-rule version of that prompt wrote the file; the gate version was denied twice and asked the human instead. So: native rules for what nobody should ever do (`.env`, `.git`, secrets), the gate for the one thing native rules structurally can't cover — the agent granting itself permission.

**Doesn't this slow me down?** The breakpoints cost minutes — and they now scale with risk instead of being flat. Tier 1 (local, deterministic) has two: confirm the fix, then accept it. Tier 2 (in-module business change) has three. Tier 3 (public contracts, security, persistence, cross-module) keeps the independent risk, design, and skeleton judgments. Tiering merges rounds of Q&A, not investigation, authorization, or acceptance — and **the AI never lowers its own tier** to avoid a breakpoint. Whether this actually costs less rework is unproven; the skill says so.

**Can the agent just ask me to approve its scope?** That's the design. What it can't do is write first and present the approval as a formality.

**Why should I trust a rules repo?** You shouldn't — same doctrine, applied to us: run `docs/verify.md` against your own client version. We report verified / unverified / not-enforced separately and never claim more.

## License

MIT
