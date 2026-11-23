# Task record template

This file is an **optional** record carrier for [human-led development](../SKILL.md) — small tasks need no file, and a project with its own ledger keeps using it. It is a record, not a permission token. The AI must never fill in "approved" to grant itself access. Copying this template and where the copy lives must themselves be inside the task's authorization.

## Identity and state

- Task id:
- Plan version:
- Risk tier: undetermined
- Tier rationale, evidence, and key unknowns:
- The human's tier confirmation (quote and where in the conversation):
- Current phase: INIT (tier undetermined)
- Breakpoints in use and merged phases: filled after the tier is confirmed; a phase record does not mean that breakpoint was approved
- Client and session id:
- Owner:

## Human goals and design

- What the previous step solved, and where this task sits in the larger goal: (skip if there is no previous step)
- Goal (human words):
- Non-goals:
- Module ownership and rationale:
- Responsibilities, dependencies, data flow: (to be established by investigation and design confirmation)
- Key trade-offs and boundary behavior:
- Acceptance criteria:

## Approval record

- Approval quote and where in the conversation:
- Approved plan version:
- Exact files/objects allowed:
- Allowed behavior changes:
- Forbidden zones, behaviors that must stay stable, interfaces and compatibility:
- Verification requirements, accepted risks, open items:
- Shared resources / dependencies / emergency measures specifically approved: none unless explicitly approved
- Commit, push, MR, merge, release: NOT authorized

## Tier change and authorization expiry

- New facts and evidence; why the original tier or premise no longer holds: none unless raised during investigation or implementation
- Affected operations, changes already made, and where work stopped: recorded when it happens
- Confirmations that still stand, and what the human must re-decide:
- Re-confirmed tier, plan version, scope, and approval reference: the human's call; the AI may never lower the tier or widen scope itself

## Workspace and serialization

- Base revision and real workspace state at task start:
- Pre-existing changes and their owner:
- File ownership and waiting tasks: (a record does not prove mutual exclusion is implemented)
- Human-decided order:
- Interrupt / unknown-ownership / recovery re-check:

## Verification and acceptance

- Changes mapped to plan items, files and architectural layers touched:
- Structure checks: actual command, exit code, result, evidence location — not run
- Static analysis and behavior tests: actual command, exit code, result, evidence location — not run
- Desktop walkthrough: not run; a walkthrough does not prove the real client blocks anything
- Gate and client end-to-end verification: not run
- Deviations from plan, uncovered risks, unfinished items:
- Human acceptance: pending — self-check passing is not acceptance
- Rollback description for this change:

## Global impact and retrospective

- Actual change to responsibilities, dependencies, or data flow: (state it explicitly when nothing changed)
- New risks, exceptions, remaining items, and their effect on later tasks:
- Risks, design trade-offs, and next-time constraints from the human: (Tier 1 with nothing new does not require a forced summary; a deferred Tier 3 review must be marked deferred)
- Approval of content and where it is saved: not authorized; no lessons document is generated automatically
- Tiering effect: unverified — a document, check, or walkthrough passing does not prove rework or human effort fell
