#!/usr/bin/env node
/**
 * humanled — one-command installer for the human-led gate.
 *
 *   npx humanled init            # in your repo root
 *
 * Copies: hook script -> .claude/hooks/, gate config -> .claude/settings.json
 * (merged if present), starter approvals -> .humanled/, process skill ->
 * .claude/skills/human-led-development/, plus AGENTS.md / .cursor/rules pointers.
 * Never overwrites existing files without --force.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const PKG = path.resolve(__dirname, "..");
const TARGET = process.cwd();
const FORCE = process.argv.includes("--force");

function log(msg) {
  process.stdout.write(msg + "\n");
}
function copy(relFrom, relTo) {
  const src = path.join(PKG, relFrom);
  const dst = path.join(TARGET, relTo);
  if (fs.existsSync(dst) && !FORCE) {
    log(`  skip (exists): ${relTo}   [use --force to overwrite]`);
    return false;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  log(`  wrote: ${relTo}`);
  return true;
}

/**
 * Deny rules that close most of the shell path the hook's string matcher misses.
 *
 * The PreToolUse hook sees a Bash command as text it cannot parse, so `cp`,
 * `find -delete`, `python -c` and friends get past it. Claude Code's own
 * `permissions.deny` is evaluated before the shell runs, and a Bash rule that
 * matches the path catches those forms. Verified 2026-11-23 on 2.1.327:
 * with these rules `touch .humanled/x`, `find .humanled -name x -delete`,
 * `cd .humanled && touch x` and `sh -c "echo x > .humanled/keep.txt"` were all
 * denied by the permission layer (not by the model declining).
 *
 * WHAT IT STILL DOES NOT DO: a Bash rule is a text match, so a command that
 * never spells the path — `D=.humanled; echo x > $D/approvals.json`, or a
 * script that assembles it at runtime — is not caught. This is a second layer
 * that raises the cost, not isolation. docs/verify.md states the residual gap.
 *
 * Edit rules cover the same paths so the file tools are blocked at the sandbox
 * layer regardless of whether the hook fires.
 */
const DENY_RULES = [
  "Edit(.humanled/**)",
  "Edit(.claude/hooks/**)",
  "Edit(.claude/settings.json)",
  "Edit(.claude/settings.local.json)",
  "Bash(*.humanled*)",
  "Bash(*.claude/hooks*)",
  "Bash(*.claude/settings.json*)",
];

function missingDenyRules(doc) {
  const have = new Set((doc.permissions || {}).deny || []);
  return DENY_RULES.filter((r) => !have.has(r));
}

function mergeSettings() {
  const dst = path.join(TARGET, ".claude", "settings.json");
  const hookCmd = "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-gate.js\"";
  const gate = {
    matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
    hooks: [{ type: "command", command: hookCmd, async: false, timeout: 10 }],
  };
  let doc = {};
  if (fs.existsSync(dst)) {
    try {
      doc = JSON.parse(fs.readFileSync(dst, "utf8"));
    } catch {
      log("  ERROR: .claude/settings.json is not valid JSON — refusing to touch it.");
      process.exit(1);
    }
  }

  const gateRegistered = JSON.stringify(doc).includes("pretooluse-gate.js");
  const missingDeny = missingDenyRules(doc);
  if (gateRegistered && missingDeny.length === 0) {
    log("  gate already registered in .claude/settings.json — nothing to merge.");
    return;
  }

  if (!gateRegistered) {
    doc.hooks = doc.hooks || {};
    doc.hooks.PreToolUse = (doc.hooks.PreToolUse || []).concat([gate]);
    log("  merged PreToolUse gate into .claude/settings.json");
  } else {
    log("  hook already registered; adding missing sandbox deny rules");
  }

  if (missingDeny.length) {
    doc.permissions = doc.permissions || {};
    doc.permissions.deny = (doc.permissions.deny || []).concat(missingDeny);
    log(`  added ${missingDeny.length} permissions.deny rule(s) protecting the gate files`);
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(doc, null, 2) + "\n");
}

log(`humanled init -> ${TARGET}\n`);
copy("hooks/pretooluse-gate.js", ".claude/hooks/pretooluse-gate.js");
mergeSettings();
copy("templates/approvals.json", ".humanled/approvals.json");
copy("templates/approvals.schema.json", ".humanled/approvals.schema.json");
copy("skills/human-led-development/SKILL.md", ".claude/skills/human-led-development/SKILL.md");
copy("skills/human-led-development/templates/task-record.md", ".claude/skills/human-led-development/templates/task-record.md");
copy("adapters/agents-pointer.md", "AGENTS.humanled.md");
copy("adapters/human-led-development.mdc", ".cursor/rules/human-led-development.mdc");

log(`
Done. Next:
  1. Commit .claude/ .humanled/ (the gate must be part of the repo).
  2. Approve a task scope by editing .humanled/approvals.json BY HAND (your AI must not).
  3. Verify enforcement before trusting it — see docs/verify.md.
`);
