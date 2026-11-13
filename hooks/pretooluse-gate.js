#!/usr/bin/env node
/**
 * human-led-gate — PreToolUse hook (Claude Code)
 *
 * Blocks Edit/Write/MultiEdit/NotebookEdit unless the target file is inside
 * a scope explicitly approved by a human in .humanled/approvals.json.
 * The gate itself (approvals file, hook, settings) is never writable by the
 * agent — the AI cannot grant itself permission.
 *
 * Fail-closed: missing/corrupt approvals => deny. Hook crash with
 * "onFailure": "block" in settings => Claude Code blocks the edit too.
 *
 * Protocol: reads hook JSON on stdin, writes hookSpecificOutput on stdout.
 * Zero dependencies.
 */

const fs = require("fs");
const path = require("path");

const SELF_PROTECT = [
  ".humanled/approvals.json",
  ".humanled/approvals.schema.json",
  ".claude/hooks/pretooluse-gate.js",
  ".claude/settings.json",
  ".claude/settings.local.json",
];

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n"
  );
  process.exit(0);
}

function allow() {
  process.exit(0); // no decision -> normal permission flow continues
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.setTimeout(5000, () => resolve(data));
  });
}

/** glob-lite -> RegExp: supports **, *, ? (no braces) */
function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

/**
 * Best-effort guard for the rm/mv/redirection side door: a shell command that
 * names a protected path in a write position. Not a parser — this closes the
 * casual path, docs/verify.md states what it does NOT cover.
 */
function bashGuard(command) {
  const norm = command.replace(/\\/g, "/");
  const prot = SELF_PROTECT.map((p) => p.replace(/[.*+?^${}()|[\]]/g, "\\$&"));
  // .humanled/ dir itself and anything under .claude/hooks/
  prot.push("\\.humanled(?:/\"|/[^\\s\"']*)?", "\\.claude/hooks(?:/[^\\s\"']*)?");
  const destructive = new RegExp(
    `(?:^|[;&|]|\\s)(?:rm|del|erase|mv|move|ren|rename|truncate|sed\\s+-i|tee)\\b[^\\n]*(${prot.join("|")})`,
    "i"
  );
  const redirect = new RegExp(`>{1,2}[^&]*(${prot.join("|")})`, "i");
  return destructive.test(norm) || redirect.test(norm);
}

const GATE_MSG = (file) =>
  `[human-led-gate] DENIED: "${file}" is not in any approved task scope.\n` +
  `This tool call is an unauthorized write. Stop: do NOT retry, do NOT "just quickly" write it.\n` +
  `Report to the human: the target file, the task, the proposed scope (file list), and the plan version.\n` +
  `Wait for explicit approval. To grant: the human edits .humanled/approvals.json (the agent may not).\n` +
  `Current phase should be DESIGN_CONFIRM or SKELETON_REVIEW until approval exists.`;

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    deny("[human-led-gate] DENIED (fail-closed): hook received unreadable input.");
  }

  const tool = input.tool_name || "";
  if (tool === "Bash") {
    const cmd = (input.tool_input && input.tool_input.command) || "";
    if (bashGuard(cmd))
      deny(
        "[human-led-gate] DENIED: shell command targets a protected gate path (approvals/hook/settings). " +
          "The agent may never modify the gate through a side door. The human edits these files directly."
      );
    allow();
  }
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) allow();

  const cwd = input.cwd || process.cwd();
  let target =
    (input.tool_input && input.tool_input.notebook_path) ||
    (input.tool_input && input.tool_input.file_path) ||
    (input.tool_input && input.tool_input.path) ||
    "";
  if (!target) deny("[human-led-gate] DENIED (fail-closed): no file path in tool input.");

  target = path.resolve(cwd, target);
  let rel = path.relative(cwd, target).replace(/\\/g, "/");
  if (rel.startsWith(".."))
    deny(`[human-led-gate] DENIED: "${rel}" is outside the project directory.`);

  for (const p of SELF_PROTECT) {
    if (rel === p)
      deny(
        `[human-led-gate] DENIED: "${p}" is the gate itself. The agent may never modify its own ` +
          `approvals, hook, or settings. If the human wants a change here, the human makes it.`
      );
  }

  const approvalsPath = path.join(cwd, ".humanled", "approvals.json");
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(approvalsPath, "utf8"));
  } catch (e) {
    deny(
      `[human-led-gate] DENIED (fail-closed): cannot read .humanled/approvals.json (${e.code || e.message}). ` +
        `No approved scope can be verified.`
    );
  }

  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  for (const t of tasks) {
    if (t.approved !== true) continue;
    const forbidden = (t.forbidden || []).map(globToRe);
    const files = (t.files || []).map(globToRe);
    if (forbidden.some((re) => re.test(rel)))
      deny(`[human-led-gate] DENIED: "${rel}" is in the FORBIDDEN zone of task "${t.id}".`);
    if (files.some((re) => re.test(rel))) allow();
  }

  deny(GATE_MSG(rel));
}

main().catch((e) => {
  deny(`[human-led-gate] DENIED (fail-closed): gate error: ${e.message}`);
});
