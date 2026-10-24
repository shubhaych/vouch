// Guards the hard rules from AGENTS.md that are cheap to check mechanically.
// Run via `npm run check`. Add a rule here when a mistake would be embarrassing.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NAV, CONSOLE_TABS, SHOPPER_TABS } from "../web/lib/routes";

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "module_bindings"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|css|md)$/.test(name)) yield p;
  }
}

// 1. The word "scam" never appears in the UI. We do not accuse people or brands.
for (const dir of ["web/app", "web/components", "web/lib"]) {
  for (const f of files(dir)) if (/scam/i.test(readFileSync(f, "utf8"))) fail(`${f}: the word "scam" must not appear in the UI`);
}

// 2. Secrets stay server-side: web/ never touches capi_ keys or sponsor keys.
const SECRET = /capi_|CREAO_[A-Z_]*(KEY|APP_ID)|CRS_API_KEY|NESSIE_API_KEY|STDB_TOKEN/;
for (const f of files("web")) {
  if (f.endsWith("next.config.ts")) continue;
  if (SECRET.test(readFileSync(f, "utf8"))) fail(`${f}: secret-looking name in web/ (keys belong in the worker)`);
}

// 3. Every nav/tab link has a page.
for (const { href } of [...NAV, ...CONSOLE_TABS, ...SHOPPER_TABS]) {
  const page = join("web/app", href === "/" ? "" : href, "page.tsx");
  if (!existsSync(page)) fail(`${href} is in lib/routes.ts but ${page} does not exist`);
}

// 4. Dropped surfaces are not built.
for (const gone of ["web/app/sellers", "web/app/lab"]) if (existsSync(gone)) fail(`${gone} must not exist (dropped in guide v4)`);

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("check-rules: ok");
