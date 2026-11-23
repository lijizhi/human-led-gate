# OWASP mapping — what this gate covers, and what it does not

The [OWASP Top 10 for LLM Applications 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/)
(v1.0, published 2026-08-03) is the current edition. Two of its entries have a tool-permission
surface an agent-side hook can act on. This page maps what is covered, how, and — more
importantly — which parts an agent-side hook structurally cannot reach, because a security
mapping that claims everything is a marketing page, not a mapping.

Version note: 2026 is an ID reshuffle from 2025. `LLM06` was Excessive Agency in 2025 and is
Unbounded Consumption now. The numbers below are 2026.

---

## LLM03:2026 — Excessive Agency

> Granting a model more autonomy, permissions, or reach than the task needs, so that a
> compromised or confused agent can act beyond what anyone intended.

An agent with a shell and a file tool has agency. The question this project acts on is
narrow and concrete: **which of those actions can be bounded by a pre-execution check?**

| Sub-risk | Covered? | How |
|---|---|---|
| Writing files outside the intended change | **Yes** | Scope gate: `.humanled/approvals.json` lists the paths a human approved. Everything else is denied before the write happens. |
| The agent widening its own permissions | **Yes** | The approvals file, the hook, and `settings.json` are outside the agent's write surface; plus `permissions.deny` rules evaluated by Claude Code itself. |
| Running an unreviewed remote script (`curl \| sh`) | **Yes** | `pipe-to-shell` rule. |
| Irreversible destructive commands | **Partly** | `destructive` rule catches `rm -rf /` and `.git`, `git reset --hard`, `git clean -xfd`, `dd of=/dev/…`, `chmod -R 777`. It is a pattern list, not a sandbox: a novel destructive command gets through. |
| Rewriting published history | **Partly** | `force push` rule; `--force-with-lease` is allowed deliberately, because it is the safe form and blocking it teaches people to bypass the gate. |
| Executing code at install time | **Partly** | `install-exec` rule blocks `--unsafe-perm`. It cannot inspect what an install script does. |
| Tool *selection* — the agent choosing an over-broad tool set | **No** | Not this layer. Set `tools`/`allowed-tools` in your client config. |
| Delegation to sub-agents with broader rights | **No** | Sub-agent permission inheritance is a client-configuration property. Not verified here; see `docs/verify.md`. |
| Autonomous multi-step goals that no single tool call reveals | **No** | A per-call hook cannot see intent across a plan. This is exactly why the repo ships a *process* (the tier-gated skill) alongside the hook — the human decision points are where multi-step agency is bounded, not the regex. |
| Cost / runaway consumption | **No** | That is LLM06:2026, and it is a spend-limit problem, not a tool-permission one. |

**Honest summary:** this gate bounds *individual tool invocations*. Excessive Agency as
OWASP describes it is also about goals, planning, and delegation, and a `PreToolUse` hook
cannot see those. The scope gate helps most where the damage would be a write; it does
nothing where the damage is a bad plan built entirely from individually-legal calls.

## LLM02:2026 — Sensitive Information Disclosure

> The application or its components reveal sensitive information to a party that should not
> have it.

| Sub-risk | Covered? | How |
|---|---|---|
| Secrets pasted into shell commands (transcript, history, denial log) | **Yes** | `secrets` rule: `sk-ant-`, `sk-`, `ghp_`/`gho_`/`ghs_`, `github_pat_`, `AKIA…`, `xox?_`, `AIza…`, private-key blocks. |
| The agent editing credential files into a diff | **Yes** | `credentials` rule: `.env`, `.npmrc`, `.netrc`, `id_rsa`, `.ssh/`, `.aws/credentials`, `.git-credentials`, `secrets.{json,yaml,toml}`. `.env.example` is deliberately allowed. |
| Sending a local file to the network | **Partly** | `exfil` rule catches `curl -d @file`, `-F file=@…`, `-T`, and packing-then-posting. It is a pattern match: an upload through a script the agent writes first is not seen. |
| Secrets in model output (the model was trained on or retrieved them) | **No** | That is a retrieval/training and output-filtering problem. Nothing at the tool boundary can fix it. |
| Secrets already in the repo being read by the agent | **No** | The gate denies *edits* to credential files, not reads. Read-scoping is a client `permissions.deny` concern (`Read(./.env)`) and belongs in your own config. |
| Secrets in logs, error messages, telemetry | **No** | Out of scope: this hook sees tool input, not what the application logs. |

**Honest summary:** this covers the two most common ways an *agent* moves a secret —
pasting it into a command, and committing it by editing a config file. It does not cover
anything about secrets once they are inside the model's context or the app's output.

---

## What a mapping like this is for

Two reasons, and neither is a badge:

1. **So you can decide whether to install it.** If your risk is "the agent commits `.env`"
   or "the agent runs `curl | sh`", the coverage column says yes. If your risk is "the agent
   plans something foolish within its perfectly legal tools", it says no, and the process
   part of this repo is where to look instead.
2. **So the claims can be checked.** Every "Yes" in these tables maps to a rule in
   `hooks/protections.js` and to a test in `test/protections.test.js` that shows both the
   deny and a nearby safe command passing. A row that says "Partly" is a place to file an
   issue, not a place to relax.

If a mapping here is wrong, that is a defect worth reporting — it is a claim about security
coverage, and this repo's whole position is that unverified claims are the problem.
