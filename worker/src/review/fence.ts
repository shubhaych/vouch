// The permission fence for the three review sessions. Droid's cwd is the case
// folder (cases/<claimId>/); the permission handler calls decideCaseTool for
// every tool use and cancels anything this file does not allow. Pure, so it is
// unit tested (worker/test/review-fence.test.ts).
//
//   Case Analyst   writes work/            runs python3|node scripts in work/ or ../../tools/, ffmpeg/ffprobe writing to work/
//   Proof Builder  writes proof/           runs ffmpeg/ffprobe writing to proof/
//   Report Auditor writes work/audit_*     runs python3 work/audit_test.py (and the tools), ffprobe
//
// With autonomy off the session has no file-write tool (and with autonomy low
// writes skip the permission handler), so files are written through the shell:
// `cat > work/x.py <<'EOF' … EOF`, `echo … > work/note.txt`, and inline code
// runs as `python3 - <<'PY' … PY`. A heredoc needs a quoted tag so the shell
// never expands its body. Otherwise no pipes, chaining, substitutions or
// redirects (one `> work/file` is fine); absolute paths only inside the case.
//
// All three may only use the vouch-case MCP server (with a per-role tool list)
// and never the web.
//
// Droid batches tool calls in a Script. The harness lists the calls it found in
// the script, each with the confirmation details it would have asked for
// directly; the script is allowed only when every one of them is.
import { relative, resolve, sep } from 'node:path';

export type Role = 'analyst' | 'proof' | 'auditor';
export type Outcome = 'allow' | 'cancel';
export interface ToolDetails {
  type: string; filePath?: string; fullCommand?: string; command?: string; serverName?: string; toolName?: string; files?: { filePath: string }[];
  /** type 'script': the tool calls the harness found in the script. */
  calls?: ScriptCall[];
}
export interface ScriptCall { toolName: string; toolInput?: Record<string, unknown>; confirmation?: ToolDetails }

export const MCP_SERVER = 'vouch-case';
/** The web is never needed, and a subagent would run outside this fence. */
export const DISABLED_TOOLS = ['WebSearch', 'FetchUrl', 'Task'];
/** Built-in tools that only look; a script made of these never reaches the fence, but the list is judged the same way when it does. */
const READ_ONLY_TOOLS = new Set(['Read', 'LS', 'Glob', 'Grep', 'TodoWrite', 'ToolSearch']);
export const WRITE_DIR: Record<Role, string> = { analyst: 'work', proof: 'proof', auditor: 'work' };
export const MCP_TOOLS: Record<Role, string[]> = {
  analyst: ['get_case', 'get_policy', 'get_customer_summary', 'vision_label', 'add_artifact', 'add_finding', 'recommend_refund', 'set_live_note', 'list_findings', 'list_artifacts'],
  proof: ['get_case', 'list_findings', 'list_artifacts', 'add_artifact', 'set_live_note'],
  auditor: ['get_case', 'list_findings', 'list_artifacts', 'audit_finding', 'set_live_note'],
};
const BINARIES = ['python3', 'python', 'node', 'ffmpeg', 'ffprobe'];
/** The session has no file-write tool, so files are written through the shell: these need a redirect into the role's folder. */
const WRITERS = ['cat', 'echo', 'printf'];
const TOOLS_PREFIX = '../../tools/';

/** True when `p` (relative to the case folder, or absolute) is inside cases/<id>/<sub>/ and does not climb out. */
export function insideCase(caseDir: string, sub: string, p: string | undefined): boolean {
  if (!p) return false;
  const base = resolve(caseDir, sub);
  const abs = resolve(caseDir, p);
  const rel = relative(base, abs);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !p.includes('/../') && !p.startsWith('../');
}

/** The auditor may create its test and its result, nothing else; findings are changed only through audit_finding. */
const auditorFile = (p: string) => /^(\.\/)?work\/audit[\w.-]*\.(py|json|txt|md)$/.test(p) || /[\\/]work[\\/]audit[\w.-]*\.(py|json|txt|md)$/.test(p);

/** Tokens, honouring single and double quotes (ffmpeg filter graphs need them). Returns null on an unbalanced quote. */
export function tokens(cmd: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  let had = false;
  for (const ch of cmd) {
    if (q) {
      if (ch === q) q = null; else cur += ch;
    } else if (ch === "'" || ch === '"') { q = ch; had = true; }
    else if (/\s/.test(ch)) { if (cur || had) { out.push(cur); cur = ''; had = false; } }
    else cur += ch;
  }
  if (q) return null;
  if (cur || had) out.push(cur);
  return out;
}

const META = /[;&|`$<(){}\n\\]|>>/;
const looksLikePath = (t: string) => t.includes('/') || /\.(mp4|wav|jpg|jpeg|png|json|txt|py|mjs|js|md|log|csv)$/i.test(t);
// A here-document with a quoted tag: the body is data for stdin and the shell never expands it.
const HEREDOC = /^([^\n]*?)\s*<<-?\s*(['"])([A-Za-z_]\w*)\2[ \t]*\n([\s\S]*?)\n\3[ \t]*$/;

/** Absolute paths that stay inside the case (or point at the shared tools) become relative, so one rule covers both spellings. */
export function relativise(caseDir: string, t: string): string {
  const base = resolve(caseDir);
  const tools = resolve(base, '../../tools');
  if (t.startsWith(base + '/')) return t.slice(base.length + 1);
  if (t.startsWith(tools + '/')) return TOOLS_PREFIX + t.slice(tools.length + 1);
  return t;
}

/** The exec rule. Returns why it is allowed or refused. */
export function checkCommand(role: Role, raw: string, caseDir = '/case'): { outcome: Outcome; why: string } {
  const write = WRITE_DIR[role];
  const canWrite = (p: string) => insideCase(caseDir, write, p) && (role !== 'auditor' || auditorFile(p));
  let cmd = raw.trim();
  // The body of a quoted heredoc is stdin for the command (a file's content or an inline program); only the first line is a command.
  let stdin = false;
  if (cmd.includes('<<')) {
    const h = cmd.match(HEREDOC);
    if (!h) return { outcome: 'cancel', why: `a heredoc needs a quoted tag (<<'EOF') and the tag alone on the last line: ${raw.slice(0, 80)}` };
    if (h[4]!.split('\n').some((l) => l.trim() === h[3])) return { outcome: 'cancel', why: 'the heredoc body repeats its own tag' };
    cmd = h[1]!.trim();
    stdin = true;
  }
  cmd = cmd.replace(/\s+/g, ' ');
  // `2>&1` is harmless; strip it before the metacharacter check so the rest is judged on its own.
  cmd = cmd.replace(/\s2>&1\b/g, '');
  // One redirect of stdout into the role's folder is fine.
  let redirect: string | null = null;
  const m = cmd.match(/\s>\s*(\S+)/);
  if (m) { redirect = relativise(caseDir, m[1]!); cmd = `${cmd.slice(0, m.index)} ${cmd.slice(m.index! + m[0].length)}`.trim(); }
  if (META.test(cmd) || cmd.includes('>')) return { outcome: 'cancel', why: `shell metacharacters are not allowed: ${raw.split('\n')[0]}` };
  if (redirect && !canWrite(redirect)) return { outcome: 'cancel', why: `output may only go to ${write}/${role === 'auditor' ? 'audit_*' : ''}: ${redirect}` };
  const toks0 = tokens(cmd);
  if (!toks0 || toks0.length === 0) return { outcome: 'cancel', why: `could not parse: ${raw.split('\n')[0]}` };
  const bin = toks0[0]!;
  const toks = [bin, ...toks0.slice(1).map((t) => relativise(caseDir, t))];
  if (!BINARIES.includes(bin) && !WRITERS.includes(bin) && bin !== 'mkdir') return { outcome: 'cancel', why: `${bin} is not on the list (python3, node, ffmpeg, ffprobe, cat/echo/printf > ${write}/, mkdir -p ${write}/)` };
  for (const t of toks.slice(1)) {
    if (t.startsWith('/') || t.startsWith('~')) return { outcome: 'cancel', why: `absolute paths outside the case are not allowed: ${t}` };
    if (t.includes('..') && !t.startsWith(TOOLS_PREFIX)) return { outcome: 'cancel', why: `paths may not climb out of the case: ${t}` };
    if (t.startsWith(TOOLS_PREFIX) && (!/\.py$/.test(t) || t.slice(TOOLS_PREFIX.length).includes('..'))) return { outcome: 'cancel', why: `only tools/*.py may be run: ${t}` };
  }
  if (WRITERS.includes(bin)) {
    if (!redirect) return { outcome: 'cancel', why: `${bin} is only for writing a file into ${write}/ (add > ${write}/<name>)` };
    return { outcome: 'allow', why: `${bin} → ${redirect}` };
  }
  if (bin === 'mkdir') {
    const dirs = toks.slice(1).filter((t) => t !== '-p');
    if (!dirs.length || !dirs.every((d) => d === write || insideCase(caseDir, write, d))) return { outcome: 'cancel', why: `mkdir may only create folders inside ${write}/` };
    return { outcome: 'allow', why: `mkdir ${dirs.join(' ')}` };
  }
  if (bin === 'python3' || bin === 'python' || bin === 'node') {
    const script = toks[1];
    if (!script) return { outcome: 'cancel', why: `${bin} needs a script file or a heredoc program (no REPL, no -c)` };
    if (stdin) {
      if (script !== '-') return { outcome: 'cancel', why: `with a heredoc, ${bin} must read the program from stdin: ${bin} - <<'PY'` };
      return { outcome: 'allow', why: `${bin} (inline program)` };
    }
    const ownScript = insideCase(caseDir, write, script) && /\.(py|mjs|js)$/.test(script) && (role !== 'auditor' || auditorFile(script) || script.startsWith(TOOLS_PREFIX));
    const toolScript = script.startsWith(TOOLS_PREFIX) && /\.py$/.test(script) && bin !== 'node';
    if (!ownScript && !toolScript) return { outcome: 'cancel', why: `${bin} may only run ${write}/*.py|mjs or ../../tools/*.py, not ${script}` };
    return { outcome: 'allow', why: `${bin} ${script}` };
  }
  if (stdin) return { outcome: 'cancel', why: `${bin} does not take a heredoc` };
  if (bin === 'ffmpeg') {
    const out = toks[toks.length - 1]!;
    if (toks.length < 3 || !looksLikePath(out) || out.startsWith('-')) return { outcome: 'cancel', why: 'ffmpeg needs an output file as its last argument' };
    if (!insideCase(caseDir, write, out)) return { outcome: 'cancel', why: `ffmpeg may only write to ${write}/: ${out}` };
    return { outcome: 'allow', why: `ffmpeg → ${out}` };
  }
  return { outcome: 'allow', why: 'ffprobe (read-only)' };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** What a call inside a script would have asked for on its own; built from the tool name and input when the harness gives no details. */
export function nestedDetails(c: ScriptCall): ToolDetails {
  if (c.confirmation?.type) return c.confirmation;
  const i = c.toolInput ?? {};
  if (c.toolName === 'Create') return { type: 'create', filePath: str(i.file_path ?? i.filePath) };
  if (c.toolName === 'Edit' || c.toolName === 'MultiEdit') return { type: 'edit', filePath: str(i.file_path ?? i.filePath) };
  if (c.toolName === 'ApplyPatch') return { type: 'apply_patch', filePath: str(i.file_path ?? i.filePath) };
  if (c.toolName === 'Execute') return { type: 'exec', command: str(i.command) };
  const mcp = c.toolName.match(/^(.+?)___(.+)$/) ?? c.toolName.match(/^(\w+)\.(\w+)$/);
  if (mcp) return { type: 'mcp_tool', serverName: mcp[1]!.replace(/_/g, '-'), toolName: mcp[2]! };
  return { type: c.toolName.toLowerCase() };
}

function judgeNested(role: Role, caseDir: string, c: ScriptCall): { outcome: Outcome; why: string } {
  if (READ_ONLY_TOOLS.has(c.toolName)) return { outcome: 'allow', why: `${c.toolName} (read-only)` };
  const d = nestedDetails(c);
  if (d.type === 'script') return { outcome: 'cancel', why: 'a script inside a script' };
  return decideCaseTool(role, caseDir, d);
}

/** The permission handler's decision for one tool use. */
export function decideCaseTool(role: Role, caseDir: string, d: ToolDetails): { outcome: Outcome; why: string } {
  const write = WRITE_DIR[role];
  const fileOk = (p: string | undefined) => !!p && insideCase(caseDir, write, p) && (role !== 'auditor' || auditorFile(p));
  switch (d.type) {
    case 'script': {
      const calls = d.calls ?? [];
      const verdicts = calls.map((c) => judgeNested(role, caseDir, c));
      const bad = verdicts.find((v) => v.outcome === 'cancel');
      if (bad) return { outcome: 'cancel', why: `script: ${bad.why}` };
      return { outcome: 'allow', why: `script with ${calls.length} call${calls.length === 1 ? '' : 's'}: ${verdicts.map((v) => v.why).join('; ') || 'nothing to confirm'}` };
    }
    case 'create':
    case 'edit':
      return fileOk(d.filePath) ? { outcome: 'allow', why: `write inside ${write}/` } : { outcome: 'cancel', why: `write outside ${write}/${role === 'auditor' ? 'audit_*' : ''}: ${d.filePath ?? '?'}` };
    case 'apply_patch': {
      const files = d.files?.length ? d.files.map((f) => f.filePath) : [d.filePath];
      return files.every(fileOk) ? { outcome: 'allow', why: `patch inside ${write}/` } : { outcome: 'cancel', why: `patch touches files outside ${write}/` };
    }
    case 'exec':
      return checkCommand(role, d.fullCommand ?? d.command ?? '', caseDir);
    case 'mcp_tool': {
      const name = (d.toolName ?? '').replace(/^.*__/, '');
      if ((d.serverName ?? '').replace(/_/g, '-') !== MCP_SERVER) return { outcome: 'cancel', why: `MCP server ${d.serverName ?? '?'} is not allowed` };
      return MCP_TOOLS[role].includes(name) ? { outcome: 'allow', why: `${MCP_SERVER} ${name}` } : { outcome: 'cancel', why: `${name} is not a ${role} tool` };
    }
    default:
      return { outcome: 'cancel', why: `${d.type} is not allowed in a review session` };
  }
}
