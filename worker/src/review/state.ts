// One object per review job: the artifacts and findings written so far, the
// id counters, the step writer and the droid.log appender. Droid's MCP tools,
// the worker's own lanes and the auditor all go through it, so every row that
// reaches SpacetimeDB has passed the same checks.
import { appendFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbConnection } from '../../module_bindings/index';
import type { StepKey } from '@vouch/module/review-types';
import { call } from '../stdb';
import { signPath } from '../video';
import type { NewArtifact } from './ingest';
import { relCase, rowId, sha256File } from './paths';

export interface ArtifactRec { id: bigint; kind: string; path: string; url: string; tStart: number; tEnd: number; label: string; sha256: string }
export interface FindingRec {
  id: bigint; kind: string; spokenClaimId: string; observation: string; tStart: number; tEnd: number; confidence: number; artifactIds: bigint[]; method: string; auditStatus: string; auditNote: string;
}

export const CASE_URL_TTL_MS = 14 * 24 * 60 * 60_000;
export const ARTIFACT_KINDS = ['frame', 'mosaic', 'crop', 'clip', 'transcript', 'measurement', 'chart', 'script', 'video', 'audio', 'log'];
export const FINDING_KINDS = ['supports', 'contradicts', 'neutral', 'integrity'];

/** A reducer resolves with nothing and rejects with the module's message; turn the rejection into an Error Droid can read. */
async function must(what: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    throw new Error(`the database refused ${what}: ${(e as Error).message}`);
  }
}

export class CaseState {
  readonly artifacts = new Map<bigint, ArtifactRec>();
  readonly findings = new Map<bigint, FindingRec>();
  private nArtifact = 0;
  private nFinding = 0;
  readonly logFile: string;

  constructor(readonly conn: DbConnection, readonly claimId: bigint, readonly jobId: bigint, readonly dir: string, public durationS: number) {
    this.logFile = resolve(dir, 'droid.log');
  }

  /** Appends one line to cases/<id>/droid.log (the report links it). */
  log(line: string) {
    appendFileSync(this.logFile, `${new Date().toISOString()} ${line.replace(/\n/g, '\n    ')}\n`);
  }

  /** Case files outlive the 2-hour media links: a business reads the report days later. */
  url(rel: string) {
    return signPath(`/cases/${this.claimId}/${rel}`, Date.now(), CASE_URL_TTL_MS);
  }

  async step(key: StepKey, status: '' | 'pending' | 'running' | 'done' | 'failed' | 'skipped', summary = '', liveNote = '') {
    await call('setStep', this.conn.reducers.setStep({ jobId: this.jobId, key, status, summary, liveNote }));
  }

  /** Registers a file inside the case as an artifact. Throws a plain Error with a message Droid can act on. */
  async addArtifact(a: NewArtifact): Promise<ArtifactRec> {
    const rel = relCase(this.dir, a.path);
    if (!rel) throw new Error(`path must stay inside the case folder: ${a.path}`);
    const abs = resolve(this.dir, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`no such file: ${rel} (write it first, then register it)`);
    if (!ARTIFACT_KINDS.includes(a.kind)) throw new Error(`kind must be one of ${ARTIFACT_KINDS.join(', ')}`);
    const tStart = Math.max(0, Number(a.tStart) || 0);
    const tEnd = Math.min(Math.max(tStart, Number(a.tEnd) || tStart), Math.max(this.durationS, tStart) + 0.5);
    const existing = [...this.artifacts.values()].find((x) => x.path === rel);
    const id = existing?.id ?? rowId(this.jobId, ++this.nArtifact);
    const rec: ArtifactRec = { id, kind: a.kind, path: rel, url: this.url(rel), tStart, tEnd, label: a.label.slice(0, 300), sha256: a.sha256 || sha256File(abs) };
    await must('the artifact', this.conn.reducers.addArtifact({ jobId: this.jobId, id, kind: rec.kind, path: rec.path, url: rec.url, tStart, tEnd, label: rec.label, sha256: rec.sha256 }));
    this.artifacts.set(id, rec);
    return rec;
  }

  async addFinding(f: Omit<FindingRec, 'id' | 'auditStatus' | 'auditNote'>): Promise<FindingRec> {
    if (!FINDING_KINDS.includes(f.kind)) throw new Error(`kind must be one of ${FINDING_KINDS.join(', ')}`);
    if (!f.observation.trim()) throw new Error('observation is required');
    if (!(f.confidence >= 0 && f.confidence <= 1)) throw new Error('confidence must be between 0 and 1');
    if (!(f.tStart >= 0 && f.tStart <= f.tEnd)) throw new Error('times must satisfy 0 <= tStart <= tEnd');
    if (f.tEnd > this.durationS + 0.5) throw new Error(`tEnd ${f.tEnd} is past the end of the video (${this.durationS.toFixed(1)} s)`);
    if (!f.artifactIds.length) throw new Error('cite at least one artifact id (add_artifact first)');
    for (const id of f.artifactIds) if (!this.artifacts.has(id)) throw new Error(`unknown artifact id ${id}; list_artifacts shows the ids`);
    const id = rowId(this.jobId, ++this.nFinding);
    const rec: FindingRec = { ...f, id, observation: f.observation.slice(0, 1200), method: f.method.slice(0, 120), auditStatus: 'pending', auditNote: '' };
    await must('the finding', this.conn.reducers.addFinding({ jobId: this.jobId, id, kind: rec.kind, spokenClaimId: rec.spokenClaimId, observation: rec.observation, tStart: rec.tStart, tEnd: rec.tEnd, confidence: rec.confidence, artifactIds: rec.artifactIds, method: rec.method }));
    this.findings.set(id, rec);
    return rec;
  }

  async audit(id: bigint, status: 'passed' | 'rejected', note: string) {
    const f = this.findings.get(id);
    if (!f) throw new Error(`unknown finding ${id}`);
    await must('the audit verdict', this.conn.reducers.auditFinding({ findingId: id, status, note: note.slice(0, 600) }));
    f.auditStatus = status;
    f.auditNote = note.slice(0, 600);
  }
}
