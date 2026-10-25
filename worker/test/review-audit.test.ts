import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSON_JUDGEMENT, auditFindings } from '../src/review/audit';
import { sha256File } from '../src/review/paths';
import type { ArtifactRec, FindingRec } from '../src/review/state';
import type { SpokenClaim } from '@vouch/module/review-score';

// R3/R4: a finding only counts when its artifacts exist unchanged, its window is inside the
// video, a proof clip covers it, it is the only finding for its claim, and it describes the
// footage rather than the person. Planted bad findings must be rejected.
const DUR = 30;
const claims: SpokenClaim[] = [{ id: 'c1', text: 'the lamp does not turn on', kind: 'functional', tSaid: 10 }, { id: 'c2', text: 'the base is scratched', kind: 'defect', tSaid: 20 }];

function caseDir() {
  const dir = mkdtempSync(resolve(tmpdir(), 'vouch-audit-'));
  mkdirSync(resolve(dir, 'frames'));
  mkdirSync(resolve(dir, 'proof'));
  mkdirSync(resolve(dir, 'work'));
  return dir;
}

function file(dir: string, rel: string, body: string) {
  writeFileSync(resolve(dir, rel), body);
  return sha256File(resolve(dir, rel));
}

function art(dir: string, id: number, kind: string, path: string, tStart: number, tEnd: number, body = path): ArtifactRec {
  return { id: BigInt(id), kind, path, url: '', tStart, tEnd, label: path, sha256: file(dir, path, body) };
}

const finding = (id: number, over: Partial<FindingRec>): FindingRec => ({
  id: BigInt(id), kind: 'supports', spokenClaimId: 'c1', observation: 'The lamp stays dark while the switch is pressed between 00:10 and 00:13.', tStart: 10, tEnd: 13, confidence: 0.8,
  artifactIds: [1n, 2n], method: 'probe:luminance', auditStatus: 'pending', auditNote: '', ...over,
});

function good() {
  const dir = caseDir();
  const artifacts = new Map<bigint, ArtifactRec>();
  artifacts.set(1n, art(dir, 1, 'frame', 'frames/u_0021.jpg', 10, 10));
  artifacts.set(2n, art(dir, 2, 'clip', 'proof/clip_1.mp4', 9, 14));
  artifacts.set(3n, art(dir, 3, 'measurement', 'work/luma.json', 0, DUR));
  return { dir, artifacts };
}

describe('deterministic audit', () => {
  it('passes a finding with intact artifacts, a window inside the video and a covering clip', () => {
    const { dir, artifacts } = good();
    const [v] = auditFindings(dir, [finding(1, { artifactIds: [1n, 2n, 3n] })], artifacts, DUR, claims);
    expect(v?.status).toBe('passed');
  });
  it('rejects a finding whose artifact is missing or was changed after registration', () => {
    const { dir, artifacts } = good();
    artifacts.set(4n, { ...artifacts.get(1n)!, id: 4n, path: 'frames/nope.jpg' });
    expect(auditFindings(dir, [finding(1, { artifactIds: [4n, 2n] })], artifacts, DUR, claims)[0]?.note).toMatch(/missing/);
    writeFileSync(resolve(dir, 'frames/u_0021.jpg'), 'tampered');
    expect(auditFindings(dir, [finding(1)], artifacts, DUR, claims)[0]?.note).toMatch(/changed after/);
  });
  it('rejects wording that judges the person', () => {
    const { dir, artifacts } = good();
    const [v] = auditFindings(dir, [finding(1, { observation: 'The customer is clearly lying about the lamp.' })], artifacts, DUR, claims);
    expect(v?.status).toBe('rejected');
    expect(v?.note).toMatch(/judges the person/);
    expect(PERSON_JUDGEMENT.test('the lamp does not light up')).toBe(false);
  });
  it('rejects a window past the end of the video and a frame that does not overlap the window', () => {
    const { dir, artifacts } = good();
    expect(auditFindings(dir, [finding(1, { tStart: 28, tEnd: 35 })], artifacts, DUR, claims)[0]?.note).toMatch(/past the end/);
    expect(auditFindings(dir, [finding(1, { tStart: 20, tEnd: 22, artifactIds: [1n, 2n] })], artifacts, DUR, claims)[0]?.note).toMatch(/overlaps/);
  });
  it('allows exactly one non-integrity finding per claim and requires a known claim id', () => {
    const { dir, artifacts } = good();
    const out = auditFindings(dir, [finding(1), finding(2, { kind: 'contradicts' }), finding(3, { spokenClaimId: 'c9' })], artifacts, DUR, claims);
    expect(out.map((v) => v.status)).toEqual(['passed', 'rejected', 'rejected']);
    expect(out[1]?.note).toMatch(/second finding/);
    expect(out[2]?.note).toMatch(/not one of the spoken claims/);
  });
  it('requires a proof clip that covers the window; integrity findings need no claim id', () => {
    const { dir, artifacts } = good();
    expect(auditFindings(dir, [finding(1, { artifactIds: [1n] })], artifacts, DUR, claims)[0]?.note).toMatch(/no proof clip/);
    artifacts.set(5n, art(dir, 5, 'frame', 'frames/last.jpg', 29.5, 30));
    artifacts.set(6n, art(dir, 6, 'clip', 'proof/clip_7.mp4', 28, 30));
    const [v] = auditFindings(dir, [finding(7, { kind: 'integrity', spokenClaimId: 'challenge:passed', tStart: 29.5, tEnd: 30, artifactIds: [5n, 6n], observation: 'Three fingers are held up in the last frame.' })], artifacts, DUR, claims);
    expect(v?.status).toBe('passed');
  });
});
