import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

/** Calls a Python script in the repo with JSON on stdin and JSON on stdout. */
export function runPython<T>(script: string, input: unknown, timeoutMs = 15_000): Promise<T> {
  return new Promise((ok, fail) => {
    const child = execFile('python3', [resolve(REPO_ROOT, script)], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return fail(err);
      try { ok(JSON.parse(stdout) as T); } catch (e) { fail(e); }
    });
    child.stdin?.end(JSON.stringify(input));
  });
}
