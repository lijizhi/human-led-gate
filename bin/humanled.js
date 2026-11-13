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

function mergeSettings() {
  const dst = path.join(TARGET, ".claude", "settings.json");
  const hookCmd = os.platform() === "win32"
    ? "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-gate.js\""
    : "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/pretooluse-gate.js\"";
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
    if (JSON.stringify(doc).includes("pretooluse-gate.js")) {
      log("  gate already registered in .claude/settings.json — nothing to merge.");
      return;
    }
  }
  doc.hooks = doc.hooks || {};
  doc.hooks.PreToolUse = (doc.hooks.PreToolUse || []).concat([gate]);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(doc, null, 2) + "\n");
  log("  merged PreToolUse gate into .claude/settings.json");
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
