// T0.6 (human-run on the laptop with FACTORY_API_KEY and the droid CLI):
// streams one message from a Droid SDK session, read-only, in a temp folder.
//   npx tsx scripts/hello-droid.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutonomyLevel, DroidMessageType, ToolConfirmationOutcome, createSession } from '@factory/droid-sdk/node';
import { loadEnv } from './_env';

loadEnv(); // FACTORY_API_KEY usually lives in the root .env; the droid CLI it spawns inherits it

if (!process.env.FACTORY_API_KEY) { console.error('FACTORY_API_KEY is not set (UNVERIFIED-LIVE: run this on the worker laptop)'); process.exit(2); }
const cwd = mkdtempSync(join(tmpdir(), 'vouch-droid-hello-'));
const session = await createSession({ cwd, autonomyLevel: AutonomyLevel.Off, disabledToolIds: ['WebSearch', 'FetchUrl'], permissionHandler: () => ToolConfirmationOutcome.Cancel });
try {
  for await (const m of session.stream('Reply with one short sentence: what is a fraud detector? Do not use any tools.')) {
    if (m.type === DroidMessageType.Assistant) process.stdout.write(m.text);
    if (m.type === DroidMessageType.Result) console.log(`\n[result] success=${m.success}`);
  }
} finally {
  await session.close();
}
