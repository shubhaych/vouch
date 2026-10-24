// The Droid Detector Lab. When a trigger enqueues a lab_job, the worker runs
// one Droid SDK session that writes ONE candidate detector and tests it on a
// fresh simulated world it has never seen. Droid is fenced:
//   - cwd is a throwaway copy of detectors/ made for this job
//   - Create/Edit only under candidates/<jobId>/
//   - Execute only `npx tsx eval.ts --candidate candidates/<jobId>` and `npx tsx test.ts candidates/<jobId>`
//   - MCP only our vouch-lab server (read-only tools + submit_candidate, which cannot promote)
//   - WebSearch and FetchUrl disabled; everything else is cancelled
// Every plan line, tool call, diff and score becomes a lab_event row on /lab.
// A person (the controller) promotes or rejects.
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { DbConnection } from '../module_bindings/index';
import type { LabJob } from '../module_bindings/types';
import { REPO_ROOT, config, log } from './env';
import { call } from './stdb';

const run = promisify(execFile);
const LAB_ROOT = resolve(REPO_ROOT, 'worker/.lab');
const RECORDINGS = resolve(REPO_ROOT, 'worker/fixtures/lab');
const JOB_LIMIT_MS = 10 * 60_000;

// ---------------------------------------------------------------- the fence

export type Outcome = 'allow' | 'cancel';
export interface ToolDetails { type: string; filePath?: string; fullCommand?: string; command?: string; serverName?: string; toolName?: string; files?: { filePath: string }[] }

/** Exact commands Droid may run, for this job only. */
export const allowedCommands = (jobId: number) => [
  new RegExp(`^npx tsx eval\\.ts --candidate candidates/${jobId}( --json)?( --seed \\d+)?( --agents \\d+)?$`),
  new RegExp(`^npx tsx test\\.ts candidates/${jobId}$`),
];

/** The permission handler's decision for one tool use. Pure, so it is unit tested (T4.2). */
export function decideTool(jobId: number, jobDetectorsDir: string, d: ToolDetails): { outcome: Outcome; why: string } {
  const candidateDir = resolve(jobDetectorsDir, 'candidates', String(jobId));
  const inside = (p: string | undefined) => {
    if (!p) return false;
    const abs = resolve(jobDetectorsDir, p);
    const rel = relative(candidateDir, abs);
    return !rel.startsWith('..') && !rel.startsWith(sep) && !rel.includes(`..${sep}`) && abs.startsWith(candidateDir + sep);
  };
  switch (d.type) {
    case 'create':
    case 'edit':
      return inside(d.filePath) ? { outcome: 'allow', why: `write inside candidates/${jobId}/` } : { outcome: 'cancel', why: `write outside candidates/${jobId}/: ${d.filePath}` };
    case 'apply_patch': {
      const files = d.files?.length ? d.files.map((f) => f.filePath) : [d.filePath];
      return files.every(inside) ? { outcome: 'allow', why: 'patch inside the candidate folder' } : { outcome: 'cancel', why: 'patch touches files outside the candidate folder' };
    }
    case 'exec': {
      const cmd = (d.fullCommand ?? d.command ?? '').trim().replace(/\s+/g, ' ');
      return allowedCommands(jobId).some((re) => re.test(cmd)) ? { outcome: 'allow', why: `allowed command: ${cmd}` } : { outcome: 'cancel', why: `command not on the list: ${cmd}` };
    }
    case 'mcp_tool':
      return d.serverName === 'vouch-lab' ? { outcome: 'allow', why: `vouch-lab tool ${d.toolName}` } : { outcome: 'cancel', why: `MCP server ${d.serverName ?? '?'} is not allowed` };
    default:
      return { outcome: 'cancel', why: `${d.type} is not allowed in the lab` };
  }
}

export const DISABLED_TOOLS = ['WebSearch', 'FetchUrl'];

// ---------------------------------------------------------------- job workspace

function prepareWorkspace(jobId: number): { root: string; detectors: string; candidate: string } {
  const root = resolve(LAB_ROOT, String(jobId));
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const detectors = resolve(root, 'detectors');
  cpSync(resolve(REPO_ROOT, 'detectors'), detectors, { recursive: true, filter: (src) => !src.includes(`${sep}candidates${sep}`) && !src.includes(`${sep}results`) });
  // The evaluator imports the simulation engine at ../module; Droid may read it, never write it (the fence above).
  symlinkSync(resolve(REPO_ROOT, 'module'), resolve(root, 'module'), 'dir');
  const candidate = resolve(detectors, 'candidates', String(jobId));
  mkdirSync(candidate, { recursive: true });
  return { root, detectors, candidate };
}

/** Fixes import paths and bumps the version when a candidate becomes a live detector. */
export function toLiveSource(src: string, version: number): string {
  return src.replaceAll("'../../types'", "'../types'").replaceAll("'../../lib'", "'../lib'").replaceAll('"../../types"', '"../types"').replaceAll('"../../lib"', '"../lib"')
    .replace(/version:\s*\d+/, `version: ${version}`);
}

async function unifiedDiff(a: string, b: string): Promise<string> {
  try {
    await run('git', ['diff', '--no-index', '--no-color', a, b]);
    return '';
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '');
  }
}

interface Recording { goal: string; detectorId: string; events: { kind: string; text: string; json: string; delayMs: number }[]; summary: string; scoresJson: string; candidate: string }

// ---------------------------------------------------------------- the runner

export class LabRunner {
  private busy = false;
  private queue: number[] = [];

  constructor(private conn: DbConnection) {}

  start() {
    const on = (j: LabJob) => {
      if (j.status === 'queued' && !this.queue.includes(j.id)) { this.queue.push(j.id); void this.pump(); }
      if (j.status === 'promote_requested') void this.promote(j);
    };
    this.conn.db.labJob.onInsert((_c, j) => on(j));
    this.conn.db.labJob.onUpdate((_c, _o, j) => on(j));
    for (const j of this.conn.db.labJob.iter()) on(j);
    log(`lab ready (${this.droidAvailable() ? 'Droid available' : 'no FACTORY_API_KEY: queued jobs replay a recording if one exists, otherwise fail with a note'})`);
  }

  droidAvailable(): boolean {
    return !!config.factoryKey;
  }

  private async pump() {
    if (this.busy) return;
    const id = this.queue.shift();
    if (id === undefined) return;
    this.busy = true;
    try {
      const j = this.conn.db.labJob.id.find(id);
      if (j && j.status === 'queued') await this.runJob(j);
    } catch (e) {
      log(`lab job ${id} crashed: ${(e as Error).message}`);
      await call('finishLabJob', this.conn.reducers.finishLabJob({ jobId: id, status: 'failed', summary: `Worker error: ${(e as Error).message}`, scoresJson: '', candidateDir: '' }));
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  private event(jobId: number, kind: string, text: string, json: unknown = '') {
    return call('appendLabEvent', this.conn.reducers.appendLabEvent({ jobId, kind, text: text.slice(0, 4000), json: typeof json === 'string' ? json : JSON.stringify(json) }));
  }

  private recordingFor(detectorId: string): Recording | null {
    if (!existsSync(RECORDINGS)) return null;
    const files = readdirSync(RECORDINGS).filter((f) => f.endsWith('.json')).sort().reverse();
    for (const f of files) {
      const r = JSON.parse(readFileSync(resolve(RECORDINGS, f), 'utf8')) as Recording;
      if (r.detectorId === detectorId) return r;
    }
    return files[0] ? (JSON.parse(readFileSync(resolve(RECORDINGS, files[0]), 'utf8')) as Recording) : null;
  }

  async runJob(j: LabJob) {
    if (!this.droidAvailable()) {
      const rec = this.recordingFor(j.detectorId);
      if (!rec) {
        await call('startLabJob', this.conn.reducers.startLabJob({ jobId: j.id, mode: 'replay' }));
        await this.event(j.id, 'log', 'Droid is not available on this machine (no FACTORY_API_KEY / droid CLI) and no recorded job exists to replay. UNVERIFIED-LIVE: run the worker on the laptop with FACTORY_API_KEY set.');
        await call('finishLabJob', this.conn.reducers.finishLabJob({ jobId: j.id, status: 'failed', summary: 'Droid unavailable here; nothing was run.', scoresJson: '', candidateDir: '' }));
        return;
      }
      return this.replay(j, rec);
    }
    return this.runLive(j);
  }

  /** Replays a recorded real job's events at their original pace, labelled Replay on /lab. */
  private async replay(j: LabJob, rec: Recording) {
    await call('startLabJob', this.conn.reducers.startLabJob({ jobId: j.id, mode: 'replay' }));
    await this.event(j.id, 'log', `Replay of a recorded Droid job (goal: "${rec.goal}"). Droid is not running on this machine.`);
    for (const e of rec.events) {
      await new Promise((r) => setTimeout(r, Math.min(e.delayMs, 4000)));
      await this.event(j.id, e.kind, e.text, e.json);
    }
    const dir = resolve(REPO_ROOT, 'detectors/candidates', String(j.id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'detector.ts'), rec.candidate);
    await call('finishLabJob', this.conn.reducers.finishLabJob({ jobId: j.id, status: 'succeeded', summary: rec.summary, scoresJson: rec.scoresJson, candidateDir: `detectors/candidates/${j.id}` }));
  }

  private async runLive(j: LabJob) {
    const sdk = await import('@factory/droid-sdk/node');
    const { z } = await import('zod');
    const ws = prepareWorkspace(j.id);
    const recorded: Recording['events'] = [];
    let last = Date.now();
    const emit = async (kind: string, text: string, json: unknown = '') => {
      recorded.push({ kind, text, json: typeof json === 'string' ? json : JSON.stringify(json), delayMs: Date.now() - last });
      last = Date.now();
      await this.event(j.id, kind, text, json);
    };
    await call('startLabJob', this.conn.reducers.startLabJob({ jobId: j.id, mode: 'live' }));
    await emit('log', `Workspace: a fresh copy of detectors/ for job ${j.id}. Droid may write only candidates/${j.id}/ and run two commands.`);

    const db = this.conn.db;
    const labServer = sdk.createSdkMcpServer({
      name: 'vouch-lab',
      tools: [
        sdk.tool('get_detector', 'Read-only source of a live detector', { id: z.string() }, ({ id }: { id: string }) => {
          const f = resolve(REPO_ROOT, 'detectors/live', `${id.replace(/[^a-z_]/g, '')}.ts`);
          return existsSync(f) ? readFileSync(f, 'utf8') : `no live detector named ${id}`;
        }, { annotations: { readOnlyHint: true } }),
        sdk.tool('get_recent_patterns', 'Features and review statuses of recent patterns from a detector (no ground truth)', { detectorId: z.string() }, ({ detectorId }: { detectorId: string }) =>
          JSON.stringify([...db.fraudPattern.iter()].filter((p) => p.detectorId === detectorId).slice(-15).map((p) => ({
            id: `FR-${p.id}`, version: p.detectorVersion, status: p.status, agents: p.agentIds.length, features: JSON.parse(p.features) as unknown, analyst: p.narrative.slice(0, 300),
          }))), { annotations: { readOnlyHint: true } }),
        sdk.tool('submit_candidate', 'Record the candidate and a summary for a person to review (cannot promote)', { dir: z.string(), summary: z.string() }, ({ summary }: { dir: string; summary: string }) => {
          void emit('verdict', summary.slice(0, 3000));
          return 'Recorded. A person will promote or reject it.';
        }),
      ],
    });

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), JOB_LIMIT_MS);
    const session = await sdk.createSession({
      cwd: ws.detectors,
      autonomyLevel: sdk.AutonomyLevel.Off,
      mcpServers: [labServer],
      disabledToolIds: DISABLED_TOOLS,
      abortSignal: abort.signal,
      permissionHandler: async ({ toolUses, options }: { toolUses: { details: ToolDetails }[]; options: { value: unknown }[] }) => {
        const decisions = toolUses.map((t) => decideTool(j.id, ws.detectors, t.details));
        const ok = decisions.every((d) => d.outcome === 'allow');
        for (const d of decisions) void emit('tool_call', `${d.outcome === 'allow' ? 'allowed' : 'CANCELLED'}: ${d.why}`, { outcome: d.outcome });
        const want = ok ? sdk.ToolConfirmationOutcome.ProceedOnce : sdk.ToolConfirmationOutcome.Cancel;
        return (options.find((o) => o.value === want)?.value ?? sdk.ToolConfirmationOutcome.Cancel) as never;
      },
    });
    let planned = false;
    try {
      const prompt = [
        `Job ${j.id}. Trigger: ${j.trigger}. Goal: ${j.goal}`,
        `Detector to improve: ${j.detectorId}. Follow LAB.md exactly. Write the candidate in candidates/${j.id}/detector.ts (it imports from '../../types' and '../../lib').`,
        `Start by writing your plan as 3 to 6 bullet lines that begin with "- ".`,
      ].join('\n');
      for await (const m of session.stream(prompt)) {
        const msg = m as { type: string; text?: string; name?: string; input?: unknown; toolName?: string; content?: unknown; isError?: boolean; success?: boolean; error?: { message?: string } };
        if (msg.type === 'assistant' && msg.text?.trim()) {
          if (!planned && /^\s*- /m.test(msg.text)) { planned = true; await emit('plan', msg.text); }
          else await emit('log', msg.text);
        } else if (msg.type === 'tool_call') {
          await emit('tool_call', `${msg.name}`, msg.input ?? {});
        } else if (msg.type === 'tool_result') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          await emit('tool_result', `${msg.toolName}${msg.isError ? ' (error)' : ''}`, { output: content.slice(0, 8000), isError: !!msg.isError });
        } else if (msg.type === 'error') {
          await emit('log', `Droid error: ${msg.text ?? JSON.stringify(msg)}`);
        } else if (msg.type === 'result') {
          await emit('log', msg.success ? 'Droid finished the turn.' : `Droid stopped: ${msg.error?.message ?? 'not successful'}`);
        }
      }
    } finally {
      clearTimeout(timer);
      await session.close().catch(() => undefined);
    }
    await this.finishJob(j, ws, recorded);
  }

  /** Our own evaluation of whatever Droid wrote: never trust numbers we did not measure. */
  private async finishJob(j: LabJob, ws: { detectors: string; candidate: string }, recorded: Recording['events']) {
    const file = resolve(ws.candidate, 'detector.ts');
    if (!existsSync(file)) {
      await this.event(j.id, 'log', 'No candidate was written.');
      await call('finishLabJob', this.conn.reducers.finishLabJob({ jobId: j.id, status: 'failed', summary: 'No candidate was written.', scoresJson: '', candidateDir: '' }));
      return;
    }
    const live = resolve(REPO_ROOT, 'detectors/live', `${j.detectorId}.ts`);
    const diff = await unifiedDiff(live, file);
    await this.event(j.id, 'diff', `candidates/${j.id}/detector.ts vs live/${j.detectorId}.ts`, { diff: diff.slice(0, 50_000) });
    let scoresJson = '';
    let summary = '';
    try {
      const test = await run('npx', ['tsx', 'test.ts', `candidates/${j.id}`], { cwd: ws.detectors, timeout: 120_000 }).then((r) => ({ ok: true, out: r.stdout }), (e: { stdout?: string }) => ({ ok: false, out: e.stdout ?? '' }));
      await this.event(j.id, 'tool_result', `worker ran test.ts: ${test.ok ? 'passed' : 'FAILED'}`, { output: test.out.slice(-4000), isError: !test.ok });
      const seed = String(Math.floor(Math.random() * 1e9));
      const { stdout } = await run('npx', ['tsx', 'eval.ts', '--candidate', `candidates/${j.id}`, '--json', '--seed', seed], { cwd: ws.detectors, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
      const line = stdout.trim().split('\n').pop()!;
      scoresJson = line;
      const parsed = JSON.parse(line) as { scores: { version: number; targetRecall: number; honestFlagged: number; precision: number }[] };
      const [base, cand] = parsed.scores.length === 2 ? parsed.scores : [undefined, parsed.scores[0]];
      await this.event(j.id, 'metrics', `Fresh world seed ${seed}: candidate v${cand?.version} vs live v${base?.version ?? '-'}`, line);
      summary = base && cand
        ? `Target recall ${(base.targetRecall * 100).toFixed(1)}% → ${(cand.targetRecall * 100).toFixed(1)}%, honest agents flagged ${base.honestFlagged} → ${cand.honestFlagged}, precision ${(base.precision * 100).toFixed(1)}% → ${(cand.precision * 100).toFixed(1)}% (measured by the worker on a fresh world).`
        : 'Measured by the worker on a fresh world.';
      if (!test.ok) summary = `Tests failed. ${summary}`;
    } catch (e) {
      summary = `The candidate could not be evaluated: ${(e as Error).message.slice(0, 300)}`;
    }
    const keep = resolve(REPO_ROOT, 'detectors/candidates', String(j.id));
    mkdirSync(keep, { recursive: true });
    cpSync(file, resolve(keep, 'detector.ts'));
    // Keep the run as a recording so a later demo can replay a real job, labelled Replay.
    mkdirSync(RECORDINGS, { recursive: true });
    writeFileSync(resolve(RECORDINGS, `job-${j.id}.json`), JSON.stringify({ goal: j.goal, detectorId: j.detectorId, events: recorded, summary, scoresJson, candidate: readFileSync(file, 'utf8') } satisfies Recording, null, 2));
    await call('finishLabJob', this.conn.reducers.finishLabJob({ jobId: j.id, status: scoresJson ? 'succeeded' : 'failed', summary, scoresJson, candidateDir: `detectors/candidates/${j.id}` }));
  }

  /** The controller asked to promote: copy into detectors/live with a version bump, test it, record the outcome. */
  private async promote(j: LabJob) {
    const src = resolve(REPO_ROOT, 'detectors/candidates', String(j.id), 'detector.ts');
    const live = resolve(REPO_ROOT, 'detectors/live', `${j.detectorId}.ts`);
    if (!existsSync(src)) {
      await call('markPromoted', this.conn.reducers.markPromoted({ jobId: j.id, version: 0, ok: false, note: 'candidate file is missing' }));
      return;
    }
    const current = existsSync(live) ? Number(readFileSync(live, 'utf8').match(/version:\s*(\d+)/)?.[1] ?? 1) : 0;
    const version = current + 1;
    const backup = existsSync(live) ? readFileSync(live, 'utf8') : null;
    writeFileSync(live, toLiveSource(readFileSync(src, 'utf8'), version));
    const test = await run('npx', ['tsx', 'test.ts'], { cwd: resolve(REPO_ROOT, 'detectors'), timeout: 120_000 }).then(() => true, () => false);
    if (!test) {
      if (backup !== null) writeFileSync(live, backup);
      await call('markPromoted', this.conn.reducers.markPromoted({ jobId: j.id, version, ok: false, note: 'live tests failed after promotion; the previous version was restored' }));
      return;
    }
    await call('markPromoted', this.conn.reducers.markPromoted({ jobId: j.id, version, ok: true, note: `detectors/live/${j.detectorId}.ts is now v${version}; the next detector run uses it.` }));
    log(`promoted job ${j.id}: ${j.detectorId} v${version}`);
  }
}
