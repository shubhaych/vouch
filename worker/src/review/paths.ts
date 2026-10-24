// Where a case lives and what counts as "inside" it. Every path Droid may
// touch is checked against these helpers, so they are small and unit tested
// together with the fence.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { config } from '../env';

export const caseDir = (claimId: bigint | number) => resolve(config.casesDir, String(claimId));

/** True when `p` (relative to `root` or absolute) stays inside `root`/`sub` without climbing out. */
export function inside(root: string, sub: string, p: string | undefined): boolean {
  if (!p) return false;
  const base = resolve(root, sub);
  const abs = resolve(root, p);
  const rel = relative(base, abs);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !abs.includes(`${sep}..${sep}`);
}

/** Relative path of an absolute file inside the case folder, or null when it is outside. */
export function relCase(root: string, p: string): string | null {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) return null;
  return rel.split(sep).join('/');
}

export const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const sha256Text = (s: string) => createHash('sha256').update(s).digest('hex');

export const jobIdFor = (claimId: bigint, attempt: number) => claimId * 100n + BigInt(attempt);
export const rowId = (jobId: bigint, n: number) => jobId * 1000n + BigInt(n);

export const hms = (t: number) => {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
};
