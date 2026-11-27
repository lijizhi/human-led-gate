---
name: human-led-capability
description: Use when a repo has a canonical way to do something and an AI keeps reaching around it. A manifest that names one entry per capability, forces every bypass to carry a reason, and fails when one does not.
version: 0.1.0
---

# Human-Led Capability

The write gate answers *"may the agent touch this file?"*. This answers the other
question an agent raises: **"may it do this its own way?"**

A repo accumulates three HTTP wrappers, four date formatters, two ways to read a
storage path. Every one was reasonable when it was written. The cost appears
later, when a policy changes in five places and someone finds the sixth. Code
review catches this when a reviewer remembers — and that is exactly as reliable
as memory is.

So the rule becomes executable: **one entry per capability, every bypass declared
with a reason, an undeclared bypass fails.**

## The two gates are one idea

| | what it stops |
|---|---|
| `hooks/pretooluse-gate.js` | the agent exceeding the **scope a human granted** |
| `scripts/check-capability.js` | the agent going around a **capability the repo already has** |

Both turn a human decision into something a machine enforces. The first protects
blast radius; the second protects the single entry point that makes a policy
changeable at all.

## The manifest

JSON, not code, on purpose: the rules outlive the language they were first
written for. A `capabilities.json` at the root of the scanned tree.

```json
{
  "version": 1,
  "capabilities": [
    {
      "name": "http-client",
      "canonical": "src/http/client.ts",
      "scan": ["src/**/*.ts"],
      "forbid": ["from \"axios\"", "from \"node-fetch\"", "new XMLHttpRequest"],
      "allow": [
        {
          "path": "src/legacy/",
          "reason": "pre-dates the wrapper; removal tracked in T4.2"
        }
      ]
    }
  ]
}
```

| Field | Rule |
|---|---|
| `name` | What the capability is called. Used in every finding. |
| `canonical` | The one file allowed to reach it directly. |
| `scan` | Globs, relative to the manifest's directory. `**` spans directories. |
| `forbid` | Regexes matched per line. **Non-empty** — a capability that forbids nothing checks nothing. |
| `allow` | Approved bypasses, prefix-matched on path. **Each needs a `reason`.** |

## The rules it enforces

1. **`forbid` must be non-empty.** An empty list silently passes everything.
2. **Every `allow` entry needs a non-blank `reason`.** An unexplained bypass is
   indistinguishable from an oversight — and the moment one is, the manifest
   stops being a record of decisions and becomes a list of exceptions.
3. **A scan that matches no files is a finding.** A glob that matches nothing
   looks identical to a passing check.
4. **A scan whose every file is exempt is a finding.** If the canonical entry and
   the allowlist swallow the whole scan, the capability has stopped being checked.
   (A scan whose only match is the canonical entry is healthy — that capability
   has exactly one user, which is the goal.)
5. **A malformed manifest, a bad regex, an unreadable file: each is a finding.**
   Fail closed, same doctrine as the gate.
6. **Comments are not bypasses.** `// from "axios"` documents the past; it does
   not reach the network.

## Running it

```bash
node scripts/check-capability.js            # report every capabilities.json found
node scripts/check-capability.js --strict   # exit 1 on any finding
node scripts/check-capability.js path/capabilities.json
```

No `capabilities.json` anywhere is a **pass**, not a failure. This is optional
infrastructure: a repo that has not adopted it is not failing, it is simply not
being checked this way yet.

## Writing a manifest that survives

**Start with the bypass that actually happened.** Do not enumerate capabilities
from an architecture diagram; enumerate them from the last three code reviews
where you said "we already have a thing for that". A manifest invented from the
ideal architecture flags code nobody wrote.

**Name the canonical entry by file, not by concept.** `src/http/client.ts` is
checkable; "the HTTP layer" is not.

**An allowlist entry is a debt with a witness.** The `reason` must say who
removes it and when, in a form a person could act on. `"legacy"` is not a reason.
`"pre-dates the wrapper; removal tracked in T4.2"` is.

**Expect false positives on the first run, and fix the patterns — not the code.**
A checker that cries wolf gets switched off. If a `forbid` pattern matches
something legitimate, narrow the regex rather than adding an allowlist entry;
allowlist entries are for real decisions, not for tuning the scanner.

## What it does not do

- **It does not understand your code.** It matches regexes per line. A capability
  reached through a re-export, a dynamic import, or a string-built module path is
  invisible to it.
- **It does not prove the canonical entry is good.** It proves the others are
  not used directly.
- **It does not judge whether a bypass is justified.** It requires the reason to
  exist and be visible; the human decides whether it is acceptable.
- **It does not replace a linter.** ESLint's `no-restricted-imports` covers part
  of this for JavaScript imports. What this adds is the manifest as a *reviewable
  record*: every exception visible in one file, with its reason, checked in CI.

State these limits when introducing it. A manifest trusted beyond them is the
same false confidence the gate exists to remove.
