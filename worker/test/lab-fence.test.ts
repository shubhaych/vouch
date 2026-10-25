import { describe, expect, it } from 'vitest';
import { DISABLED_TOOLS, decideTool, toLiveSource } from '../src/lab';

// T4.2: the permission handler cancels a write outside candidates/<job>/, any other command, web tools.
const DIR = '/tmp/lab/7/detectors';
const allow = (d: Parameters<typeof decideTool>[2]) => decideTool(7, DIR, d).outcome;

describe('Droid lab fence', () => {
  it('allows writes only inside candidates/<jobId>/', () => {
    expect(allow({ type: 'create', filePath: `${DIR}/candidates/7/detector.ts` })).toBe('allow');
    expect(allow({ type: 'edit', filePath: 'candidates/7/detector.ts' })).toBe('allow');
    expect(allow({ type: 'create', filePath: `${DIR}/candidates/8/detector.ts` })).toBe('cancel');
    expect(allow({ type: 'edit', filePath: `${DIR}/live/coordinated.ts` })).toBe('cancel');
    expect(allow({ type: 'edit', filePath: `${DIR}/eval.ts` })).toBe('cancel');
    expect(allow({ type: 'create', filePath: `${DIR}/candidates/7/../../live/coordinated.ts` })).toBe('cancel');
    expect(allow({ type: 'create', filePath: '/home/user/vouch/module/src/sim.ts' })).toBe('cancel');
    expect(allow({ type: 'apply_patch', files: [{ filePath: `${DIR}/candidates/7/a.ts` }, { filePath: `${DIR}/types.ts` }] })).toBe('cancel');
  });

  it('allows exactly the two commands, for this job only', () => {
    expect(allow({ type: 'exec', fullCommand: 'npx tsx eval.ts --candidate candidates/7' })).toBe('allow');
    expect(allow({ type: 'exec', fullCommand: 'npx tsx eval.ts --candidate candidates/7 --json' })).toBe('allow');
    expect(allow({ type: 'exec', fullCommand: 'npx tsx test.ts candidates/7' })).toBe('allow');
    expect(allow({ type: 'exec', fullCommand: 'npx tsx test.ts candidates/8' })).toBe('cancel');
    expect(allow({ type: 'exec', fullCommand: 'npx tsx eval.ts --candidate candidates/7; rm -rf /' })).toBe('cancel');
    expect(allow({ type: 'exec', fullCommand: 'cat ../module/src/sim.ts' })).toBe('cancel');
    expect(allow({ type: 'exec', fullCommand: 'curl https://example.com' })).toBe('cancel');
  });

  it('allows only the vouch-lab MCP server and disables web tools', () => {
    expect(allow({ type: 'mcp_tool', serverName: 'vouch-lab', toolName: 'get_detector' })).toBe('allow');
    expect(allow({ type: 'mcp_tool', serverName: 'github', toolName: 'push' })).toBe('cancel');
    expect(allow({ type: 'ask_user' })).toBe('cancel');
    expect(DISABLED_TOOLS).toEqual(['WebSearch', 'FetchUrl']);
  });

  it('allows inspectable Script batches only when every nested call passes the same fence', () => {
    expect(allow({ type: 'script', calls: [
      { toolName: 'Read', toolInput: { file_path: 'LAB.md' } },
      { toolName: 'Execute', toolInput: { command: 'npx tsx test.ts candidates/7' } },
    ] })).toBe('allow');
    expect(allow({ type: 'script', calls: [
      { toolName: 'Create', toolInput: { file_path: 'candidates/7/detector.ts' } },
      { toolName: 'Execute', toolInput: { command: 'rm -rf .' } },
    ] })).toBe('cancel');
    expect(allow({ type: 'script', calls: [] })).toBe('cancel');
  });

  it('promotion fixes import paths and bumps the version', () => {
    const src = "import type { Detector } from '../../types';\nimport { median } from '../../lib';\nexport const detector: Detector = { id: 'false_defect', version: 1, run: () => [] };";
    const out = toLiveSource(src, 3);
    expect(out).toContain("from '../types'");
    expect(out).toContain("from '../lib'");
    expect(out).toContain('version: 3');
  });
});
