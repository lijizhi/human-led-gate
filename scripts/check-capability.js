#!/usr/bin/env node
/**
 * Checks that a repo reaches a capability through one entry point.
 *
 * The problem: a repo grows three HTTP wrappers, four date formatters, two ways
 * to read a file's storage path. Each new one is reasonable in isolation; the
 * cost only shows up later, when a policy has to be changed in five places and
 * someone finds the sixth. Code review catches this when a reviewer remembers —
 * and reviewers are exactly as reliable as memory is.
 *
 * So the rule becomes executable: every capability names one canonical entry,
 * every bypass is declared with a reason, and an undeclared bypass fails.
 *
 * This is the counterpart to the write gate. The gate stops an agent from
 * exceeding the scope a human granted. This stops an agent from going around a
 * capability the repo already has. Both make a human decision machine-enforced.
 *
 *   node scripts/check-capability.js                # report
 *   node scripts/check-capability.js --strict       # exit 1 on any finding
 *   node scripts/check-capability.js path/manifest.json
 *
 * Doctrine, same as check-ledger.js and verify-freshness.js: fail closed. An
 * unreadable manifest, a bad regex, a scan target that does not exist — each is
 * a finding, never a silent pass.
 *
 * The manifest is JSON on purpose: the rules outlive the language they were
 * first written for.
 */
const fs = require("fs");
const path = require("path");

const API_VERSION = 1;
const STRICT = process.argv.includes("--strict");

const findings = [];
function add(code, message, where = "") {
  findings.push({ code, message, where });
}

function fail(code, message) {
  add(code, message);
  report();
  return 1;
}

/**
 * A manifest shape:
 *
 * {
 *   "version": 1,
 *   "capabilities": [
 *     {
 *       "name": "http-client",
 *       "canonical": "src/http/client.ts",
 *       "scan": ["src/**\/*.ts"],
 *       "forbid": ["from \"axios\"", "fetch\\("],
 *       "allow": [{ "path": "src/legacy/", "reason": "..." }]
 *     }
 *   ]
 * }
 */
function loadManifest(file) {
  if (!fs.existsSync(file)) return { error: `manifest not found: ${file}` };
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { error: `cannot read manifest: ${e.message}` };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { error: `manifest is not valid JSON: ${e.message}` };
  }
  return { manifest: json };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return "manifest is not an object";
  if (manifest.version !== API_VERSION) {
    return `version must be ${API_VERSION}, got ${JSON.stringify(manifest.version)}`;
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    return "capabilities must be a non-empty array";
  }
  for (const [i, cap] of manifest.capabilities.entries()) {
    const at = `capabilities[${i}]`;
    if (!cap || typeof cap !== "object") return `${at} is not an object`;
    if (!cap.name) return `${at} has no name`;
    if (!cap.canonical) return `${at} (${cap.name}) has no canonical entry`;
    if (!Array.isArray(cap.forbid) || cap.forbid.length === 0) {
      return `${at} (${cap.name}) has no forbid patterns — a capability that forbids nothing checks nothing`;
    }
    for (const [j, pattern] of cap.forbid.entries()) {
      try {
        new RegExp(pattern);
      } catch (e) {
        return `${at} (${cap.name}) forbid[${j}] is not a valid regex: ${pattern}`;
      }
    }
    for (const [j, entry] of (cap.allow ?? []).entries()) {
      if (!entry || typeof entry !== "object" || !entry.path) {
        return `${at} (${cap.name}) allow[${j}] needs a path`;
      }
      if (!entry.reason || !String(entry.reason).trim()) {
        return `${at} (${cap.name}) allow[${j}] (${entry.path}) has no reason — an unexplained bypass is indistinguishable from an oversight`;
      }
    }
    if (Array.isArray(cap.scan)) {
      for (const glob of cap.scan) {
        if (typeof glob !== "string" || !glob.trim()) {
          return `${at} (${cap.name}) has an empty scan glob`;
        }
      }
    }
  }
  return null;
}

/** Minimal glob: `**` spans directories, `*` does not. */
function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp(out + "$");
}

const SKIP_DIRS = new Set([".git", "node_modules", "build", "dist", ".dart_tool", "vendor", "target"]);

function walk(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else out.push(full);
  }
}

function filesFor(root, globs) {
  if (!globs || globs.length === 0) return [];
  const all = [];
  walk(root, root, all);
  const regexes = globs.map(globToRegExp);
  return all.filter((f) => {
    const rel = path.relative(root, f).split(path.sep).join("/");
    return regexes.some((re) => re.test(rel));
  });
}

function checkCapability(root, cap) {
  const files = filesFor(root, cap.scan);
  if (files.length === 0) {
    add(
      "empty-scan",
      `${cap.name}: scan globs matched no files (${(cap.scan ?? []).join(", ")}) — the capability is not being checked`,
      cap.name
    );
    return;
  }

  const patterns = cap.forbid.map((p) => new RegExp(p));
  const allow = (cap.allow ?? []).map((a) => a.path.split(path.sep).join("/"));
  let scanned = 0;

  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === cap.canonical) continue;
    if (allow.some((prefix) => rel.startsWith(prefix))) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      add("unreadable", `${rel}: cannot read, coverage unknown`, cap.name);
      continue;
    }
    scanned++;

    const lines = text.split("\n");
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let trimmed = line.trimStart();

      // A block comment has to be tracked across lines, not just line by line:
      // `/* from "axios" */` is a comment on a single line, and treating it as
      // a bypass makes the checker cry wolf over its own documentation.
      if (inBlockComment) {
        const end = line.indexOf("*/");
        if (end === -1) continue;
        inBlockComment = false;
        trimmed = line.slice(end + 2).trimStart();
      }
      if (trimmed.startsWith("/*")) {
        const end = trimmed.indexOf("*/");
        if (end === -1) {
          inBlockComment = true;
          continue;
        }
        trimmed = trimmed.slice(end + 2).trimStart();
      }
      if (!trimmed) continue;
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;

      for (const [idx, pattern] of patterns.entries()) {
        if (!pattern.test(trimmed)) continue;
        add(
          "bypass",
          `${rel}:${i + 1} reaches "${cap.name}" directly — use ${cap.canonical} instead (forbid[${idx}])`,
          cap.name
        );
      }
    }
  }

  if (scanned === 0) {
    // Zero scanned files is only suspicious when files were exempted by an
    // allowlist. A scan whose only match is the canonical entry is a normal,
    // healthy state: that capability has exactly one user, which is the goal.
    const exempted = files.filter((f) => {
      const rel = path.relative(root, f).split(path.sep).join("/");
      return rel !== cap.canonical;
    }).length;
    if (exempted > 0) {
      add(
        "no-coverage",
        `${cap.name}: every matched file was the canonical entry or allowlisted — nothing was actually scanned`,
        cap.name
      );
    }
  }
}

function findManifests() {
  const skip = SKIP_DIRS;
  const found = [];
  const walkAll = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      // A shipped template is an example, not a configuration. Scanning it
      // reports findings about paths that only exist in the example.
      if (entry.name === "templates") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkAll(full);
      else if (entry.name === "capabilities.json") found.push(full);
    }
  };
  walkAll(process.cwd());
  return found.sort();
}

function report() {
  for (const f of findings) {
    const where = f.where ? ` (${f.where})` : "";
    console.log(`[${f.code}] ${f.message}${where}`);
  }
  if (findings.length > 0) {
    console.log(`\n${findings.length} finding(s).`);
    console.log("A bypass with no declared reason is the same thing as a bug nobody wrote down.");
  }
}

function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const manifestPath = positional[0];

  if (manifestPath) {
    const { manifest, error } = loadManifest(path.resolve(manifestPath));
    if (error) return fail("bad-manifest", error);
    const problem = validateManifest(manifest);
    if (problem) return fail("bad-manifest", problem);

    const root = path.dirname(path.resolve(manifestPath));
    for (const cap of manifest.capabilities) checkCapability(root, cap);
    report();
    if (findings.length === 0) console.log(`OK  ${manifestPath} (${manifest.capabilities.length} capabilit${manifest.capabilities.length === 1 ? "y" : "ies"})`);
    return findings.length > 0 && STRICT ? 1 : 0;
  }

  const manifests = findManifests();
  if (manifests.length === 0) {
    console.log("No capabilities.json found. Nothing to check.");
    return 0;
  }

  for (const file of manifests) {
    const { manifest, error } = loadManifest(file);
    if (error) {
      add("bad-manifest", error, file);
      continue;
    }
    const problem = validateManifest(manifest);
    if (problem) {
      add("bad-manifest", problem, file);
      continue;
    }
    for (const cap of manifest.capabilities) checkCapability(path.dirname(file), cap);
  }

  report();
  if (findings.length === 0) console.log(`OK  ${manifests.length} manifest(s)`);
  return findings.length > 0 && STRICT ? 1 : 0;
}

process.exit(main());
