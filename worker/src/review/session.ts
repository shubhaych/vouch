// Runs one fenced Droid session and turns its stream into a
// DroidSessionSummary (plan, commands with exit codes and durations, files
// written) plus a droid.log the report links. The same runner serves the Case
// Analyst, the Proof Builder and the Report Auditor; only the role, the prompt
// and the MCP tool list differ.
import type { DroidSessionSummary } from '@vouch/module/review-types';
import { config, log } from '../env';
import { DISABLED_TOOLS, decideCaseTool, type Role, type ToolDetails } from './fence';
import type { McpServer } from './case-tools';
import type { CaseState } from './state';

type Sdk = typeof import('@factory/droid-sdk/node');

/** Sliding one-hour window over session starts. Nested vision calls count too. */
export class DroidBudget {
  private starts: number[] = [];
  constructor(private perHour: number) {}
  remaining(): number {
    const cutoff = Date.now() - 3_600_000;
    this.starts = this.starts.filter((t) => t > cutoff);
    return Math.max(0, this.perHour - this.starts.length);
  }
  take(): boolean {
    if (this.remaining() <= 0) return false;
    this.starts.push(Date.now());
    return true;
  }
}

export interface SessionSpec {
  sdk: Sdk;
  name: string;
  role: Role;
  state: CaseState;
  server: McpServer;
  system: string;
  prompt: string;
  limitMs: number;
  /** What the playbook still lacks (null when done). A turn that ends with work left gets a follow-up message in the same session, at most MAX_NUDGES times. */
  unfinished?: () => string | null;
}

export const MAX_NUDGES = 2;
/** Rules Droid most often trips over, repeated when the fence has refused something. */
export const FENCE_HINTS = "Write files with cat > work/<name> <<'EOF' … EOF (quoted tag), run inline code with python3 - <<'PY' … PY, use paths inside this folder, and never pipes, ';' or '&&'.";

const short = (v: unknown, n = 400) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function exitCodeOf(content: string, isError: boolean): number | null {
  const m = content.match(/exit(?:ed)?(?: with)?(?: code)?[:\s]+(-?\d+)/i) ?? content.match(/"exitCode"\s*:\s*(-?\d+)/);
  if (m) return Number(m[1]);
  return isError ? 1 : 0;
}

export async function runDroidSession(spec: SessionSpec): Promise<DroidSessionSummary> {
  const { sdk, state, role } = spec;
  const summary: DroidSessionSummary = { name: spec.name, plan: '', commands: [], filesWritten: [], mode: 'live' };
  const pending = new Map<string, { name: string; cmd?: string; t0: number }>();
  const refusals: string[] = [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), spec.limitMs);
  const t0 = Date.now();
  state.log(`=== ${spec.name} (${role}) session start; cwd ${state.dir}; limit ${Math.round(spec.limitMs / 1000)} s`);
  let session: Awaited<ReturnType<Sdk['createSession']>> | null = null;
  const turn = async (prompt: string) => {
    for await (const m of session!.stream(prompt)) {
      const msg = m as { type: string; text?: string; name?: string; toolUseId?: string; input?: Record<string, unknown>; toolName?: string; content?: unknown; isError?: boolean; success?: boolean; error?: { message?: string }; message?: string; durationMs?: number };
      if (msg.type === 'assistant' && msg.text?.trim()) {
        if (!summary.plan && /^\s*(?:[-*]|\d+\.)\s/m.test(msg.text)) summary.plan = msg.text.slice(0, 2000);
        state.log(`droid: ${msg.text.trim()}`);
      } else if (msg.type === 'tool_call') {
        const input = msg.input ?? {};
        const cmd = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : undefined;
        pending.set(msg.toolUseId ?? '', { name: msg.name ?? '?', cmd, t0: Date.now() });
        const file = (input.file_path ?? input.filePath ?? input.path) as string | undefined;
        if (/^(Create|Edit|ApplyPatch|Write)$/i.test(msg.name ?? '') && file && !summary.filesWritten.includes(file)) summary.filesWritten.push(file);
        // Files written through the shell (cat > work/x <<'EOF') count too.
        const shellFile = cmd?.match(/^(?:cat|echo|printf)\b[^\n]*?\s>\s*(\S+)/)?.[1];
        if (shellFile && !summary.filesWritten.includes(shellFile)) summary.filesWritten.push(shellFile);
        state.log(`→ ${msg.name} ${short(input, 600)}`);
      } else if (msg.type === 'tool_result') {
        const p = pending.get(msg.toolUseId ?? '');
        const ms = p ? Date.now() - p.t0 : 0;
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
        if (p?.cmd) summary.commands.push({ cmd: p.cmd.slice(0, 300), exitCode: exitCodeOf(content, !!msg.isError), ms });
        state.log(`← ${msg.toolName ?? p?.name ?? '?'}${msg.isError ? ' (error)' : ''} ${ms} ms: ${short(content, 800)}`);
        pending.delete(msg.toolUseId ?? '');
      } else if (msg.type === 'error') {
        state.log(`droid error: ${msg.message ?? msg.text ?? JSON.stringify(msg)}`);
        summary.note = `Droid error: ${msg.message ?? msg.text ?? 'unknown'}`.slice(0, 300);
      } else if (msg.type === 'result') {
        state.log(`=== result: ${msg.success ? 'ok' : 'not successful'} ${msg.durationMs ?? Date.now() - t0} ms${msg.error?.message ? `: ${msg.error.message}` : ''}`);
        if (!msg.success) summary.mode = 'failed';
        if (!msg.success && msg.error?.message) summary.note = msg.error.message.slice(0, 300);
      }
    }
  };
  try {
    session = await sdk.createSession({
      cwd: state.dir,
      autonomyLevel: sdk.AutonomyLevel.Off,
      systemPrompt: { type: 'preset', preset: 'droid', append: spec.system },
      mcpServers: [spec.server],
      disabledToolIds: DISABLED_TOOLS,
      disableBuiltinSkills: true,
      abortSignal: abort.signal,
      ...(config.review.model ? { modelId: config.review.model } : {}),
      permissionHandler: async ({ toolUses, options }: { toolUses: { details: ToolDetails }[]; options: { value: unknown }[] }) => {
        const decisions = toolUses.map((t) => decideCaseTool(role, state.dir, t.details));
        const ok = decisions.every((d) => d.outcome === 'allow');
        for (const d of decisions) {
          state.log(`fence ${d.outcome === 'allow' ? 'allowed' : 'CANCELLED'}: ${d.why}`);
          if (d.outcome === 'cancel') refusals.push(d.why.slice(0, 200));
        }
        const want = ok ? sdk.ToolConfirmationOutcome.ProceedOnce : sdk.ToolConfirmationOutcome.Cancel;
        return (options.find((o) => o.value === want)?.value ?? sdk.ToolConfirmationOutcome.Cancel) as never;
      },
    });
    await turn(spec.prompt);
    // Droid reads a fence cancel as "the user stopped me" and ends its turn. While work is left and time remains,
    // the same session is told what was refused and why, and asked to carry on.
    for (let nudge = 1; nudge <= MAX_NUDGES && summary.mode !== 'failed'; nudge++) {
      const missing = spec.unfinished?.();
      if (!missing || abort.signal.aborted || Date.now() - t0 > spec.limitMs - 45_000) break;
      const refused = refusals.splice(0);
      const text = [
        `Not finished: ${missing}.`,
        refused.length ? `The permission fence (not a person) refused ${refused.length} call${refused.length === 1 ? '' : 's'}: ${refused.slice(-4).join(' | ')}. ${FENCE_HINTS}` : '',
        'Continue the playbook from where you stopped; do not start over, do not stop until it is done.',
      ].filter(Boolean).join(' ');
      state.log(`=== nudge ${nudge}/${MAX_NUDGES}: ${text}`);
      await turn(text);
    }
  } catch (e) {
    const aborted = abort.signal.aborted;
    summary.mode = 'failed';
    summary.note = aborted ? `stopped at the ${Math.round(spec.limitMs / 60_000)}-minute limit` : (e as Error).message.slice(0, 300);
    state.log(`=== session failed: ${summary.note}`);
    log(`${spec.name} failed: ${summary.note}`);
  } finally {
    clearTimeout(timer);
    await session?.close().catch(() => undefined);
  }
  summary.filesWritten = summary.filesWritten.map((f) => f.replace(state.dir + '/', '')).slice(0, 60);
  state.log(`=== ${spec.name} done in ${Math.round((Date.now() - t0) / 1000)} s: ${summary.commands.length} commands, ${summary.filesWritten.length} files, mode ${summary.mode}`);
  return summary;
}
