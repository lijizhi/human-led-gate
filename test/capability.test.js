#!/usr/bin/env node
/**
 * Tests for scripts/check-capability.js.
 *
 * This checker polices "reach this through one entry point", so it must not be
 * taken on faith. Every rule gets a test that it fires, and the legal cases get
 * a test that it stays quiet — a checker that cries wolf gets switched off, and
 * one that never barks is decoration.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.join(__dirname, "..");

function run(cwd, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "check-capability.js"), ...args],
    { cwd, encoding: "utf8" }
  );
}

/** A throwaway project with a canonical entry and a place to put violations. */
function scratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hled-cap-"));
  fs.mkdirSync(path.join(dir, "src", "legacy"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "client.js"),
    'import axios from "axios";\nexport const get = (u) => axios.get(u);\n'
  );
  fs.copyFileSync(
    path.join(REPO, "scripts", "check-capability.js"),
    path.join(dir, "check-capability.js")
  );
  return dir;
}

function writeManifest(dir, capabilities) {
  const file = path.join(dir, "capabilities.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, capabilities }, null, 2));
  return file;
}

const HTTP_CAP = {
  name: "http-client",
  canonical: "src/client.js",
  scan: ["src/**/*.js"],
  forbid: ['from "axios"'],
  allow: [],
};

test("a clean project passes", () => {
  const dir = scratchProject();
  fs.writeFileSync(path.join(dir, "src", "feature.js"), "export const f = 1;\n");
  writeManifest(dir, [HTTP_CAP]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test("a direct reach outside the canonical entry fails", () => {
  const dir = scratchProject();
  fs.writeFileSync(
    path.join(dir, "src", "feature.js"),
    'import axios from "axios";\nexport const f = () => axios.get("/x");\n'
  );
  writeManifest(dir, [HTTP_CAP]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /bypass/);
  assert.match(r.stdout, /feature\.js:1/);
  assert.match(r.stdout, /src\/client\.js/);
});

test("the canonical entry itself is exempt", () => {
  const dir = scratchProject();
  writeManifest(dir, [HTTP_CAP]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("an allowlisted bypass passes when it carries a reason", () => {
  const dir = scratchProject();
  fs.writeFileSync(path.join(dir, "src", "legacy", "old.js"), 'import axios from "axios";\n');
  // A non-exempt file must exist too: if the allowlist swallowed every scanned
  // file, the check has stopped checking anything and says so.
  fs.writeFileSync(path.join(dir, "src", "feature.js"), "export const f = 1;\n");
  writeManifest(dir, [
    {
      ...HTTP_CAP,
      allow: [{ path: "src/legacy/", reason: "pre-dates the wrapper; removal tracked in T4.2" }],
    },
  ]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("an allowlist entry with no reason fails", () => {
  const dir = scratchProject();
  writeManifest(dir, [{ ...HTTP_CAP, allow: [{ path: "src/legacy/" }] }]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /bad-manifest/);
  assert.match(r.stdout, /reason/);
});

test("an allowlist entry with a blank reason fails", () => {
  const dir = scratchProject();
  writeManifest(dir, [{ ...HTTP_CAP, allow: [{ path: "src/legacy/", reason: "   " }] }]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /reason/);
});

test("a capability that forbids nothing fails", () => {
  const dir = scratchProject();
  writeManifest(dir, [{ ...HTTP_CAP, forbid: [] }]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /forbids nothing/);
});

test("an invalid regex in the manifest fails instead of crashing", () => {
  const dir = scratchProject();
  writeManifest(dir, [{ ...HTTP_CAP, forbid: ["([unclosed"] }]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /not a valid regex/);
});

test("a scan glob that matches nothing fails", () => {
  const dir = scratchProject();
  writeManifest(dir, [{ ...HTTP_CAP, scan: ["does/not/exist/**/*.js"] }]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /empty-scan/);
});

test("a capability whose every file is allowlisted reports no coverage", () => {
  const dir = scratchProject();
  fs.writeFileSync(path.join(dir, "src", "legacy", "old.js"), 'import axios from "axios";\n');
  writeManifest(dir, [
    {
      ...HTTP_CAP,
      scan: ["src/legacy/*.js"],
      allow: [{ path: "src/legacy/", reason: "everything here is legacy" }],
    },
  ]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /no-coverage/);
});

test("a malformed manifest is a finding, not a crash", () => {
  const dir = scratchProject();
  fs.writeFileSync(path.join(dir, "capabilities.json"), "{ not json");
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /not valid JSON/);
});

test("a wrong version fails", () => {
  const dir = scratchProject();
  fs.writeFileSync(
    path.join(dir, "capabilities.json"),
    JSON.stringify({ version: 2, capabilities: [HTTP_CAP] })
  );
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /version must be 1/);
});

test("no manifest anywhere is a pass, not a failure", () => {
  const dir = scratchProject();
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Nothing to check/);
});

test("comments are not treated as bypasses", () => {
  const dir = scratchProject();
  fs.writeFileSync(
    path.join(dir, "src", "feature.js"),
    '// we used to import axios here\n/* from "axios" */\nexport const f = 1;\n'
  );
  writeManifest(dir, [HTTP_CAP]);
  const r = run(dir, ["--strict"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("non-strict mode reports but exits 0", () => {
  const dir = scratchProject();
  fs.writeFileSync(path.join(dir, "src", "bad.js"), 'import axios from "axios";\n');
  writeManifest(dir, [HTTP_CAP]);
  const r = run(dir, []);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /bypass/);
});
