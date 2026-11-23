#!/usr/bin/env node
/**
 * Protocol-level tests for hooks/pretooluse-gate.js.
 *
 * Feeds synthetic PreToolUse JSON on stdin and asserts on the decision. No deps:
 * node --test. Every case below appears in docs/verify.md — if you add a claim
 * there, add the case here, or the claim is only a memory of a run.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOOK = path.join(__dirname, "..", "hooks", "pretooluse-gate.js");

/** Fixture: T1 approved on src/** with src/shared/** forbidden; T2 unapproved. */
function makeRepo(withApprovals = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hled-test-"));
  fs.mkdirSync(path.join(dir, ".humanled"), { recursive: true });
  if (withApprovals) {
    fs.writeFileSync(
      path.join(dir, ".humanled", "approvals.json"),
      JSON.stringify({
        version: 1,
        tasks: [
          { id: "T1", approved: true, files: ["src/**"], forbidden: ["src/shared/**"] },
          { id: "T2", approved: false, files: ["docs/**"] },
        ],
      })
    );
  }
  return dir;
}

function runHook(cwd, payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8" });
  return { status: r.status, stdout: (r.stdout || "").trim(), stderr: r.stderr || "" };
}

function decision(out) {
  if (!out.stdout) return "allow";
  const doc = JSON.parse(out.stdout);
  return doc.hookSpecificOutput.permissionDecision;
}

function write(cwd, file, tool = "Write") {
  return runHook(cwd, { tool_name: tool, cwd, tool_input: { file_path: file } });
}

function bash(cwd, command) {
  return runHook(cwd, { tool_name: "Bash", cwd, tool_input: { command } });
}

test("in-scope write is allowed (the gate is not a blanket deny)", () => {
  const repo = makeRepo();
  assert.strictEqual(decision(write(repo, "src/foo.ts")), "allow");
  assert.strictEqual(decision(write(repo, "src/deep/nested/thing.ts")), "allow");
});

test("write in a forbidden zone of an approved task is denied", () => {
  const repo = makeRepo();
  assert.strictEqual(decision(write(repo, "src/shared/bus.ts")), "deny");
});

test("write under an unapproved task is denied", () => {
  const repo = makeRepo();
  assert.strictEqual(decision(write(repo, "docs/a.md")), "deny");
});

test("any write outside the project directory is denied", () => {
  const repo = makeRepo();
  assert.strictEqual(decision(write(repo, "../outside.ts")), "deny");
});

test("the agent cannot edit the gate itself", () => {
  const repo = makeRepo();
  for (const target of [
    ".humanled/approvals.json",
    ".humanled/approvals.schema.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/pretooluse-gate.js",
  ]) {
    assert.strictEqual(decision(write(repo, target)), "deny", `${target} must be denied`);
  }
});

test("shell side doors onto the gate are denied", () => {
  const repo = makeRepo();
  for (const cmd of [
    "rm -f .humanled/approvals.json",
    "echo x > .claude/hooks/pretooluse-gate.js",
    "sed -i 's/false/true/' .humanled/approvals.json",
    "tee .claude/settings.json <<< '{}'",
    "truncate -s 0 .humanled/approvals.json",
  ]) {
    assert.strictEqual(decision(bash(repo, cmd)), "deny", `${cmd} must be denied`);
  }
});

test("ordinary shell commands and reads are not blocked", () => {
  const repo = makeRepo();
  // Reading the approvals file is a legitimate human-facing action.
  assert.strictEqual(decision(bash(repo, "cat .humanled/approvals.json")), "allow");
  assert.strictEqual(decision(bash(repo, "npm test")), "allow");
  assert.strictEqual(decision(bash(repo, "git status")), "allow");
});

test("non-edit tools pass through", () => {
  const repo = makeRepo();
  assert.strictEqual(
    decision(runHook(repo, { tool_name: "Read", cwd: repo, tool_input: { file_path: "secrets.txt" } })),
    "allow"
  );
});

test("fail-closed: unreadable stdin is denied", () => {
  const repo = makeRepo();
  assert.strictEqual(decision(runHook(repo, "{not json")), "deny");
  assert.strictEqual(decision(runHook(repo, "")), "deny");
});

test("fail-closed: missing approvals file denies every write", () => {
  const repo = makeRepo(false);
  assert.strictEqual(decision(write(repo, "src/foo.ts")), "deny");
});

test("fail-closed: corrupt approvals file denies every write", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, ".humanled", "approvals.json"), "{oops");
  assert.strictEqual(decision(write(repo, "src/foo.ts")), "deny");
});

test("an empty task list denies every write", () => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, ".humanled", "approvals.json"),
    JSON.stringify({ version: 1, tasks: [] })
  );
  assert.strictEqual(decision(write(repo, "src/foo.ts")), "deny");
});

test("deny output carries hookSpecificOutput with the protocol contract", () => {
  const repo = makeRepo();
  const out = runHook(repo, {
    tool_name: "Write",
    cwd: repo,
    tool_input: { file_path: "sneaky.ts" },
  });
  const doc = JSON.parse(out.stdout);
  assert.strictEqual(doc.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.strictEqual(doc.hookSpecificOutput.permissionDecision, "deny");
  assert.match(doc.hookSpecificOutput.permissionDecisionReason, /human-led-gate/);
  assert.match(doc.hookSpecificOutput.permissionDecisionReason, /approvals\.json/);
});

/**
 * Case-insensitive filesystems (Windows, macOS): `SRC/SHARED/x.ts` and
 * `src/shared/x.ts` are the same file. A case-sensitive match is fail-OPEN —
 * the forbidden rule silently stops protecting. Regression test for that.
 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

test("uppercase forbidden zone still blocks a lowercase write (case-insensitive fs)", {
  skip: CASE_INSENSITIVE_FS ? false : "Linux: the two paths are genuinely different files",
}, () => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, ".humanled", "approvals.json"),
    JSON.stringify({
      version: 1,
      tasks: [{ id: "T1", approved: true, files: ["src/**"], forbidden: ["SRC/SHARED/**"] }],
    })
  );
  assert.strictEqual(decision(write(repo, "src/shared/x.ts")), "deny");
  assert.strictEqual(decision(write(repo, "src/shared/x.ts", "Edit")), "deny");
});

test("uppercase approval glob still allows a lowercase write (case-insensitive fs)", {
  skip: CASE_INSENSITIVE_FS ? false : "Linux: the two paths are genuinely different files",
}, () => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, ".humanled", "approvals.json"),
    JSON.stringify({ version: 1, tasks: [{ id: "T1", approved: true, files: ["SRC/**"] }] })
  );
  assert.strictEqual(decision(write(repo, "src/a.ts")), "allow");
});

test("uppercase self-protect path is still denied (case-insensitive fs)", {
  skip: CASE_INSENSITIVE_FS ? false : "Linux: the two paths are genuinely different files",
}, () => {
  const repo = makeRepo();
  assert.strictEqual(decision(write(repo, ".HUMANLED/APPROVALS.JSON")), "deny");
  assert.strictEqual(decision(bash(repo, "rm -f .HUMANLED/APPROVALS.JSON")), "deny");
});

/**
 * The shell guard is a string matcher, not isolation. These cases document what
 * it does NOT catch, so nobody reads a passing suite as "the shell path is
 * closed". If one of these starts failing, the guard got stronger — update
 * docs/verify.md, don't delete the test.
 */
test("known gaps: the shell guard is not isolation (documents, not protects)", () => {
  assert.strictEqual(decision(bash(makeRepo(), "cat .humanled/approvals.json")), "allow");
  // These are the gaps. Asserting current behavior keeps them honest and visible.
  const gaps = [
    "cd .humanled && rm approvals.json",
    "F=.humanled/approvals.json; rm -f $F",
    "find .humanled -name approvals.json -delete",
    "cp /tmp/x.json .humanled/approvals.json",
    "git checkout -- .humanled/approvals.json",
  ];
  const missed = gaps.filter((cmd) => decision(bash(makeRepo(), cmd)) === "allow");
  assert.strictEqual(
    missed.length,
    gaps.length,
    `the shell guard now catches ${gaps.length - missed.length} of ${gaps.length} known gaps — good, ` +
      `but update docs/verify.md and this list together: caught=${JSON.stringify(
        gaps.filter((c) => !missed.includes(c))
      )}`
  );
});
