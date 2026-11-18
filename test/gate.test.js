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
