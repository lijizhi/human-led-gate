## The short version

v0.3 was one idea, well argued: a scope gate the agent cannot widen. That reads as a
clever argument, not a tool — a visitor weighing it against a hook pack had nothing to
compare. v0.4 adds the other half without giving up the argument.

**Seven protections, each with a paired test showing the deny *and* a nearby safe command
that must pass.**

| Rule | Denied | Allowed |
|---|---|---|
| secrets | `echo sk-ant-…`, `curl -H 'Authorization: Bearer ghp_…'` | `curl -H "Authorization: Bearer $TOKEN"` |
| destructive | `rm -rf /`, `rm -rf .git`, `git reset --hard`, `git clean -xfd`, `dd of=/dev/sda`, `chmod -R 777` | `rm -rf node_modules`, `git reset --soft` |
| force push | `git push --force`, `git push -f`, a push that deletes a remote branch | `git push`, `git push --force-with-lease` |
| pipe-to-shell | `curl … \| sh`, `wget … \| python3` | `curl -o /tmp/i.sh`, `curl … \| jq` |
| exfil | `curl -d @/etc/passwd`, `tar czf - src \| curl -X POST` | `curl -d '{"q":1}'` |
| credentials | editing `.env`, `.npmrc`, `id_rsa`, `.aws/credentials`, `secrets.json` | editing `.env.example`, `src/credentials.ts` |
| install-exec | `npm install --unsafe-perm` | `npm install`, `npm ci` |

Protections run **before** the scope gate: a force push into an approved file is still a
force push. Each deny is logged with its own verdict, and a repo can disable one rule in
`.humanled/approvals.json` under `"protections"` without forking the hook.

```bash
claude plugin marketplace add lijizhi/human-led-gate
claude plugin install human-led-gate@human-led-gate
```

## Why paired tests, not just deny tests

Writing the allow-tests caught three real defects, none of which a deny-only suite would
have surfaced:

1. The force-push rule did not exclude `--force-with-lease` — the *safe* form of force push,
   and blocking it teaches people to route around the gate.
2. The `.env` rule swallowed `.env.example`. `.env.example` is the file you ship; editing it
   is the documented workflow, and denying it is how a tool gets uninstalled.
3. `sk-ant-…` was reported as an "OPENAI-style" key. A wrong-vendor message in a security
   tool makes every other message suspect.

This is the same failure the repo already had once: v0.2.x denied `ls .humanled` because the
matcher treated any command naming a protected path as a write. A gate that punishes looking
gets turned off, which costs more safety than the bypass it prevented. The paired-test
discipline exists so that class of mistake fails in CI instead of in someone's afternoon.

## OWASP mapping, including what it cannot cover

`docs/owasp-mapping.md` maps to the current **OWASP Top 10 for LLM Applications 2026**
(v1.0, 2026-08-03):

- **LLM03:2026 Excessive Agency** — the scope gate bounds writes and the agent's ability to
  widen its own permissions; protections bound pipe-to-shell, destructive commands and
  install-time execution.
- **LLM02:2026 Sensitive Information Disclosure** — secrets pasted into commands and
  credential files edited into a diff.

And it says, in a table, what an agent-side hook structurally **cannot** do: bound an
autonomous multi-step plan built from individually legal calls, scope delegation to
sub-agents, limit cost (LLM06), or remove secrets already in the model's context. A security
mapping that claims everything is a marketing page.

Note the 2026 ID reshuffle: `LLM06` was Excessive Agency in 2025 and is Unbounded Consumption
now. Anything mapped to 2025 identifiers points somewhere else today.

## Verified

- **48 tests**, all passing, on ubuntu + windows × node 18/22 in CI.
- 15-case protocol matrix re-run on the hook before the docs were re-stamped: deny, allow,
  uppercase forbidden zone, self-protect, shell side door, read passthrough, and the three
  protections that are easiest to get wrong.
- Live client on 2.1.327: out-of-scope write denied, in-scope write allowed, denial logged.
- All three install routes carry `hooks/protections.js` (plugin, installer, `require`
  resolves relative to the hook).
- GitHub description rewritten to lead with the words people search for (`hooks for Claude
  Code`, `deny`, `force push`, `curl | sh`) rather than only the invented framing. The repo
  previously matched no realistic search query except its own phrasing.

## Unchanged, and still honestly bounded

- Enforcement is **Claude Code only**; Cursor/Codex/Gemini get the process skill.
- Not a capability sandbox: a command that builds a protected path at runtime defeats both
  layers. The shell-guard gap list is still a ratchet that only goes down (4 entries).
- Layer 4 of `docs/verify.md` (native `permissions.deny` behaviour) is still reported stale —
  it was not re-run, and `docs/KNOWN_GAPS.md` says what clears it.
- End-to-end against a live client still has never run in CI; `e2e.yml` needs an
  `ANTHROPIC_API_KEY` secret.
