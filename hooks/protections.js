/**
 * Protections: the rules that sit alongside the scope gate.
 *
 * The scope gate answers one question — "did a human approve writing here?" —
 * and that is deliberately narrow. These cover the other things an autonomous
 * coding agent gets wrong in ways that are cheap to check and expensive to miss:
 * secrets leaving the machine, destructive commands, force-pushes, credential
 * files being edited, and installs that run arbitrary code at install time.
 *
 * Design rules, learned the hard way in this repo:
 *
 *   1. A rule fires on a CONCRETE pattern, never on vibes. Every rule below has a
 *      test that shows the deny and a test that shows a nearby safe command
 *      passing. A protection that blocks `ls .humanled` costs more than it saves.
 *   2. Every deny carries the risk it maps to, so a user can decide whether to
 *      keep it. "Because policy" is not a reason.
 *   3. Nothing here is a capability sandbox. These are pattern matches on tool
 *      input. `docs/verify.md` says what they miss.
 *
 * Enable/disable per rule in `.humanled/approvals.json` under `"protections"`.
 * Default is ON for all: a protection you have to discover is one nobody has.
 */

/** Secret material that must not be printed, echoed, or shipped to a URL. */
const SECRET_PATTERNS = [
  // Anthropic first: `sk-ant-` also matches the generic `sk-` rule below, and
  // reporting a vendor key as the wrong vendor is the kind of small lie that
  // makes the whole message untrustworthy.
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/, label: "Anthropic API key (sk-ant-…)" },
  { re: /\bsk-(?!ant-)[A-Za-z0-9_-]{16,}\b/, label: "OPENAI-style API key (sk-…)" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, label: "GitHub token (ghp_/gho_/ghu_/ghs_/ghr_)" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, label: "GitHub fine-grained token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: "Google API key" },
  { re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, label: "private key block" },
];

/** Paths that hold credentials. Editing these through the agent is how secrets leak into diffs. */
const CREDENTIAL_PATHS = [
  /(^|\/)\.env(\.(local|development|production|test))?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)secrets?\.(json|ya?ml|toml)$/i,
];

/** Commands that destroy work irreversibly. */
const DESTRUCTIVE = [
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME|[A-Za-z]:[\\/])(\s|$)/, label: "rm -rf on a root or home path" },
  { re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+\.git(\/|\s|$)/, label: "removing .git" },
  { re: /\bgit\s+push\b[^|;&]*(\s--force\b(?!-with-lease)|\s-f\b)/, label: "force push" },
  { re: /\bgit\s+push\b[^|;&]*\s\+\S*:\S*/, label: "push that deletes a remote branch (refspec :branch)" },
  { re: /\bgit\s+reset\s+--hard\b/, label: "git reset --hard (discards uncommitted work)" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*[xfd]/, label: "git clean -xfd (deletes untracked files)" },
  { re: /\b(chmod|chown)\s+-R\s+777\b/, label: "recursive 777 / world-writable" },
  { re: /\bmkfs(\.\w+)?\b/, label: "format a filesystem" },
  { re: /\bdd\b[^|;&]*\bof=\/dev\//, label: "dd onto a device" },
];

/** Piping a remote script straight into a shell: arbitrary code, no review. */
const PIPE_TO_SHELL = [
  { re: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/, label: "curl | sh" },
  { re: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(python3?|node|perl|ruby)\b/, label: "curl | interpreter" },
];

/** Exfiltration: reading local data and sending it out in the same command. */
const EXFIL = [
  {
    re: /(curl|wget|nc|ncat|http)\b[^|;&]*(-d|--data|--data-binary|-F|--form|-T|--upload-file)\b[^|;&]*(@|<\s*)[^\s|;&]+/,
    label: "HTTP request that uploads a local file",
  },
  { re: /\b(base64|gzip|tar)\b[^|;&]*\|\s*(curl|wget|nc|ncat)\b/, label: "packing local data and piping it to the network" },
];

/** Install-time code execution: the package manager runs whatever the manifest says. */
const INSTALL_EXEC = [
  { re: /\bnpm\s+(i|install|ci)\b[^|;&]*--[^|;&]*\b(unsafe-perm|ignore-scripts=false)\b/, label: "npm install that re-enables install scripts" },
  { re: /\bnpm\s+(i|install|ci)\b[^|;&]*(?<!\S)--unsafe-perm(?:\s|$)/, label: "npm --unsafe-perm (scripts run as root)" },
];

function firstMatch(rules, text) {
  for (const rule of rules) if (rule.re.test(text)) return rule.label;
  return null;
}

/**
 * @param {{tool: string, toolInput: object, settings: object}} ctx
 * @returns {{verdict: string, reason: string} | null} null means "no objection"
 */
function checkProtections(ctx) {
  const settings = ctx.settings || {};
  const enabled = (name) => settings[name] !== false;
  const input = ctx.toolInput || {};
  const tool = ctx.tool || "";

  if (tool === "Bash" && typeof input.command === "string") {
    const cmd = input.command;

    if (enabled("secrets")) {
      const label = firstMatch(SECRET_PATTERNS, cmd);
      if (label) {
        return {
          verdict: "protect-secret",
          reason: `a value in this command looks like ${label}. Secrets do not belong in a shell command — they land in the transcript, the shell history and the denial log. Read it from the environment, or from a file the command does not print.`,
        };
      }
    }

    if (enabled("destructive")) {
      const label = firstMatch(DESTRUCTIVE, cmd);
      if (label) {
        return {
          verdict: "protect-destructive",
          reason: `this is ${label}. It cannot be undone by re-running the agent, and the human cannot review a deletion that already happened. Ask the human to run it, or narrow it to the specific path you intend to remove.`,
        };
      }
    }

    if (enabled("pipe-to-shell")) {
      const label = firstMatch(PIPE_TO_SHELL, cmd);
      if (label) {
        return {
          verdict: "protect-pipe-to-shell",
          reason: `this is ${label}: it runs code nobody read, fetched from a network the agent cannot verify. Download it, show the human the contents, then run the reviewed copy.`,
        };
      }
    }

    if (enabled("exfil")) {
      const label = firstMatch(EXFIL, cmd);
      if (label) {
        return {
          verdict: "protect-exfil",
          reason: `this is ${label}. Local data leaving the machine is not a code change and cannot be reviewed after the fact. State what you want to send and let the human do it.`,
        };
      }
    }

    if (enabled("install-exec")) {
      const label = firstMatch(INSTALL_EXEC, cmd);
      if (label) {
        return {
          verdict: "protect-install-exec",
          reason: `this is ${label}: package install scripts run with the agent's privileges and nobody reviews them. Install normally, and let the human decide about install scripts.`,
        };
      }
    }
  }

  if (enabled("credentials") && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const target = input.notebook_path || input.file_path || input.path || "";
    if (target) {
      const norm = target.replace(/\\/g, "/");
      const hit = CREDENTIAL_PATHS.find((re) => re.test(norm));
      if (hit) {
        return {
          verdict: "protect-credential-file",
          reason: `"${norm}" is a credential file. An agent editing it puts the secret in the diff, the transcript and the next review. The human edits credential files; the agent reads one only when the task needs it.`,
        };
      }
    }
  }

  return null;
}

module.exports = {
  checkProtections,
  SECRET_PATTERNS,
  CREDENTIAL_PATHS,
  DESTRUCTIVE,
  PIPE_TO_SHELL,
  EXFIL,
  INSTALL_EXEC,
};
