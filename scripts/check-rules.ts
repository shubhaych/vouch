// Guards the hard rules that are cheap to check mechanically. Run via `npm run check`.
// Add a rule here when a mistake would be embarrassing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NAV } from '../web/lib/routes';

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

function* files(dir: string, exts = /\.(tsx?|css|md|mjs)$/): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'module_bindings', 'dist'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p, exts);
    else if (exts.test(name)) yield p;
  }
}

// 1. The word "scam" never appears in the UI: describe evidence, never accuse.
for (const f of files('web/app')) if (/\bscam/i.test(readFileSync(f, 'utf8'))) fail(`${f}: the word "scam" must not appear in the UI`);
for (const f of files('web/components')) if (/\bscam/i.test(readFileSync(f, 'utf8'))) fail(`${f}: the word "scam" must not appear in the UI`);

// 2. Keys stay server-side: nothing secret-looking in web/ or a client bundle.
const SECRET = /capi_[A-Za-z0-9]|cr_sk_[A-Za-z0-9]|FACTORY_API_KEY|CREAO_API_KEY|CREAO_CAPI_KEY|MEDIA_SIGNING_SECRET|DEMO_(BUSINESS|CONTROLLER)_CODE|STDB_(WORKER_)?TOKEN|ISSUER_KEYS|privateKey|BEGIN PRIVATE KEY/;
for (const f of files('web', /\.(tsx?|mjs|js|json|css|md)$/)) {
  if (f.endsWith('package.json')) continue;
  if (SECRET.test(readFileSync(f, 'utf8'))) fail(`${f}: secret-looking name in web/ (keys belong in the worker)`);
}
if (existsSync('web/.next/static')) for (const f of files('web/.next/static', /\.js$/)) if (/capi_[A-Za-z0-9]{8}|cr_sk_[A-Za-z0-9]{8}/.test(readFileSync(f, 'utf8'))) fail(`${f}: a key ended up in a client bundle`);

// 3. Never commit secrets: .env, worker identity tokens, issuer keys, media.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
for (const t of tracked) if (/^\.env$|^\.env\.(?!example)|worker\/\.keys\/|worker\/media\/|truth-day/.test(t)) fail(`${t} is tracked by git and must not be`);

// 4. Every nav link has a page.
for (const { href } of NAV) {
  const page = join('web/app', href === '/' ? '' : href, 'page.tsx');
  if (!existsSync(page)) fail(`${href} is in lib/routes.ts but ${page} does not exist`);
}

// 5. Private tables never reach client bindings: who is honest, what an agent plans to claim, who is which shopper.
const bindings = readFileSync('web/module_bindings/index.ts', 'utf8');
for (const t of ['agentTruth', 'refundIntent', 'shopperLink', 'seatCode', 'counter', 'simTick']) {
  if (new RegExp(`^\\s+${t}: __table`, 'm').test(bindings)) fail(`private table ${t} is subscribable from the browser`);
}

// 6. Vouch World says what it is.
if (!readFileSync('web/components/world/world-view.tsx', 'utf8').includes('Simulated agents. Vouch does not track real locations.')) fail('/world must show "Simulated agents. Vouch does not track real locations."');
if (!readFileSync('web/components/ui/footer.tsx', 'utf8').includes('No real shoppers are tracked.')) fail('the footer must say no real shoppers are tracked');

// 7. Determinism: the simulation never calls Math.random (replay and the evaluator depend on it).
for (const f of ['module/src/sim.ts', 'module/src/text.ts', 'module/src/world.ts', 'module/src/rng.ts']) if (/Math\.random\(/.test(readFileSync(f, "utf8"))) fail(`${f} calls Math.random`);

// 8. Detectors use behaviour only: the coordinated detector does not read region or business ids as features.
const coord = readFileSync('detectors/live/coordinated.ts', 'utf8');
if (/\.region\b/.test(coord)) fail('detectors/live/coordinated.ts reads region');

// 9. The fast policy engine never declines.
const sim = readFileSync('module/src/sim.ts', 'utf8');
const fast = sim.slice(sim.indexOf('function fastDecide'), sim.indexOf('function resolveMoreEvidence'));
if (/'declined'/.test(fast)) fail('the fast policy engine must never decline');

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check-rules: ok');
