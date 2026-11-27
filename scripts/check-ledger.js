#!/usr/bin/env node
/**
 * Checks a task index (TASKS.md) against the rules in
 * skills/human-led-progress/SKILL.md.
 *
 * Why this exists: a status nobody can check is a status nobody should trust.
 * A table of "done / partial / blocked" that only a human proofreads is a
 * description of what someone remembered, not what happened. The two fields
 * that make it checkable are the commit (does it exist?) and the gap (is
 * something actually written down?).
 *
 *   node scripts/check-ledger.js            # report
 *   node scripts/check-ledger.js --strict   # exit 1 on any finding
 *
 * Doctrine, same as scripts/verify-freshness.js: fail closed. A git call that
 * cannot run, a file that cannot be read, an unparseable table — each is a
 * finding, never a silent pass. A checker that manufactures confidence is worse
 * than no checker at all.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const STATES = new Set(["todo", "doing", "done", "partial", "blocked", "dropped"]);
const NEEDS_COMMIT = new Set(["done", "partial"]);
const NEEDS_GAP = new Set(["partial", "blocked", "dropped"]);

const ID = /^T\d+(?:\.\d+)*$/;
const TABLE_ROW = /^\|\s*(T\d+(?:\.\d+)*)\s*\|\s*([^|]*?)\s*\|\s*([a-z]+)\s*\|\s*([^|]*?)\s*\|\s*$/;
const HEADING = /^##\s+(T\d+(?:\.\d+)*)\s*·\s*(.+?)\s*$/;

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

const findings = [];
function add(file, line, code, message) {
  findings.push({ file, line, code, message });
}

/** Commits are only meaningful if git can resolve them here. */
function commitExists(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** An anchor is a repo-relative path, optionally with :line. */
function anchorProblem(spec) {
  if (spec.includes("\\")) return "uses Windows separators; write forward slashes";
  if (path.isAbsolute(spec) || /^[A-Za-z]:/.test(spec)) return "absolute path";
  const parts = spec.split("/");
  if (parts.includes("..")) return "contains a '..' segment";
  if (parts.includes(".")) return "contains a '.' segment";
  const shown = spec.replace(/:\d+(-\d+)?$/, "");
  if (!fs.existsSync(path.join(ROOT, shown))) return "path does not exist";
  return null;
}

function splitList(cell) {
  return cell
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripCode(cell) {
  return cell.replace(/`/g, "").trim();
}

/** Parse one TASKS.md into rows and detail blocks. */
function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rows = new Map();
  const blocks = new Map();

  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    const row = raw.match(TABLE_ROW);
    if (row) {
      const [, id, task, status, commit] = row;
      if (rows.has(id)) {
        add(file, lineNo, "duplicate-id", `${id} appears twice in the summary table`);
      }
      rows.set(id, { id, task: task.trim(), status, commit: stripCode(commit), line: lineNo });
      continue;
    }

    const head = raw.match(HEADING);
    if (head) {
      const [, id, name] = head;
      if (blocks.has(id)) {
        add(file, lineNo, "duplicate-block", `${id} has two detail blocks`);
      }
      current = { id, name: name.trim(), line: lineNo, anchors: null, gap: null, acceptance: null, gapLine: lineNo };
      blocks.set(id, current);
      continue;
    }

    if (!current) continue;

    const field = raw.match(/^-\s+(Anchors|Gap|Acceptance)\s*:\s*(.*)$/);
    if (field) {
      const [, key, value] = field;
      const v = value.trim();
      if (key === "Anchors") current.anchors = { value: v, line: lineNo };
      if (key === "Gap") {
        current.gap = v;
        current.gapLine = lineNo;
      }
      if (key === "Acceptance") current.acceptance = { value: v, line: lineNo };
    }
  }

  return { rows, blocks };
}

function check(file) {
  const { rows, blocks } = parse(file);

  if (rows.size === 0) {
    add(file, 1, "no-rows", "no task rows found; expected a four-column summary table");
    return;
  }

  for (const [id, row] of rows) {
    if (!ID.test(id)) add(file, row.line, "bad-id", `"${id}" is not a valid task id`);

    if (!STATES.has(row.status)) {
      add(
        file,
        row.line,
        "bad-status",
        `${id}: "${row.status}" is not one of ${[...STATES].join(", ")}`
      );
    }

    if (NEEDS_COMMIT.has(row.status)) {
      if (!row.commit || row.commit === "—" || row.commit === "-") {
        add(file, row.line, "missing-commit", `${id} is ${row.status} but has no commit`);
      } else {
        for (const sha of splitList(row.commit)) {
          if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
            add(file, row.line, "bad-commit", `${id}: "${sha}" is not a commit hash`);
          } else if (!commitExists(sha)) {
            add(file, row.line, "unknown-commit", `${id}: commit ${sha} does not resolve in this repo`);
          }
        }
      }
    } else if (row.commit && row.commit !== "—" && row.commit !== "-") {
      add(file, row.line, "unexpected-commit", `${id} is ${row.status}; commit must be —`);
    }

    const block = blocks.get(id);
    if (!block) {
      add(file, row.line, "missing-block", `${id} has a summary row but no detail block`);
      continue;
    }

    if (block.name !== row.task) {
      add(
        file,
        block.line,
        "name-mismatch",
        `${id}: heading says "${block.name}", table says "${row.task}"`
      );
    }

    if (NEEDS_GAP.has(row.status)) {
      const gap = (block.gap ?? "").trim();
      if (!gap || gap === "—" || gap === "-") {
        add(file, block.line, "missing-gap", `${id} is ${row.status} but its Gap is empty`);
      }
    } else if (block.gap && block.gap !== "—" && block.gap !== "-") {
      add(file, block.gapLine, "unexpected-gap", `${id} is ${row.status}; Gap must be —`);
    }

    if (block.anchors && block.anchors.value !== "—" && block.anchors.value !== "-") {
      for (const spec of splitList(block.anchors.value)) {
        const problem = anchorProblem(stripCode(spec));
        if (problem) {
          add(file, block.anchors.line, "bad-anchor", `${id}: anchor "${spec}" — ${problem}`);
        }
      }
    }

    if (!block.acceptance || !block.acceptance.value || block.acceptance.value === "—") {
      add(file, block.line, "missing-acceptance", `${id} has no acceptance line`);
    }
  }

  for (const [id, block] of blocks) {
    if (!rows.has(id)) {
      add(file, block.line, "orphan-block", `${id} has a detail block but no summary row`);
    }
  }
}

/** Every TASKS.md under the repo root, excluding build output and deps. */
function findIndexes() {
  const skip = new Set([".git", "node_modules", "build", "dist", ".dart_tool"]);
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "TASKS.md") found.push(full);
    }
  };
  walk(ROOT);
  return found.sort();
}

function main() {
  // The index is optional. No TASKS.md anywhere is a valid state, not a failure.
  const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const files = targets.length ? targets.map((f) => path.resolve(f)) : findIndexes();

  if (files.length === 0) {
    console.log("No TASKS.md found. Nothing to check.");
    return 0;
  }

  for (const file of files) {
    if (!fs.existsSync(file)) {
      add(file, 0, "missing-file", "file does not exist");
      continue;
    }
    check(file);
  }

  for (const f of findings) {
    const where = f.line ? `:${f.line}` : "";
    console.log(`${f.file}${where}  [${f.code}] ${f.message}`);
  }

  const shown = files.length === 1 ? files[0] : `${files.length} file(s)`;
  if (findings.length === 0) {
    console.log(`OK  ${shown}`);
    return 0;
  }

  console.log(`\n${findings.length} finding(s) in ${shown}.`);
  console.log("Each one is a claim the index cannot support. Fix the claim or change the state.");
  return STRICT ? 1 : 0;
}

process.exit(main());
