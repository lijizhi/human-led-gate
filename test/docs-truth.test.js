#!/usr/bin/env node
/**
 * Tests for the doc-truth scripts. These tools police claims, so they should not
 * themselves be taken on faith: a freshness checker that silently passes is worse
 * than no checker, because it manufactures confidence.
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

function node(cwd, script, args = []) {
  return spawnSync(process.execPath, [path.join(REPO, "scripts", script), ...args], {
    cwd,
    encoding: "utf8",
  });
}

/** A throwaway repo the script can run in, with the scripts copied in. */
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hled-docs-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "verify-freshness.js"),
    path.join(dir, "scripts", "verify-freshness.js")
  );
  fs.copyFileSync(
    path.join(REPO, "scripts", "doc-numbers.js"),
    path.join(dir, "scripts", "doc-numbers.js")
  );
  git(dir, ["init", "-q", "."]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  return dir;
}

function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  const r = git(dir, ["commit", "-q", "-m", message]);
  assert.strictEqual(r.status, 0, `commit failed: ${r.stderr}`);
  return git(dir, ["rev-parse", "--short", "HEAD"]).stdout.trim();
}

test("doc-numbers: --check fails when a generated block is missing, passes once generated", () => {
  const dir = scratchRepo();
  // Minimum fixtures doc-numbers reads.
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "test", "a.test.js"), 'test("a", () => {});\ntest("b", () => {});\n');
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "hooks", "pretooluse-gate.js"), "line1\nline2\nline3\n");
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "bin", "humanled.js"),
    'const DENY_RULES = [\n  "a",\n  "b",\n  "c",\n];\n'
  );
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "# t\n\n<!-- generated:numbers -->\n<!-- /generated:numbers -->\n"
  );

  assert.strictEqual(node(dir, "doc-numbers.js", ["--check"]).status, 1, "empty block should be stale");
  assert.strictEqual(node(dir, "doc-numbers.js").status, 0, "generation should succeed");
  assert.strictEqual(node(dir, "doc-numbers.js", ["--check"]).status, 0, "now current");

  const body = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  assert.match(body, /\| Declared hook-protocol tests \| 2 \|/, "counts declared tests");
  assert.match(body, /\| `hooks\/pretooluse-gate.js` \| 3 lines \|/, "counts hook lines");
  assert.match(body, /\| Sandbox deny rules written by the installer \| 3 \|/, "counts deny rules");
});

test("doc-numbers: --check fails when the code changed and nobody regenerated", () => {
  const dir = scratchRepo();
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "test", "a.test.js"), 'test("a", () => {});\n');
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "hooks", "pretooluse-gate.js"), "x\n");
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bin", "humanled.js"), 'const DENY_RULES = [\n  "a",\n];\n');
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "# t\n\n<!-- generated:numbers -->\n<!-- /generated:numbers -->\n"
  );
  node(dir, "doc-numbers.js");
  assert.strictEqual(node(dir, "doc-numbers.js", ["--check"]).status, 0);

  // A new test appears; the doc still says 1.
  fs.appendFileSync(path.join(dir, "test", "a.test.js"), 'test("b", () => {});\n');
  assert.strictEqual(
    node(dir, "doc-numbers.js", ["--check"]).status,
    1,
    "adding a test must make the generated block stale — this is the whole point"
  );
});

test("verify-freshness: a stamp is OK while the file is untouched, STALE once it changes", () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, "lib.js"), "v1\n");
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    "<!-- verified:at=SHA files=lib.js -->\nclaims\n<!-- /verified -->\n"
  );
  const sha = commitAll(dir, "v1");

  // Stamp at the commit that produced v1.
  const doc = path.join(dir, "docs", "verify.md");
  fs.writeFileSync(doc, fs.readFileSync(doc, "utf8").replace("SHA", sha));
  commitAll(dir, "stamp");

  let r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);

  // Now change the verified file — exactly what happened in this repo between
  // v0.2.1 and v0.3.0.
  fs.writeFileSync(path.join(dir, "lib.js"), "v2\n");
  commitAll(dir, "change");

  r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 1, "a changed file must invalidate the stamp");
  assert.match(r.stdout, /STALE/);
  assert.match(r.stdout, /lib\.js changed since/);
});

test("verify-freshness: an unknown commit is reported, not silently accepted", () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, "lib.js"), "v1\n");
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    "<!-- verified:at=deadbee files=lib.js -->\nclaims\n<!-- /verified -->\n"
  );
  commitAll(dir, "v1");

  const r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /does not exist/);
});

test("verify-freshness: a claim about a file that did not exist yet is rejected", () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, "other.js"), "x\n");
  const sha = commitAll(dir, "before lib existed");

  // lib.js is added in a LATER commit than the stamp.
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    `<!-- verified:at=${sha} files=lib.js -->\nclaims\n<!-- /verified -->\n`
  );
  fs.writeFileSync(path.join(dir, "lib.js"), "v1\n");
  commitAll(dir, "add lib and the claim");

  const r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /did not exist at/);
});

test("verify-freshness: non-strict mode reports but does not fail, so CI can warn", () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, "lib.js"), "v1\n");
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    "<!-- verified:at=deadbee files=lib.js -->\nclaims\n<!-- /verified -->\n"
  );
  commitAll(dir, "v1");

  assert.strictEqual(node(dir, "verify-freshness.js", ["--strict"]).status, 1);
  assert.strictEqual(
    node(dir, "verify-freshness.js").status,
    0,
    "without --strict the script must still exit 0 so it can be advisory in CI"
  );
});

/**
 * #ignore= exists so a routine version bump does not invalidate a verification
 * that never depended on the version number. It must be narrow: it may hide the
 * named line and nothing else.
 */
test("verify-freshness: #ignore= hides only the lines it names", () => {
  const dir = scratchRepo();
  const manifest = path.join(dir, "plugin.json");
  fs.writeFileSync(manifest, '{\n  "name": "x",\n  "version": "1.0.0"\n}\n');
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    '<!-- verified:at=SHA files=plugin.json#ignore=version -->\nclaims\n<!-- /verified -->\n'
  );
  const sha = commitAll(dir, "v1");
  const doc = path.join(dir, "docs", "verify.md");
  fs.writeFileSync(doc, fs.readFileSync(doc, "utf8").replace("SHA", sha));
  commitAll(dir, "stamp");

  // A version bump alone must NOT invalidate the stamp — this is the whole point.
  fs.writeFileSync(manifest, '{\n  "name": "x",\n  "version": "1.0.1"\n}\n');
  commitAll(dir, "bump version");
  let r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 0, `a version bump alone must not go stale:\n${r.stdout}`);

  // Any other change must still invalidate it.
  fs.writeFileSync(manifest, '{\n  "name": "y",\n  "version": "1.0.1"\n}\n');
  commitAll(dir, "change name");
  r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 1, "a change outside #ignore= must still be caught");
  assert.match(r.stdout, /outside #ignore=/);
});

test("verify-freshness: a comma inside #ignore= does not split the file list", () => {
  const dir = scratchRepo();
  // {1,3} is a legal regex with a comma in it; naive splitting would break the spec.
  fs.writeFileSync(path.join(dir, "a.js"), "x1\n");
  fs.writeFileSync(path.join(dir, "b.js"), "y\n");
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    "<!-- verified:at=SHA files=a.js#ignore=x{1,3},b.js -->\nclaims\n<!-- /verified -->\n"
  );
  const sha = commitAll(dir, "v1");
  const doc = path.join(dir, "docs", "verify.md");
  fs.writeFileSync(doc, fs.readFileSync(doc, "utf8").replace("SHA", sha));
  commitAll(dir, "stamp");

  const r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 0, `both files should be found and current:\n${r.stdout}`);
  assert.match(r.stdout, /OK/);
});

test("verify-freshness: an invalid #ignore= regex fails closed", () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  fs.writeFileSync(
    path.join(dir, "docs", "verify.md"),
    "<!-- verified:at=SHA files=a.js#ignore=[unclosed -->\nclaims\n<!-- /verified -->\n"
  );
  const sha = commitAll(dir, "v1");
  const doc = path.join(dir, "docs", "verify.md");
  fs.writeFileSync(doc, fs.readFileSync(doc, "utf8").replace("SHA", sha));
  commitAll(dir, "stamp");

  const r = node(dir, "verify-freshness.js", ["--strict"]);
  assert.strictEqual(r.status, 1, "a broken ignore regex must not silently pass");
  assert.match(r.stdout, /invalid #ignore=/);
});
