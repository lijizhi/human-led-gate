# Task record template

This file is a record, not a permission token. The AI must never fill in "approved" to grant itself access. Copying this template and where the copy lives must themselves be inside the task's authorization.

## Identity and state

- Task id:
- Plan version:
- Current phase: INIT
- Client and session id:
- Owner:

## Human goals and design

- Goal (human words):
- Non-goals:
- Module ownership and rationale:
- Key trade-offs and boundary behavior:
- Acceptance criteria:

## Approval record

- Approval quote and where in the conversation:
- Approved plan version:
- Exact files/objects allowed:
- Forbidden zones and behaviors that must stay stable:
- Shared resources / dependencies / emergency measures specifically approved: none unless explicitly approved
- Commit, push, MR, merge, release: NOT authorized
- Expiry reasons and re-approval records:

## Workspace and serialization

- Base revision and real workspace state at task start:
- Pre-existing changes and their owner:
- File ownership and waiting tasks: (a record does not prove mutual exclusion is implemented)
- Human-decided order:
- Interrupt / unknown-ownership / recovery re-check:

## Verification and acceptance

- Changes mapped to plan items:
- Actual commands, exit codes, results, evidence location:
- Gate and client end-to-end verification:
- Uncovered risks and unfinished items:
- Human acceptance: pending
- Rollback description for this change:

## Retrospective

- Risks and lessons from the human:
- Applicability and next-time constraints:
- Approval of content and where it is saved:
