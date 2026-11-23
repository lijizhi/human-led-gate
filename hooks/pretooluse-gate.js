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
  ".humanled/approvals.log",
  ".humanled/denials.log",
  ".claude/hooks/pretooluse-gate.js",
  ".claude/settings.json",
  ".claude/settings.local.json",
];

/**
 * Append-only denial log: `.humanled/denials.log`, one JSON object per line.
 *
 * Why it exists: a deny on its own tells the human nothing about *how often* an
 * agent tries to step outside its scope, or which files it keeps reaching for.
 * A blocked attempt is the interesting signal — an agent that stops after one
 * deny and an agent that probes five different paths look identical without it.
 *
 * It lives inside `.humanled/`, which the gate protects, so an agent cannot
 * erase its own trail through Edit, and `permissions.deny` covers the shell
 * forms that name the path.
 *
 * Logging is best-effort and NEVER changes the decision: if the write fails
 * (read-only checkout, no .humanled/, full disk), the deny still happens. A
 * logging failure must not turn into an allow, and must not turn a deny into a
 * crash.
 */
let logPath = null;

function writeDenialLog(entry) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    /* best effort — never let logging change the verdict */
  }
}

function setLogTarget(cwd) {
  try {
    logPath = path.join(cwd, ".humanled", "denials.log");
  } catch {
    logPath = null;
  }
}

/** Reasons are machine-readable so the log can be aggregated, not just read. */
function deny(reason, meta) {
  writeDenialLog({
    ts: new Date().toISOString(),
    tool: (meta && meta.tool) || null,
    target: (meta && meta.target) || null,
    task: (meta && meta.task) || null,
    verdict: (meta && meta.verdict) || "deny",
    // Truncated: a bash command can be long, and the human needs the shape,
    // not a full payload that might carry a secret.
    detail: reason.split("\n")[0].slice(0, 300),
  });
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

/**
 * glob -> RegExp: supports **, *, ? (no braces).
 *
 * Case handling: on Windows and macOS the filesystem is case-insensitive, so
 * `SRC/SHARED/x.ts` and `src/shared/x.ts` are the same file. A case-sensitive
 * match here is fail-OPEN: a forbidden rule written in different case silently
 * stops protecting. Match case-insensitively on those platforms; keep it
 * case-sensitive on Linux, where the two paths really are different files.
 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

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
  return new RegExp("^" + re + "$", CASE_INSENSITIVE_FS ? "i" : "");
}

/**
 * Best-effort guard for the rm/mv/redirection side door: a shell command that
 * names a protected path in a write position.
 *
 * THIS IS NOT ISOLATION. It is a string matcher over a shell command it cannot
 * parse: `cd .humanled && rm approvals.json`, `F=...; rm $F`, `find -delete`,
 * `cp`, `git checkout --`, or any interpreter (`python -c`, `node -e`) all get
 * through. Treat it as one more speed bump on the casual path, nothing more.
 * Real protection for the gate files is a sandbox-level deny rule
 * (`permissions.deny` on `.humanled/**` and `.claude/hooks/**`), which the
 * installer and the plugin wiring now both write. See docs/verify.md.
 *
 * READS MUST PASS. An earlier version denied any command whose text contained a
 * protected path, which blocked `ls .humanled`, `cat approvals.json` and
 * `grep` on the skill files — normal read-only investigation. A gate that
 * punishes looking is a gate people turn off. Destructive verbs and redirection
 * are matched; a bare `ls`/`cat`/`grep` is not.
 *
 * Case: the paths are matched case-insensitively, because on Windows/macOS
 * `.HUMANLED/APPROVALS.JSON` is the same file as `.humanled/approvals.json`.
 */
function bashGuard(command) {
  const norm = command.replace(/\\/g, "/");

  // Read-only programs: `ls`, `cat`, `grep`, `head`, `tail`, `stat`, `find`
  // without -delete/-exec, `git status|diff|log|show`. If the protected path only
  // appears as an argument to these, it is investigation, not a write.
  const readOnlyPrograms =
    /^(ls|ls\s|cat|less|more|head|tail|wc|stat|file|grep|rg|find\s|git\s+(status|diff|log|show|ls-files)\b|node\s+-e\s+.?fs\.readFileSync)/i;

  // Split on shell separators so `ls .humanled && rm .humanled/x` still catches
  // the second half instead of the read-only prefix shielding the whole line.
  const segments = norm.split(/;|&&|\|\||\n/).map((s) => s.trim()).filter(Boolean);
  const candidates = segments.length ? segments : [norm];

  // Redirects are evaluated across the whole command: `cat x > .humanled/y`.
  const redirectTarget = />{1,2}\s*[^&\s]*(\.humanled|\.claude\/hooks|\.claude\/settings\.json)/i;
  if (redirectTarget.test(norm)) return true;

  const prot = SELF_PROTECT.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  prot.push("\\.humanled(?:/\"|/[^\\s\"']*)?", "\\.claude/hooks(?:/[^\\s\"']*)?");
  const protectedPath = new RegExp(`(${prot.join("|")})`, "i");

  const destructiveVerbs =
    /(?:^|[|&;]\s*|\s)(?:rm|del|erase|mv|move|ren|rename|truncate|cp|sed\s+-i|tee|dd|chmod|chown|ln|touch|mkdir|rmdir)\b/i;

  for (const seg of candidates) {
    if (!protectedPath.test(seg)) continue;
    // A path in a read-only invocation is fine; anything else that names it is
    // treated as a potential write.
    if (readOnlyPrograms.test(seg)) continue;
    if (destructiveVerbs.test(seg)) return true;
    // `find ... -delete` / `-exec rm`
    if (/find\b/i.test(seg) && /\s-(delete|exec|execdir|ok)\b/i.test(seg)) return true;
    // An interpreter one-liner that names the path: assume it writes.
    if (/\b(node|python|python3|perl|ruby|php|sh|bash)\b[^|]*\b(-e|-c|--eval)\b/i.test(seg)) return true;
  }
  return false;
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

  const cwd = input.cwd || process.cwd();
  setLogTarget(cwd);

  const tool = input.tool_name || "";
  if (tool === "Bash") {
    const cmd = (input.tool_input && input.tool_input.command) || "";
    if (bashGuard(cmd))
      deny(
        "[human-led-gate] DENIED: shell command targets a protected gate path (approvals/hook/settings). " +
          "The agent may never modify the gate through a side door. The human edits these files directly.",
        { tool, target: cmd.slice(0, 200), verdict: "deny-shell" }
      );
    allow();
  }
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) allow();

  let target =
    (input.tool_input && input.tool_input.notebook_path) ||
    (input.tool_input && input.tool_input.file_path) ||
    (input.tool_input && input.tool_input.path) ||
    "";
  if (!target) deny("[human-led-gate] DENIED (fail-closed): no file path in tool input.");

  target = path.resolve(cwd, target);
  let rel = path.relative(cwd, target).replace(/\\/g, "/");
  if (rel.startsWith(".."))
    deny(`[human-led-gate] DENIED: "${rel}" is outside the project directory.`, {
      tool,
      target: rel,
      verdict: "deny-outside",
    });

  for (const p of SELF_PROTECT) {
    if (rel === p)
      deny(
        `[human-led-gate] DENIED: "${p}" is the gate itself. The agent may never modify its own ` +
          `approvals, hook, or settings. If the human wants a change here, the human makes it.`,
        { tool, target: rel, verdict: "deny-self" }
      );
  }

  const approvalsPath = path.join(cwd, ".humanled", "approvals.json");
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(approvalsPath, "utf8"));
  } catch (e) {
    deny(
      `[human-led-gate] DENIED (fail-closed): cannot read .humanled/approvals.json (${e.code || e.message}). ` +
        `No approved scope can be verified.`,
      { tool, target: rel, verdict: "deny-failclosed" }
    );
  }

  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  for (const t of tasks) {
    if (t.approved !== true) continue;
    const forbidden = (t.forbidden || []).map(globToRe);
    const files = (t.files || []).map(globToRe);
    if (forbidden.some((re) => re.test(rel)))
      deny(`[human-led-gate] DENIED: "${rel}" is in the FORBIDDEN zone of task "${t.id}".`, {
        tool,
        target: rel,
        task: t.id,
        verdict: "deny-forbidden",
      });
    if (files.some((re) => re.test(rel))) allow();
  }

  deny(GATE_MSG(rel), { tool, target: rel, verdict: "deny-out-of-scope" });
}

main().catch((e) => {
  deny(`[human-led-gate] DENIED (fail-closed): gate error: ${e.message}`, {
    verdict: "deny-error",
  });
});
