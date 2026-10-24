// The business report, as the worker writes it and the web reads it. Pure
// types (no zod here: the module package has no runtime dependencies); the
// worker's zod schema in worker/src/review/report.ts is typed against these.
import type { Anomaly, AuditStatus, FindingKind, SpokenClaim, Tier, VerifiedIdentity } from './review-score';

export const STEP_KEYS = ['ingest', 'transcript', 'frames', 'integrity', 'droid_case', 'proof', 'audit', 'score', 'review', 'decision'] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const STEP_LABEL: Record<StepKey, string> = {
  ingest: 'Received', transcript: 'Transcribed', frames: 'Frames sampled', integrity: 'Integrity checked', droid_case: 'Droid investigating',
  proof: 'Proof built', audit: 'Report audited', score: 'Scored', review: 'Reviewed by CREAO', decision: 'Decision',
};
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type ArtifactKind = 'frame' | 'mosaic' | 'crop' | 'clip' | 'transcript' | 'measurement' | 'chart' | 'script' | 'video' | 'audio' | 'log';

export interface ReportFinding {
  id: number;
  claimId?: string;
  kind: FindingKind;
  observation: string;
  tStart: number;
  tEnd: number;
  confidence: number;
  method: string;
  artifactIds: number[];
  auditStatus: AuditStatus;
  auditNote?: string;
}

export interface ReportArtifact { id: number; kind: ArtifactKind | string; path: string; url: string; tStart: number; tEnd: number; label: string; sha256: string }

export interface TimelineEntry { t: number; kind: 'claim' | 'supports' | 'contradicts' | 'integrity' | 'challenge'; label: string; findingId?: number }

export interface DroidSessionSummary {
  name: string;
  plan: string;
  commands: { cmd: string; exitCode: number | null; ms: number }[];
  filesWritten: string[];
  mode: 'live' | 'skipped' | 'failed' | 'replay';
  note?: string;
}

export interface Report {
  claimId: string;
  retailerId: string;
  generatedAt: string;
  formulaVersion: string;
  video: { durationS: number; resolution: string; audio: boolean; sha256: string; proofReelUrl: string };
  /** claimsFrom 'written' means nothing was transcribed: the claims are the written reason split up, and tSaid is only where to look. */
  claimSummary: { reasonCode: string; reasonText: string; claimsFrom: 'transcript' | 'written'; spokenClaims: SpokenClaim[] };
  findings: ReportFinding[];
  rejectedFindings: ReportFinding[];
  artifacts: ReportArtifact[];
  integrity: { score: number; flags: { kind: string; confidence: number; tStart?: number; tEnd?: number; artifactIds: number[]; note?: string }[] };
  timeline: TimelineEntry[];
  history: {
    tenureDays: number; orders: number; refunds365: number; smoothedRefundRate: number; categoryBaseline: number; excessRatio: number;
    anomaly: Anomaly; verifiedIdentity: VerifiedIdentity;
  };
  score: { eSupport: number; coverage: number; integrity: number; pLegit: number; logit: number; components: Record<string, number> };
  recommendation: {
    tier: Tier; refundNow: number; refundOnReturn: number; returnRequired: boolean; replacementOffered: boolean; evidenceRequested?: string[];
    reasons: { text: string; cites: string }[]; creditPreview: { base: string; delta: number } | null;
  };
  creaoReview?: { agrees: boolean; businessSummary: string; concerns: string[]; customerMessage: string; runId: string; provenance: 'live' | 'fixture' | 'offline' };
  method: { droidSessions: DroidSessionSummary[]; toolsUsed: string[]; ingestLog: string[]; lanesOnly: boolean };
  limits: string[];
}
