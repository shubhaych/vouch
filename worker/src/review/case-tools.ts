// The vouch-case MCP server: the only door between a Droid session and the
// rest of Vouch. Each role gets its own tool list (fence.ts checks it again).
// Tools validate, write through CaseState (which calls reducers) and return
// short text Droid can act on. Nothing here can decide a claim.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SpokenClaim } from '@vouch/module/review-score';
import { config } from '../env';
import type { Role } from './fence';
import { MCP_TOOLS } from './fence';
import { relCase } from './paths';
import type { CaseState } from './state';
import { AssessmentDraftSchema, AssessmentFields, type AssessmentDraft } from './assessment';

type Sdk = typeof import('@factory/droid-sdk/node');
export type McpServer = ReturnType<Sdk['createSdkMcpServer']>;

export interface CaseContext {
  state: CaseState;
  caseMd: string;
  policy: Record<string, unknown>;
  customer: Record<string, unknown>;
  claims: SpokenClaim[];
  /** Customer-visible progress line for the current step. */
  liveNote: (text: string) => Promise<void>;
  /** Spends one nested Droid call; false when the hourly budget is gone. */
  visionAllowed: () => boolean;
}

const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function buildCaseServer(sdk: Sdk, role: Role, ctx: CaseContext): Promise<McpServer> {
  const { z } = await import('zod');
  const { state } = ctx;
  const ro = { annotations: { readOnlyHint: true } };
  const all = {
    get_case: sdk.tool('get_case', 'The case file (CASE.md): order, policy, spoken claims, integrity notes, the playbook', {}, () => ctx.caseMd, ro),
    get_policy: sdk.tool('get_policy', 'The business return policy as JSON', {}, () => JSON.stringify(ctx.policy), ro),
    get_customer_summary: sdk.tool('get_customer_summary', 'Counts and ratios about the account (never identity or location)', {}, () => JSON.stringify(ctx.customer), ro),
    list_artifacts: sdk.tool('list_artifacts', 'Artifacts registered so far: id, kind, path, tStart, tEnd, label, sha256 (hex of the file when it was registered)', {}, () =>
      JSON.stringify([...state.artifacts.values()].map((a) => ({ id: String(a.id), kind: a.kind, path: a.path, tStart: a.tStart, tEnd: a.tEnd, label: a.label, sha256: a.sha256 }))), ro),
    list_findings: sdk.tool('list_findings', 'Findings so far: id, kind, spokenClaimId, observation, tStart, tEnd, confidence, artifactIds, method, auditStatus', {}, () =>
      JSON.stringify([...state.findings.values()].map((f) => ({ ...f, id: String(f.id), artifactIds: f.artifactIds.map(String) }))), ro),
    vision_label: sdk.tool('vision_label', 'Ask a second model what is in an image (a frame, mosaic or crop inside the case) and get a short answer. Your own Read tool can also open images; use this for a second opinion.',
      { path: z.string().describe('relative path inside the case, e.g. mosaics/m_002.jpg'), question: z.string().max(400) },
      async ({ path, question }: { path: string; question: string }) => {
        const rel = relCase(state.dir, path);
        if (!rel || !/\.(jpg|jpeg|png)$/i.test(rel)) return 'vision_label: path must be a .jpg or .png inside the case';
        if (!ctx.visionAllowed() || !config.factoryKey) return 'vision_label is unavailable right now (budget); open the image with Read and describe it yourself.';
        try {
          const data = readFileSync(resolve(state.dir, rel)).toString('base64');
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 60_000);
          const r = await sdk.run(`Answer in at most 3 short sentences, describing only what is visible. Do not describe people. Question: ${question}`, {
            cwd: state.dir, autonomyLevel: sdk.AutonomyLevel.Off, autoRejectPermissionRequests: true, disabledToolIds: ['WebSearch', 'FetchUrl', 'Execute', 'Create', 'Edit', 'ApplyPatch', 'Task', 'Read'],
            images: [{ type: 'base64', data, mediaType: rel.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }], abortSignal: ctl.signal,
          }).finally(() => clearTimeout(timer));
          state.log(`vision_label ${rel}: ${short(r.text ?? '', 200)}`);
          return r.text?.trim() || 'no answer';
        } catch (e) {
          return `vision_label failed: ${(e as Error).message.slice(0, 160)}`;
        }
      }),
    add_artifact: sdk.tool('add_artifact', 'Register a file you wrote inside the case (work/ or proof/) so a finding can cite it. Returns the artifact id.',
      { path: z.string(), kind: z.enum(['frame', 'mosaic', 'crop', 'clip', 'measurement', 'chart', 'script', 'transcript', 'video']), tStart: z.number().min(0), tEnd: z.number().min(0), label: z.string().max(300) },
      async (a: { path: string; kind: string; tStart: number; tEnd: number; label: string }) => {
        try {
          const rec = await state.addArtifact({ path: a.path, kind: a.kind, tStart: a.tStart, tEnd: a.tEnd, label: a.label, sha256: '' });
          state.log(`add_artifact ${rec.id} ${rec.kind} ${rec.path} [${rec.tStart}-${rec.tEnd}] ${rec.label}`);
          return `artifact ${rec.id} registered (${rec.kind} ${rec.path})`;
        } catch (e) { return `add_artifact refused: ${(e as Error).message}`; }
      }),
    add_finding: sdk.tool('add_finding', 'Record one finding about one spoken claim (or one integrity finding). It must cite artifact ids you registered and a time window in the video.',
      {
        kind: z.enum(['supports', 'contradicts', 'neutral', 'integrity']), spokenClaimId: z.string().describe('c1, c2… or for integrity: challenge:passed | challenge:failed | challenge:unclear | recapture | splice | other'),
        observation: z.string().min(10).max(1200).describe('what the footage shows, in plain words, never about the person'), tStart: z.number().min(0), tEnd: z.number().min(0),
        confidence: z.number().min(0).max(1), artifactIds: z.array(z.string()).min(1), method: z.string().max(120).describe('looked | probe:luminance | probe:audio | probe:motion | ocr | vision_label | …'),
      },
      async (f: { kind: string; spokenClaimId: string; observation: string; tStart: number; tEnd: number; confidence: number; artifactIds: string[]; method: string }) => {
        try {
          if (f.kind !== 'integrity' && !ctx.claims.some((c) => c.id === f.spokenClaimId)) return `add_finding refused: spokenClaimId must be one of ${ctx.claims.map((c) => c.id).join(', ')} (or kind integrity)`;
          if (f.kind !== 'integrity' && [...state.findings.values()].some((x) => x.spokenClaimId === f.spokenClaimId && x.kind !== 'integrity')) return `add_finding refused: ${f.spokenClaimId} already has a finding (exactly one per claim)`;
          const ids = f.artifactIds.map((s) => { try { return BigInt(s.replace(/\D/g, '')); } catch { return -1n; } });
          const rec = await state.addFinding({ kind: f.kind, spokenClaimId: f.spokenClaimId, observation: f.observation, tStart: f.tStart, tEnd: f.tEnd, confidence: f.confidence, artifactIds: ids, method: f.method });
          state.log(`add_finding ${rec.id} ${rec.kind} ${rec.spokenClaimId} [${rec.tStart}-${rec.tEnd}] conf ${rec.confidence} via ${rec.method}: ${short(rec.observation, 200)}`);
          return `finding ${rec.id} recorded`;
        } catch (e) { return `add_finding refused: ${(e as Error).message}`; }
      }),
    set_live_note: sdk.tool('set_live_note', 'One short progress line the customer sees on their phone right now (what you are checking, not what you found). Call it before each step.',
      { text: z.string().min(3).max(140) },
      async ({ text }: { text: string }) => { await ctx.liveNote(text); state.log(`live note: ${text}`); return 'shown'; }),
    recommend_refund: sdk.tool('recommend_refund', 'Analyst only: propose accept (full/partial), decline, or more_evidence with an amount in cents, cited evidence for/against, and analysis of EVERY customer statement. This is a recommendation, never a payment or denial. Cite finding IDs, not artifact IDs. Missing evidence is specific, not a default.',
      AssessmentFields, async (input: AssessmentDraft) => {
        const draft = AssessmentDraftSchema.parse(input);
        const ids = [...draft.forRefund, ...draft.againstRefund].map((x) => x.findingId).concat(draft.statements.flatMap((s) => s.findingIds));
        if (ids.some((id) => !state.findings.has(BigInt(id)))) return 'recommend_refund refused: cite only IDs from list_findings.';
        const known = ctx.claims.map((c) => c.id);
        const stray = draft.statements.filter((s) => !known.includes(s.claimId)).map((s) => s.claimId);
        if (stray.length) return `recommend_refund refused: statements use claimId ${known.join(', ')} only (not ${stray.join(', ')}); cover the written reason inside the matching claim's analysis.`;
        if (ctx.claims.some((c) => draft.statements.filter((s) => s.claimId === c.id).length !== 1)) return 'recommend_refund refused: analyse each claim exactly once.';
        state.assessment = draft;
        state.log(`Factory recommendation: ${draft.action}, ${draft.amountCents} cents (pending audit)`);
        return 'Recommendation recorded, pending the independent audit and human/automatic-payment checks.';
      }),
    audit_finding: sdk.tool('audit_finding', 'Auditor only: pass or reject one finding with a reason. A rejected finding is excluded from the score.',
      { id: z.string(), status: z.enum(['passed', 'rejected']), note: z.string().max(600) },
      async ({ id, status, note }: { id: string; status: 'passed' | 'rejected'; note: string }) => {
        try { await state.audit(BigInt(id.replace(/\D/g, '')), status, note); state.log(`audit_finding ${id} ${status}: ${note}`); return `finding ${id} ${status}`; }
        catch (e) { return `audit_finding refused: ${(e as Error).message}`; }
      }),
  };
  const tools = MCP_TOOLS[role].map((name) => all[name as keyof typeof all]).filter(Boolean);
  return sdk.createSdkMcpServer({ name: 'vouch-case', version: '1.0.0', tools });
}
