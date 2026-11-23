#!/usr/bin/env node
/**
 * Keeps "verified" from becoming a permanent lie.
 *
 * The problem this solves, measured on this repo: docs/verify.md said the gate
 * was verified end-to-end on 2026-11-18. The hook was edited twice after that,
 * growing from 164 lines to 281. The claim stayed identical while the artifact it
 * described no longer existed. Nobody lies on purpose — the claim simply has no
 * link to the thing it is a claim about.
 *
 * So: every verification block names the commit it was verified at, and this
 * script compares that commit against the current tree.
 *
 *   <!-- verified:at=<commit> files=hooks/pretooluse-gate.js,bin/humanled.js -->
 *   ... the claims ...
 *   <!-- /verified -->
 *
 * Rules, checked in order:
 *   1. The commit exists.                         (typo / history rewrite)
 *   2. Every listed file exists at that commit.   (claim about a file that
 *                                                  didn't exist yet)
 *   3. No listed file changed since that commit.  (THE important one)
 *
 * Rule 3 is the whole point. Rule 1 alone would pass forever — the commit stays
 * in history whether or not the code moved on.
 *
 *   node scripts/verify-freshness.js           # report
 *   node scripts/verify-freshness.js --strict  # exit 1 on any stale block
 *
 * A stale block is not automatically wrong; it means the claim is unproven for
 * the current code and must be re-run and re-stamped, or explicitly marked as
 * unverified. The script never edits a stamp — only a human who actually re-ran
 * the verification may do that.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Resolve the repo from the working directory, not from this file's location, so
// the script checks the checkout the caller means — and can be tested against a
// throwaway repo without reading the real one's history.
function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

const ROOT = findRepoRoot(process.cwd());
const STRICT = process.argv.includes("--strict");
const HEADER = /<!--\s*verified:at=([0-9a-f]{7,40})\s+files=([^>]*?)\s*-->/g;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function commitExists(sha) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function fileAtCommit(sha, file) {
  try {
    git(["cat-file", "-e", `${sha}:${file}`]);
    return true;
  } catch {
    return false;
  }
}

/** Has `file` changed between `sha` and HEAD? */
function changedSince(sha, file) {
  try {
    // --quiet exits 1 when there is a difference.
    execFileSync("git", ["diff", "--quiet", sha, "HEAD", "--", file], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return false;
  } catch (err) {
    if (err.status === 1) return true;
    // Anything else (bad path, git failure) is reported as changed: fail closed,
    // same doctrine as the gate itself.
    return true;
  }
}

function markdownFiles() {
  const out = [];
  for (const entry of fs.readdirSync(ROOT)) {
    if (entry.endsWith(".md")) out.push(entry);
  }
  const docs = path.join(ROOT, "docs");
  if (fs.existsSync(docs)) {
    for (const f of fs.readdirSync(docs)) if (f.endsWith(".md")) out.push(path.join("docs", f));
  }
  return out;
}

const results = [];

for (const rel of markdownFiles()) {
  const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const m of body.matchAll(HEADER)) {
    const sha = m[1];
    const files = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const problems = [];

    if (!commitExists(sha)) {
      problems.push(`commit ${sha} does not exist`);
    } else {
      for (const f of files) {
        if (!fileAtCommit(sha, f)) {
          problems.push(`${f} did not exist at ${sha}`);
        } else if (changedSince(sha, f)) {
          const commits = git(["log", "--oneline", `${sha}..HEAD`, "--", f])
            .split("\n")
            .filter(Boolean);
          problems.push(
            `${f} changed ${commits.length} time(s) since ${sha}` +
              (commits.length ? ` (latest: ${commits[0]})` : "")
          );
        }
      }
    }

    results.push({ file: rel, sha, files, problems });
  }
}

if (results.length === 0) {
  console.log("No verification blocks found — nothing to check.");
  console.log("Add <!-- verified:at=<sha> files=<a,b> --> around claims you have actually re-run.");
  process.exit(0);
}

let failures = 0;
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`OK      ${r.file}  (verified at ${r.sha})`);
    continue;
  }
  failures += 1;
  console.log(`STALE   ${r.file}  (claimed at ${r.sha})`);
  for (const p of r.problems) console.log(`          - ${p}`);
}

if (failures) {
  console.log("");
  console.log(`${failures} verification block(s) no longer describe the current code.`);
  console.log("Re-run the verification, then update the stamp to the commit you ran it at.");
  console.log("Do not change the sha without running it — that is the whole point.");
  console.log("");
  console.log("If a block is known-stale on purpose, it must have an entry in");
  console.log("docs/KNOWN_GAPS.md saying who can clear it and when. Otherwise it is just rot.");
  if (STRICT) process.exit(1);
} else {
  console.log(`\nAll ${results.length} verification block(s) describe the current code.`);
}
