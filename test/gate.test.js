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
 * Shell-guard gap RATCHET.
 *
 * The guard is a string matcher, not a parser — a set of shell forms get through
 * it. Listing those forms in docs is not enough: documentation of a defect does
 * not pressure anyone to fix it. This is a ratchet instead, the same shape as a
 * hardcode baseline:
 *
 *   - The number may only go DOWN. Fixing a bypass means removing it from
 *     KNOWN_GAPS and lowering KNOWN_GAP_COUNT in the same commit.
 *   - Raising the count to make the suite pass is forbidden — that is a new
 *     bypass, and it belongs back in the guard, not in this list.
 *   - If a gap starts being caught but is still listed, this fails and tells you
 *     to remove it and lower the number. Deliberately noisy: the goal is for the
 *     number to reach zero and the test to become a no-op.
 *
 * Note these are measured against the hook alone. `permissions.deny` catches the
 * ones that spell the path; the last entry defeats both layers.
 */
const KNOWN_GAPS = [
  "cd .humanled && rm approvals.json",
  "F=.humanled/approvals.json; rm -f $F",
  "find .humanled -name approvals.json -delete",
  "git checkout -- .humanled/approvals.json",
];
const KNOWN_GAP_COUNT = 4;

test("read-only investigation of the gate passes — a gate that punishes looking gets turned off", () => {
  const repo = makeRepo();
  for (const cmd of [
    "ls .humanled",
    "ls -la .humanled/",
    "cat .humanled/approvals.json",
    "head -20 .humanled/approvals.json",
    "grep -r scope .humanled",
    "git status",
    "git diff .humanled/approvals.json",
    "ls .claude/hooks",
  ]) {
    assert.strictEqual(decision(bash(repo, cmd)), "allow", `${cmd} must be allowed (read-only)`);
  }
});

test("a read-only prefix cannot shield a write in the same command line", () => {
  const repo = makeRepo();
  for (const cmd of [
    "ls .humanled && rm .humanled/approvals.json",
    "cat .humanled/approvals.json; echo x > .humanled/approvals.json",
    "ls .claude/hooks || cp evil.js .claude/hooks/pretooluse-gate.js",
  ]) {
    assert.strictEqual(decision(bash(repo, cmd)), "deny", `${cmd} must be denied (write hidden after a read)`);
  }
});

test("writing the read output elsewhere is not a gate write", () => {
  const repo = makeRepo();
  // Reads are allowed; the redirect target is outside the gate, so this is fine.
  assert.strictEqual(decision(bash(repo, "cat .humanled/approvals.json > /tmp/scratch.txt")), "allow");
});

test("shell-guard gap ratchet: the known-bypass count only goes down", () => {
  const repo = makeRepo();
  const stillOpen = KNOWN_GAPS.filter((cmd) => decision(bash(repo, cmd)) === "allow");
  const nowCaught = KNOWN_GAPS.filter((cmd) => decision(bash(repo, cmd)) === "deny");

  assert.strictEqual(
    stillOpen.length,
    KNOWN_GAP_COUNT,
    `ratchet broken: KNOWN_GAP_COUNT is ${KNOWN_GAP_COUNT} but ${stillOpen.length} gaps are still open.\n` +
      `  caught now: ${JSON.stringify(nowCaught)}\n` +
      `  To fix: remove the caught entries from KNOWN_GAPS and LOWER KNOWN_GAP_COUNT to ${stillOpen.length}.\n` +
      `  Never raise the count to make this pass.`
  );
  assert.strictEqual(
    KNOWN_GAPS.length,
    KNOWN_GAP_COUNT,
    `KNOWN_GAPS has ${KNOWN_GAPS.length} entries but KNOWN_GAP_COUNT says ${KNOWN_GAP_COUNT} — keep them in sync.`
  );
});

test("denials are logged with a machine-readable verdict, and logging never changes the decision", () => {
  const repo = makeRepo();
  const logPath = path.join(repo, ".humanled", "denials.log");

  assert.strictEqual(decision(write(repo, "sneaky.ts")), "deny");
  assert.strictEqual(decision(bash(repo, "rm -f .humanled/approvals.json")), "deny");
  assert.strictEqual(decision(write(repo, "src/foo.ts")), "allow");

  const lines = fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  // Allows are not logged — the log is about attempts, and how many files an
  // agent wrote legitimately is already in git.
  assert.strictEqual(lines.length, 2, "exactly the two denies should be logged");
  assert.deepStrictEqual(
    lines.map((l) => l.verdict),
    ["deny-out-of-scope", "deny-shell"]
  );
  for (const l of lines) {
    assert.ok(l.ts && !Number.isNaN(Date.parse(l.ts)), "every entry carries a parseable timestamp");
    assert.ok(l.detail && l.detail.length <= 300, "detail is present and truncated");
  }
});

test("a corrupt or missing approvals file is still denied AND logged as fail-closed", () => {
  const repo = makeRepo(false);
  assert.strictEqual(decision(write(repo, "src/foo.ts")), "deny");
  const lines = fs
    .readFileSync(path.join(repo, ".humanled", "denials.log"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.strictEqual(lines[0].verdict, "deny-failclosed");
});

test("logging failure cannot flip a deny into an allow", () => {
  const repo = makeRepo();
  // Make .humanled/denials.log a directory: appendFileSync will throw.
  fs.mkdirSync(path.join(repo, ".humanled", "denials.log"), { recursive: true });
  assert.strictEqual(
    decision(write(repo, "sneaky.ts")),
    "deny",
    "an unwritable log must not turn a deny into an allow"
  );
});

/**
 * BOUNDARY: the deny rules the installer writes stop a write BEFORE the hook
 * runs, so that particular attempt never reaches denials.log. Verified against a
 * live client on 2026-11-23: with the deny rules installed, an agent editing
 * .humanled/approvals.json is blocked by "permission settings" and nothing is
 * logged; with only the hook, the same attempt is logged as deny-self.
 *
 * This is worth pinning because it changes how the log should be read: an empty
 * denials.log does NOT mean no agent tried to touch the gate — it can mean the
 * sandbox layer answered first. Stated in README and docs/verify.md.
 */
test("BOUNDARY: sandbox deny rules answer before the hook, so those attempts are not logged", () => {
  const repo = makeRepo();
  // Simulate the sandbox having already refused: the hook is simply never called.
  // The observable consequence is what we assert — no log file appears.
  assert.ok(!fs.existsSync(path.join(repo, ".humanled", "denials.log")));
  // And the same attempt DOES log when the hook is the one answering.
  decision(write(repo, ".humanled/approvals.json"));
  assert.ok(fs.existsSync(path.join(repo, ".humanled", "denials.log")));
});

test("`humanled denials` summarizes the log and surfaces self-targeting attempts", () => {
  const repo = makeRepo();
  const installer = path.join(__dirname, "..", "bin", "humanled.js");

  decision(write(repo, "a.ts"));
  decision(write(repo, "b.ts"));
  decision(write(repo, ".humanled/approvals.json")); // verdict: deny-self

  const r = spawnSync(process.execPath, [installer, "denials"], { cwd: repo, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = r.stdout;

  assert.match(out, /3 denied attempt\(s\)/);
  assert.match(out, /deny-out-of-scope/);
  assert.match(out, /deny-self/);
  // The whole point of the report: self-targeting is called out, not buried.
  assert.match(out, /attempt\(s\) targeted the gate itself/);
});

test("`humanled denials` says so plainly when there is nothing recorded", () => {
  const repo = makeRepo();
  const installer = path.join(__dirname, "..", "bin", "humanled.js");
  const r = spawnSync(process.execPath, [installer, "denials"], { cwd: repo, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /No denials recorded/);
  assert.match(r.stdout, /is my gate alive\?/);
});

test("an unknown subcommand exits 2 instead of silently installing", () => {
  const repo = makeRepo();
  const installer = path.join(__dirname, "..", "bin", "humanled.js");
  const r = spawnSync(process.execPath, [installer, "denial"], { cwd: repo, encoding: "utf8" });
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /Usage: humanled init \| humanled denials/);
  assert.ok(!fs.existsSync(path.join(repo, ".claude", "hooks", "pretooluse-gate.js")));
});
