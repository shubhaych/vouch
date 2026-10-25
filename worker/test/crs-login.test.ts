import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { IdentityScreening } from '../module_bindings/types';
import { config } from '../src/env';
import { rejectedLogin, sandboxScreening, screen } from '../src/crs';
import { keepScreening } from '../src/identity';

// Repeated failed CRS logins disable the sandbox account, and only CRS can re-enable it.
// A rejected login must therefore not be retried, not even by a restarted worker.
const saved = { ...config.crs, keysDir: config.keysDir };
const dir = mkdtempSync(resolve(tmpdir(), 'vouch-crs-'));
config.keysDir = dir;
Object.assign(config.crs, { mode: 'sandbox', username: 'u', password: 'p#1' });
afterEach(() => vi.unstubAllGlobals());
afterAll(() => { Object.assign(config.crs, saved); config.keysDir = saved.keysDir; rmSync(dir, { recursive: true, force: true }); });

describe('a rejected CRS login', () => {
  it('is tried once, remembered, and never retried for the same credentials', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'CRS113', message: 'Access Denied' }), { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const persona = { email: 'e', firstName: 'F', lastName: 'L', ssn: 's', dob: 'd', street1: 'x', city: 'c', state: 'S', zip: 'z' };
    // sandboxScreening reads the persona file; give it one for P01 only.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(dir, 'crs-personas.json'), JSON.stringify({ P01: persona }));
    const first = await sandboxScreening('P01');
    expect(first.errors.join(' ')).toMatch(/CRS113/);
    expect(rejectedLogin()).toMatch(/401.*CRS113/);
    const logins = fetch.mock.calls.filter(([url]) => String(url).endsWith('/users/login')).length;
    expect(logins).toBe(1);
    // A later screening (or a restarted worker, which reads the same file) does not log in again; it uses the labelled fixture.
    const later = await screen('P01');
    expect(later.source).toBe('fixture');
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/users/login')).length).toBe(1);
  });

  it('is forgotten when the credentials change', () => {
    config.crs.password = 'new';
    expect(rejectedLogin()).toBeNull();
    config.crs.password = 'p#1';
  });
});

describe('a stored screening', () => {
  const row = (over: Partial<IdentityScreening>) => ({ failed: false, source: 'fixture', ...over }) as IdentityScreening;
  it('is kept unless it failed or a usable sandbox can replace a fixture', () => {
    expect(keepScreening(undefined, false)).toBe(false);
    expect(keepScreening(row({ failed: true }), false)).toBe(false);
    expect(keepScreening(row({}), false)).toBe(true);
    expect(keepScreening(row({}), true)).toBe(false);
    expect(keepScreening(row({ source: 'sandbox' }), true)).toBe(true);
    expect(keepScreening(row({ source: 'sandbox' }), false)).toBe(true);
  });
});
