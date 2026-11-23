## Install

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

Then two manual steps in the repo you want gated — a plugin cannot write your `settings.json`:

1. Copy `templates/approvals.json` to `.humanled/approvals.json`. **With no approvals file the gate fails closed and denies every write** — that is the design, not a bug.
2. Add the sandbox deny rules to `.claude/settings.json` (the installer writes these for you on the clone route):

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

## What this release fixes

All three defects were found by attacking the gate, not by reading it.

### 1. Fail-open on case-insensitive filesystems

Glob matching was case-sensitive, but on Windows and macOS `SRC/SHARED/x.ts` and
`src/shared/x.ts` are the same file. A forbidden zone written in different case silently
stopped protecting: verified, `forbidden: ["SRC/SHARED/**"]` allowed a write to
`src/shared/x.ts`. Forbidden zones are the last line of defense, and they were off.

Now case-insensitive on win32/darwin and case-sensitive on Linux, where the two paths
genuinely are different files. Regression tests cover both directions plus the
self-protect paths.

### 2. The shell guard is not isolation — and the docs said it was

`bashGuard` is a regex over the command text. Fed 12 forms directly, 6 got through:

| Command | Hook alone | Hook + `permissions.deny` |
|---|---|---|
| `rm .humanled/approvals.json`, `>`, `sed -i`, `mv` | denied | denied |
| `find .humanled -name approvals.json -delete` | **allowed** | denied |
| `cp /tmp/x.json .humanled/approvals.json` | **allowed** | denied |
| `cd .humanled && rm approvals.json` | **allowed** | denied |
| `git checkout -- .humanled/approvals.json` | **allowed** | denied |
| `D=.humanled; rm $D/approvals.json` | allowed | **allowed** |

The installer now writes `permissions.deny` rules, which Claude Code evaluates *before* the
shell runs. Verified on 2.1.327: `touch .humanled/x`, `find -delete`, and
`cd .humanled && touch x` were all denied by the permission layer — not by the model
declining, which is the distinction this project is built on.

**The residual gap, stated plainly:** a command that never spells the path defeats the Bash
deny rule, and a script that builds it at runtime defeats both layers. This raises the cost
of an agent rewriting its own permissions and leaves a trail; it is **not** a capability
sandbox. For that guarantee, run the agent in a container with the approvals file on a
read-only mount. `README.md` and `docs/verify.md` now both say this, and a test pins the gap
list so it cannot quietly drift.

### 3. Docs that had drifted from reality

- "13 tests" → the suite is 17, and it grew because the new cases are the ones that failed.
- "~150 lines" → 184.
- The CSDN article draft had been committed into the public repo by an earlier `git add -A`.
  Removed (kept locally); promotion drafts don't belong in the repository.
- `.claude-plugin/` added to the npm `files` whitelist so a future npm publish would carry
  the manifests.

## What CI proves, and what it doesn't

`gate` workflow: 17 hook-protocol tests on ubuntu + windows × node 18/22, manifest checks,
and an installer smoke test on both OSes — including that a second run is idempotent, that
the hook is registered exactly once, and that upgrading a 0.1 install adds the deny rules
without dropping a user's own deny entries.

End-to-end deny/allow against a live client is a **separate** workflow (`e2e.yml`, manual +
weekly), and a job in `gate.yml` is literally named "end-to-end is NOT covered here" — a
green check must never imply a live client was exercised.

## Honest limits

- **Enforced on Claude Code only.** Cursor / Codex / Gemini CLI get the process skill, not enforcement.
- **MCP tools that write through their own API** are outside the hook's matcher.
- **Not a sandbox.** See the residual gap above.
- **The gate is tamper-proof against the agent, not against you.** You own the machine.
- **Tiering's effect on rework is unverified.** It is a hypothesis about attention, not a measured productivity claim.
