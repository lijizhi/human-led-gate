## Install

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

Then in the repo you want gated: copy `templates/approvals.json` to `.humanled/approvals.json`, and add the sandbox deny rules to `.claude/settings.json` (the installer writes both for you on the clone route).

## What's new in 0.3.0 — two ideas borrowed from a mature in-house harness

Both come from a production harness that has been running this discipline on a real codebase: a **ratchet** instead of a documented defect list, and **visibility** into attempts rather than only their outcome.

### 1. The shell-guard gaps are now a ratchet

v0.2.1 listed six shell forms the matcher misses, in a doc table and a test that asserted "all six still get through". That documents a defect; it does not pressure anyone to fix it.

Now `KNOWN_GAP_COUNT` may only go **down**. Fixing a bypass means deleting the entry and lowering the number in the same commit. Raising the count to make the suite pass fails on purpose. If a listed gap starts being caught, the test fails and names it.

It already paid off inside this release: the guard rewrite below caught `cp`, the ratchet failed, and it said exactly what to do —

```
ratchet broken: KNOWN_GAP_COUNT is 5 but 4 gaps are still open.
  caught now: ["cp /tmp/x.json .humanled/approvals.json"]
  To fix: remove the caught entries from KNOWN_GAPS and LOWER KNOWN_GAP_COUNT to 4.
  Never raise the count to make this pass.
```

### 2. A denied attempt is now recorded, not just refused

Every deny appends one JSON line to `.humanled/denials.log` with a machine-readable `verdict` (`deny-out-of-scope`, `deny-forbidden`, `deny-self`, `deny-shell`, `deny-outside`, `deny-failclosed`, `deny-error`). Summarize it in the repo:

```bash
node <gate>/bin/humanled.js denials
```

```
4 denied attempt(s), 2026-11-23T09:08:40Z .. 2026-11-23T09:08:40Z

by verdict:
     2  deny-out-of-scope
     1  deny-self
     1  deny-shell

1 attempt(s) targeted the gate itself (verdict deny-self).
That is the threat model this project exists for — read those entries first
```

An agent that stops after one deny and an agent that probes five paths look identical without this. `deny-self` gets its own callout: it means the agent reached for its own permissions, which is a different signal from a wrong guess at a path.

The install adds `.humanled/denials.log` to `.gitignore`; committing it is your call. **A logging failure never changes the verdict** — read-only checkout, missing `.humanled/`, or `denials.log` turned into a directory all still deny, and a test pins that.

**Read an empty log carefully:** the `permissions.deny` rules refuse a write *before* the hook runs, so attempts on `.humanled/**` are stopped by the sandbox and never reach the hook to be logged. Verified on a live client. An empty log means "the hook refused nothing", not "the agent behaved".

### 3. Fixed: the guard blocked reading, not just writing

Found while testing the log against a live client — the agent ran `ls .humanled` to inspect what was installed, and got denied. The matcher treated *any* command containing a protected path as a write.

A gate that punishes looking is a gate people turn off, which would have cost more safety than the bypass it prevented. Now:

| Command | Before | Now |
|---|---|---|
| `ls .humanled`, `cat .humanled/approvals.json`, `grep -r x .humanled` | **denied** | allow |
| `git status`, `git diff .humanled/approvals.json` | **denied** | allow |
| `ls .humanled && rm .humanled/approvals.json` | denied | denied (split on `;`/`&&`) |
| `cat .humanled/approvals.json; echo x > .humanled/approvals.json` | denied | denied |
| `cp /tmp/x.json .humanled/approvals.json` | allowed | **denied** |

Three regression tests lock: reads pass, a read prefix cannot shield a write on the same line, and redirecting a read's output elsewhere is fine.

## What CI proves, and what it doesn't

`gate` workflow: 27 hook-protocol tests on ubuntu + windows × node 18/22, manifest checks, and installer smoke on both OSes — including that a second run is idempotent, the hook is registered exactly once, the sandbox deny rules land, `denials.log` is gitignored, and the `denials` report behaves on both an empty and a populated log.

End-to-end against a live client stays a **separate** workflow (`e2e.yml`, manual + weekly), and a job in `gate.yml` is literally named "end-to-end is NOT covered here".

## Honest limits — unchanged

- **Enforced on Claude Code only.** Cursor / Codex / Gemini CLI get the process skill, not enforcement.
- **Not a capability sandbox.** A command that builds the protected path at runtime defeats both layers.
- **The gate is tamper-proof against the agent, not against you.**
- **Tiering's effect on rework is unverified.**
