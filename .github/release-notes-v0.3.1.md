## What this release is

Two scripts that keep the documentation from lying, plus the tests that stop them from
lying themselves.

Both fixes come from defects this repository produced and then caught by hand:

- The docs carried `13 tests` when there were 17, then `~150 lines` when there were 184,
  then `~185 lines` when there were 281. Every one of those was found later, by accident.
- `docs/verify.md` said the gate was verified end-to-end on 2026-11-18. The hook was
  edited twice after that, from 164 lines to 281. The claim stayed word-for-word identical
  while the file it described no longer existed.

The second one is the serious one. A repo whose credibility rests on "every claim has a
reproducible command" cannot have a claim that outlives its evidence.

## 1. `node scripts/doc-numbers.js` — numbers are generated, not remembered

A delimited block in any markdown file gets its values written from the code:

```markdown
<!-- generated:numbers -->
| Fact | Value |
|---|---|
| Declared hook-protocol tests | 33 |
| `hooks/pretooluse-gate.js` | 281 lines |
| Sandbox deny rules written by the installer | 7 |
<!-- /generated:numbers -->
```

`--check` exits 1 when the block has drifted, and CI runs it, so a code change that adds a
test and forgets the docs fails the build instead of shipping a wrong number.

Test count is *declared* `test(` calls, not the number that passed — the two differ on
Linux, where the case-insensitive-filesystem cases are skipped, and a figure that changes
by platform is not a figure.

## 2. `node scripts/verify-freshness.js` — "verified" is stamped to a commit

Every verification block names the commit it was verified at and the files it is a claim
about:

```markdown
<!-- verified:at=37537e9 files=hooks/pretooluse-gate.js,test/gate.test.js -->
...claims...
<!-- /verified -->
```

The script checks, in order: the commit exists, each file existed at that commit, and —
the one that matters — **no listed file changed since**. Only the third check would have
caught the 2026-11-18 problem; a commit exists forever whether or not the code moved on.

It runs in CI as a **report, not a gate**: a stale block is not automatically wrong, it is
unproven for the current code. It prints the failing block with the commits that touched
the file, and points at `docs/KNOWN_GAPS.md`.

## 3. Every claim in `docs/verify.md` was re-run before stamping

Stamps are not retro-labels. Layers 1–3 were re-executed on 2026-11-23 against 2.1.327
before `verified:at=37537e9` was written: 33 protocol tests, the deny path, the allow path,
the case-insensitive forbidden zone, and fail-closed with no approvals file.

Layer 4 was **not** re-run, so it keeps its old stamp — and `verify-freshness.js`
correctly reports it stale:

```
STALE   docs/verify.md  (claimed at 06054f9)
          - hooks/pretooluse-gate.js changed 1 time(s) since 06054f9
```

That red line is the feature working. It is recorded as `STALE-1` in the new
`docs/KNOWN_GAPS.md` with what clears it, and the block itself says in bold that it was not
re-run. A tool that could be silenced by editing a sha without running anything would be
worse than no tool.

`docs/KNOWN_GAPS.md` is new and holds three more honest entries: the plugin-update question,
end-to-end never having run in CI, and the four remaining shell-guard bypasses.

## 4. The doc scripts are tested too

Six new tests in `test/docs-truth.test.js` run both scripts against throwaway git repos:
a block goes stale when a test is added, a stamp goes stale when its file changes, an
unknown commit is rejected, a claim about a file that didn't exist yet is rejected, and
non-strict mode stays advisory. A checker nobody checks is how you get manufactured
confidence.

Total: **33 tests**, all passing.

## Unchanged and still true

- The gate denies out-of-scope writes before they happen; `permissions.deny` covers the
  shell forms the hook's matcher misses; neither is a capability sandbox.
- Enforcement is Claude Code only.
- Denials are logged to `.humanled/denials.log`; `humanled denials` summarizes them.
- The shell-guard gap list is a ratchet that only goes down.
