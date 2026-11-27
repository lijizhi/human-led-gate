---
name: human-led-progress
description: Use when a batch of related tasks spans more than one session and the human needs to see what is done, what is half-done, and what is missing. A machine-checkable task index, not a permission token.
version: 0.1.0
---

# Human-Led Progress

A task index for work that outlives one session. It answers one question the
chat transcript cannot: **across this batch, what is done, what is only partly
done, and what is still missing?**

`scripts/check-ledger.js` enforces the answer. A status that cannot be checked is
a status nobody can trust.

## Scope

This skill covers **task state across a batch of tasks**. It does not grant
write permission, does not replace [human-led-development](../human-led-development/SKILL.md),
and does not choose tasks for you.

Two records exist and they answer different questions — do not merge them:

| | `task-record.md` (human-led-development) | `TASKS.md` (this skill) |
|---|---|---|
| Granularity | inside **one** task | between the tasks of **one batch** |
| Answers | which phase this task reached, what the human approved | where the batch stands, what is missing |
| State | phase label (`INIT` … `FINAL_REVIEW`) | six-value status (`todo` … `dropped`) |
| Lifetime | archived when the task ends | updated across sessions and weeks |
| Checked by | a human reads it | `check-ledger.js` fails the build |

One line each: a task record is **how one task got finished**; a task index is
**what the batch has left**. A task in the index may link to its task record.

Do not store task state in two places. If a batch has a `TASKS.md`, that file is
the single source of truth for status, commit and gap — prose documents describe
the work, they do not restate its state.

## When to use it

Use it when **at least two** of these hold:

- the work will span more than one session or more than one day;
- more than one person or agent touches the batch;
- some items will end `partial`, or be blocked, or be dropped;
- someone will later ask "where did this end up?" and the answer cannot be
  reconstructed from `git log` alone.

Do not use it for a single task, or for a list of todos that all finish in one
sitting. An index maintained for work that never spans sessions becomes stale
paperwork — the exact failure this skill exists to prevent.

## The six states

Only these. There is no seventh; anything else is expressible as `blocked` plus
a gap, and a seventh value is a seventh way to be wrong.

| State | Meaning | Commit | Gap |
|---|---|---|---|
| `todo` | not started | `—` | not written |
| `doing` | started, nothing complete yet | `—` | not written |
| `done` | meets its acceptance criteria | **required** | not written |
| `partial` | shipped something, criteria not fully met | **required** | **required** |
| `blocked` | cannot proceed, waiting on something external | `—` | **required** |
| `dropped` | decided not to do it | `—` | **required** |

**`done` is a claim about the code, and the commit is how that claim is checked.**
A `done` row whose commit does not resolve in git is treated as a broken claim,
not a formatting error.

**A gap is not a disclaimer.** `partial`, `blocked` and `dropped` must say what is
missing or why, in a form another person could act on. "TBD" and "later" are not
gaps. If the gap cannot be stated, the item is not in that state yet.

## File format

One `TASKS.md` per batch, at a path the project chooses. Top is the summary
table; each task gets a detail block below it.

```markdown
# Task index

> Status, commit and gap: the single source of truth. Task definitions live elsewhere.
> Baseline: what this batch is aligned to (version, spec, or commit)

| ID | Task | Status | Commit |
|----|------|--------|--------|
| T1 | Cut the release artefacts | done | `0f6fe69` |
| T2 | Wire the installer | partial | `0f6fe69` |

## T1 · Cut the release artefacts

- Anchors: `bin/humanled.js`, `package.json`
- Acceptance: `npm test` green; `claude plugin validate` passes

## T2 · Wire the installer

- Anchors: `bin/humanled.js:40`
- Gap: `--dry-run` path not implemented; the flag parses but does nothing
- Acceptance: a dry run writes no file
```

Field rules, all enforced except where noted:

- **Summary table is four columns**: ID, Task, Status, Commit. It does not widen.
- **ID**: `T<n>`, optionally dotted for sub-tasks (`T8.9.1`). Unique per file. An
  existing ID is never renumbered — history points at it.
- **Status**: one of the six values above. Anything else fails.
- **Commit**: short hash or hashes separated by `,`. `done` / `partial` require at
  least one, and every one must resolve with `git cat-file -e <sha>^{commit}`.
  Other states write `—`.
- **Detail block heading**: `## <ID> · <task name>`, matching the table exactly.
  Every table row has exactly one block, and every block has a row.
- **Anchors**: repository-relative path, optional `:line`. Separated by `,`.
  No absolute paths, no `..` segments. Each must exist. Write `—` when the task
  touches no code. **An anchor proves a path exists, nothing more.**
- **Gap**: required exactly for `partial` / `blocked` / `dropped`; forbidden for
  the other three.
- **Acceptance**: one line stating what "finished" would be observable as.

## Running the check

```bash
node scripts/check-ledger.js            # report
node scripts/check-ledger.js --strict   # exit 1 on any finding
```

It fails closed: if git is unavailable, or a path cannot be read, that is a
finding — not a pass. A checker that silently passes is worse than no checker,
because it manufactures confidence.

Run it in CI. A task index that is only checked when someone remembers is
already stale.

## What it does not do

- **It does not judge whether the tasks were split well.** Granularity is a human
  decision.
- **It does not verify that a `done` task works.** A resolvable commit proves
  history, not behaviour. Acceptance stays the human's.
- **It does not check that anchors are relevant.** It checks that they exist.
- **It does not sync across repositories or machines.** One file, one checkout,
  one git history.

State all four limits when introducing the index to a project. An index trusted
beyond them is the same false confidence the gate exists to remove.
