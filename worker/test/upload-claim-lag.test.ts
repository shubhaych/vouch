import { describe, expect, it } from 'vitest';
import type { DbConnection } from '../module_bindings/index';
import { findClaim, UploadError } from '../src/video';

// The worker's replica of the claim table can trail SpacetimeDB by minutes under a busy simulation.
// An upload in that window used to be told "No such claim." although the claim existed.
function laggingConn(arriveAfterMs: number) {
  const row = { id: 5n, nonce: 'n' };
  const shownAt = Date.now() + arriveAfterMs;
  return { db: { claim: { id: { find: (id: bigint) => (id === 5n && Date.now() >= shownAt ? row : undefined) } } } } as unknown as DbConnection;
}

describe('an upload for a claim the worker has not seen yet', () => {
  it('waits for the replica when SpacetimeDB has the claim', async () => {
    const c = await findClaim(laggingConn(150), 5n, async () => true, 2_000, 10);
    expect(c?.id).toBe(5n);
  });

  it('keeps waiting past the short first wait when the database says the claim exists', async () => {
    let asked = 0;
    const c = await findClaim(laggingConn(3_300), 5n, async () => { asked++; return true; }, 5_000, 20);
    expect(c?.id).toBe(5n);
    expect(asked).toBe(1);
  });

  it('says no such claim only when SpacetimeDB does not have it', async () => {
    const e = await findClaim(laggingConn(60_000), 9n, async () => false, 100, 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UploadError);
    expect((e as UploadError).status).toBe(404);
  });

  it('asks the phone to retry, not "no such claim", when the replica never catches up', async () => {
    const e = await findClaim(laggingConn(60_000), 5n, async () => undefined, 100, 10).catch((x: unknown) => x);
    expect((e as UploadError).status).toBe(503);
    expect((e as UploadError).message).not.toMatch(/no such claim/i);
  });
});
