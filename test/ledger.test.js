#!/usr/bin/env node
/**
 * Tests for scripts/check-ledger.js.
 *
 * The checker polices claims about project state, so it must not be taken on
 * faith: a ledger checker that silently passes is worse than none, because it
 * manufactures confidence. Every rule gets a test that it fires, and the legal
 * cases get a test that it stays quiet — a checker that cries wolf gets turned
 * off, and one that never barks is decoration.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.join(__dirname, "..");

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function check(cwd, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "check-ledger.js"), ...args],
    { cwd, encoding: "utf8" }
  );
}

/** A throwaway repo with one real commit, so commit hashes resolve. */
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hled-ledger-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.js"), "// app\n");
  fs.copyFileSync(
    path.join(REPO, "scripts", "check-ledger.js"),
    path.join(dir, "check-ledger.js")
  );
  git(dir, ["init", "-q", "."]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
  return dir;
}

function shaOf(dir) {
  return git(dir, ["rev-parse", "--short", "HEAD"]).stdout.trim();
}

function writeLedger(dir, body) {
  const file = path.join(dir, "TASKS.md");
  fs.writeFileSync(file, body);
  return file;
}

function ledger(rows, blocks) {
  return `# Task index\n\n> Status, commit and gap: the single source of truth.\n\n| ID | Task | Status | Commit |\n|----|------|--------|--------|\n${rows}\n${blocks}\n`;
}

function run(dir, args = ["--strict"]) {
  return check(dir, args);
}

test("a complete, honest index passes", () => {
  const dir = scratchRepo();
  const sha = shaOf(dir);
  writeLedger(
    dir,
    ledger(
      `| T1 | Ship the thing | done | \`${sha}\` |\n| T2 | Wire it up | partial | \`${sha}\` |\n| T3 | Consider the rest | todo | — |`,
      `## T1 · Ship the thing\n\n- Anchors: \`src/app.js\`\n- Acceptance: tests green\n\n## T2 · Wire it up\n\n- Anchors: \`src/app.js:1\`\n- Gap: the --dry-run path parses the flag but writes anyway\n- Acceptance: a dry run writes no file\n\n## T3 · Consider the rest\n\n- Anchors: —\n- Acceptance: decided either way`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test("a status outside the six values fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | Something | finishing | — |`,
      `## T1 · Something\n\n- Anchors: —\n- Acceptance: it is done`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /bad-status/);
});

test("done without a commit fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | Something | done | — |`,
      `## T1 · Something\n\n- Anchors: —\n- Acceptance: it works`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /missing-commit/);
});

test("a commit that does not resolve in git fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | Something | done | \`deadbee\` |`,
      `## T1 · Something\n\n- Anchors: —\n- Acceptance: it works`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /unknown-commit/);
});

test("partial without a gap fails", () => {
  const dir = scratchRepo();
  const sha = shaOf(dir);
  writeLedger(
    dir,
    ledger(
      `| T1 | Something | partial | \`${sha}\` |`,
      `## T1 · Something\n\n- Anchors: —\n- Acceptance: it works`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /missing-gap/);
});

test("an anchor that does not exist fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | Something | todo | — |`,
      `## T1 · Something\n\n- Anchors: \`src/nope.js\`\n- Acceptance: it works`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /bad-anchor/);
  assert.match(r.stdout, /does not exist/);
});

test("an anchor escaping the repo fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | Something | todo | — |`,
      `## T1 · Something\n\n- Anchors: \`../outside.js\`\n- Acceptance: it works`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /bad-anchor/);
  assert.match(r.stdout, /\.\./);
});

test("a summary row without its detail block fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | One | todo | — |\n| T2 | Two | todo | — |`,
      `## T1 · One\n\n- Anchors: —\n- Acceptance: fine`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /missing-block/);
});

test("a detail block without its summary row fails", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | One | todo | — |`,
      `## T1 · One\n\n- Anchors: —\n- Acceptance: fine\n\n## T9 · Ghost\n\n- Anchors: —\n- Acceptance: fine`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /orphan-block/);
});

test("a state that forbids a gap rejects one", () => {
  const dir = scratchRepo();
  writeLedger(
    dir,
    ledger(
      `| T1 | One | todo | — |`,
      `## T1 · One\n\n- Anchors: —\n- Gap: not started yet\n- Acceptance: fine`
    )
  );
  const r = run(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /unexpected-gap/);
});

test("no index anywhere is a pass, not a failure", () => {
  const dir = scratchRepo();
  const r = run(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Nothing to check/);
});

test("non-strict mode reports but exits 0", () => {
  const dir = scratchRepo();
  writeLedger(dir, ledger(`| T1 | X | nonsense | — |`, `## T1 · X\n\n- Anchors: —\n- Acceptance: y`));
  const r = run(dir, []);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /bad-status/);
});

test("the shipped template is itself valid", () => {
  const template = path.join(REPO, "skills", "human-led-progress", "templates", "TASKS.md");
  const dir = scratchRepo();
  fs.copyFileSync(template, path.join(dir, "TASKS.md"));
  const r = run(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
