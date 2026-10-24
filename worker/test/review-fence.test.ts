import { describe, expect, it } from 'vitest';
import { DISABLED_TOOLS, MCP_TOOLS, checkCommand, decideCaseTool, nestedDetails, tokens } from '../src/review/fence';

// R3: the Case Analyst can write and run probes inside work/, never touch the video or the
// repo; the Proof Builder writes proof/ only; the Auditor writes its test and nothing else.
const DIR = '/srv/vouch/worker/cases/42';
const a = (d: Parameters<typeof decideCaseTool>[2]) => decideCaseTool('analyst', DIR, d).outcome;
const p = (d: Parameters<typeof decideCaseTool>[2]) => decideCaseTool('proof', DIR, d).outcome;
const au = (d: Parameters<typeof decideCaseTool>[2]) => decideCaseTool('auditor', DIR, d).outcome;

describe('review fence: files', () => {
  it('the analyst writes only work/', () => {
    expect(a({ type: 'create', filePath: `${DIR}/work/probe.py` })).toBe('allow');
    expect(a({ type: 'edit', filePath: 'work/plan.md' })).toBe('allow');
    expect(a({ type: 'create', filePath: `${DIR}/proof/clip.mp4` })).toBe('cancel');
    expect(a({ type: 'edit', filePath: 'video.mp4' })).toBe('cancel');
    expect(a({ type: 'edit', filePath: 'claims.json' })).toBe('cancel');
    expect(a({ type: 'create', filePath: 'work/../CASE.md' })).toBe('cancel');
    expect(a({ type: 'create', filePath: '/srv/vouch/worker/src/review/runner.ts' })).toBe('cancel');
    expect(a({ type: 'create', filePath: '../../tools/probes/luminance.py' })).toBe('cancel');
    expect(a({ type: 'apply_patch', files: [{ filePath: `${DIR}/work/a.py` }, { filePath: `${DIR}/meta.json` }] })).toBe('cancel');
  });
  it('the proof builder writes only proof/', () => {
    expect(p({ type: 'create', filePath: 'proof/reel.txt' })).toBe('allow');
    expect(p({ type: 'create', filePath: 'work/x.py' })).toBe('cancel');
  });
  it('the auditor writes only work/audit_*', () => {
    expect(au({ type: 'create', filePath: 'work/audit_test.py' })).toBe('allow');
    expect(au({ type: 'create', filePath: `${DIR}/work/audit_result.json` })).toBe('allow');
    expect(au({ type: 'edit', filePath: 'work/probe.py' })).toBe('cancel');
    expect(au({ type: 'create', filePath: 'proof/x.mp4' })).toBe('cancel');
  });
});

describe('review fence: commands', () => {
  it('runs probes in work/ and the shared tools, with paths inside the case', () => {
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py video.mp4 --out work/luma.json' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: 'python3 ../../tools/probes/luminance.py video.mp4 --region 0.2,0.2,0.6,0.6 --out work/luma.json --chart work/luma.png' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: 'node work/measure.mjs frames/u_0003.jpg' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py > work/out.json' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py 2>&1' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: 'ffprobe -v error -show_streams video.mp4' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "ffmpeg -y -ss 11 -t 3 -i video.mp4 -vf \"drawtext=text='00:11':x=10:y=10\" work/clip.mp4" })).toBe('allow');
  });
  it('refuses everything that leaves the case or the list', () => {
    expect(a({ type: 'exec', fullCommand: 'python3 -c "import os; os.system(\'rm -rf /\')"' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py; rm -rf /' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py && cat /etc/passwd' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py | tee claims.json' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 work/probe.py > claims.json' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 ../../src/server.ts' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 ../../tools/../src/x.py' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 /tmp/x.py' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'cat video.mp4' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'curl https://example.com' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'ffmpeg -i video.mp4 proof/clip.mp4' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'ffmpeg -i video.mp4 ../../../etc/x.mp4' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'ffmpeg -i video.mp4 -f null -' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 work/x.py $(cat /etc/passwd)' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 work/x.py `id`' })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'python3 ~/x.py' })).toBe('cancel');
  });
  it('the proof builder only writes clips into proof/', () => {
    expect(p({ type: 'exec', fullCommand: 'ffmpeg -y -ss 10 -to 14 -i video.mp4 -vf drawbox=10:10:100:100:red proof/clip_1.mp4' })).toBe('allow');
    expect(p({ type: 'exec', fullCommand: 'ffmpeg -y -i video.mp4 work/clip_1.mp4' })).toBe('cancel');
    expect(p({ type: 'exec', fullCommand: 'python3 ../../tools/probes/luminance.py video.mp4' })).toBe('allow');
  });
  it('the auditor runs its own test and nothing else in work/', () => {
    expect(au({ type: 'exec', fullCommand: 'python3 work/audit_test.py' })).toBe('allow');
    expect(au({ type: 'exec', fullCommand: 'python3 work/probe.py' })).toBe('cancel');
    expect(au({ type: 'exec', fullCommand: 'ffprobe -v error -show_format proof/clip_1.mp4' })).toBe('allow');
    expect(checkCommand('auditor', 'ffmpeg -i video.mp4 work/audit.mp4').outcome).toBe('allow');
  });
  it('writes files through the shell, into the role folder only', () => {
    expect(a({ type: 'exec', fullCommand: "cat > work/plan.md <<'EOF'\n- c1: look at 00:03\n- c2: probe\nEOF" })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "cat > work/probe.py <<'PY'\nimport json\nprint(json.dumps({'x': 1}))\nPY" })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "cat > claims.json <<'EOF'\n{}\nEOF" })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: "cat > work/x.py <<EOF\nimport os\nEOF" })).toBe('cancel'); // unquoted tag: the shell would expand the body
    expect(a({ type: 'exec', fullCommand: "cat > work/x.py <<'EOF'\nline\nEOF\nrm -rf /\nEOF" })).toBe('cancel'); // the body ends the heredoc early
    expect(a({ type: 'exec', fullCommand: "cat video.mp4" })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: "echo hello > work/note.txt" })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "printf '%s' hi > work/hello.txt" })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "echo hello > ../other/note.txt" })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: 'mkdir -p work/out' })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: 'mkdir -p proof' })).toBe('cancel');
    expect(au({ type: 'exec', fullCommand: "cat > work/audit_test.py <<'PY'\nprint(1)\nPY" })).toBe('allow');
    expect(au({ type: 'exec', fullCommand: "cat > work/probe.py <<'PY'\nprint(1)\nPY" })).toBe('cancel');
  });
  it('runs an inline program from a quoted heredoc', () => {
    expect(a({ type: 'exec', fullCommand: "python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('frames').exists())\nPY" })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "node - <<'JS'\nconsole.log(1)\nJS" })).toBe('allow');
    expect(a({ type: 'exec', fullCommand: "python3 work/x.py <<'PY'\n1\nPY" })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: "python3 -c 'print(1)'" })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: "ffmpeg -i video.mp4 work/x.mp4 <<'EOF'\ny\nEOF" })).toBe('cancel');
    expect(a({ type: 'exec', fullCommand: "python3 - <<'PY'\nprint(1)\nPY\nrm -rf /" })).toBe('cancel');
  });
  it('accepts absolute paths that stay inside the case and refuses the rest', () => {
    const c = (cmd: string) => checkCommand('analyst', cmd, DIR).outcome;
    expect(c(`python3 ${DIR}/../../tools/probes/luminance.py ${DIR}/video.mp4 --out ${DIR}/work/luma.json`)).toBe('allow');
    expect(c(`ffmpeg -y -ss 1 -t 2 -i ${DIR}/video.mp4 ${DIR}/work/clip.mp4`)).toBe('allow');
    expect(c(`python3 /srv/vouch/worker/tools/probes/ocr.py ${DIR}/frames/u_0001.jpg`)).toBe('allow');
    expect(c(`python3 /srv/vouch/worker/src/x.py`)).toBe('cancel');
    expect(c(`ffmpeg -i ${DIR}/video.mp4 /srv/vouch/worker/cases/41/work/x.mp4`)).toBe('cancel');
    expect(c(`echo x > ${DIR}/work/n.txt`)).toBe('allow');
    expect(c(`echo x > ${DIR}/CASE.md`)).toBe('cancel');
    expect(decideCaseTool('analyst', DIR, { type: 'exec', fullCommand: `cat > ${DIR}/work/plan.md <<'EOF'\nplan\nEOF` }).outcome).toBe('allow');
  });
  it('tokenises quotes and rejects unbalanced ones', () => {
    expect(tokens("ffmpeg -vf 'a b' x")).toEqual(['ffmpeg', '-vf', 'a b', 'x']);
    expect(tokens('ffmpeg -vf "a')).toBeNull();
  });
});

describe('review fence: MCP and the rest', () => {
  it('allows only vouch-case tools of the role', () => {
    expect(a({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'add_finding' })).toBe('allow');
    expect(a({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'mcp__vouch-case__add_artifact' })).toBe('allow');
    expect(a({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'audit_finding' })).toBe('cancel');
    expect(p({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'add_finding' })).toBe('cancel');
    expect(au({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'audit_finding' })).toBe('allow');
    expect(au({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'add_finding' })).toBe('cancel');
    expect(a({ type: 'mcp_tool', serverName: 'github', toolName: 'push' })).toBe('cancel');
    expect(a({ type: 'ask_user' })).toBe('cancel');
    expect(a({ type: 'mcp_tool', serverName: 'vouch_case', toolName: 'vouch-case___set_live_note' })).toBe('allow');
    expect(DISABLED_TOOLS).toEqual(['WebSearch', 'FetchUrl', 'Task']);
    expect(MCP_TOOLS.auditor).not.toContain('add_finding');
  });
});

describe('review fence: scripts', () => {
  const read = { toolName: 'Read', toolInput: { file_path: `${DIR}/CASE.md` } };
  const note = { toolName: 'vouch-case___set_live_note', toolInput: { text: 'Checking claim 1' }, confirmation: { type: 'mcp_tool', serverName: 'vouch-case', toolName: 'set_live_note' } };
  const probe = { toolName: 'Execute', toolInput: { command: 'python3 ../../tools/probes/luminance.py video.mp4 --out work/luma.json' }, confirmation: { type: 'exec', command: 'python3 ../../tools/probes/luminance.py video.mp4 --out work/luma.json' } };
  it('allows a script whose every call the role may make on its own', () => {
    expect(a({ type: 'script', calls: [read, note, probe] })).toBe('allow');
    expect(a({ type: 'script', calls: [] })).toBe('allow');
    expect(a({ type: 'script', calls: [{ toolName: 'Create', toolInput: { file_path: 'work/plan.md' } }] })).toBe('allow');
  });
  it('cancels the whole script when one call is outside the fence', () => {
    expect(a({ type: 'script', calls: [read, { toolName: 'Create', toolInput: { file_path: 'claims.json' } }] })).toBe('cancel');
    expect(a({ type: 'script', calls: [note, { toolName: 'Execute', toolInput: { command: 'curl https://example.com' } }] })).toBe('cancel');
    expect(a({ type: 'script', calls: [{ toolName: 'vouch-case___audit_finding', toolInput: {} }] })).toBe('cancel');
    expect(a({ type: 'script', calls: [{ toolName: 'Script', toolInput: {}, confirmation: { type: 'script', calls: [] } }] })).toBe('cancel');
    expect(a({ type: 'script', calls: [{ toolName: 'Task', toolInput: {} }] })).toBe('cancel');
    expect(p({ type: 'script', calls: [probe, { toolName: 'Execute', toolInput: { command: 'ffmpeg -i video.mp4 work/clip.mp4' } }] })).toBe('cancel');
  });
  it('derives the details from the tool name and input when the harness gives none', () => {
    expect(nestedDetails({ toolName: 'Execute', toolInput: { command: 'ffprobe video.mp4' } })).toEqual({ type: 'exec', command: 'ffprobe video.mp4' });
    expect(nestedDetails({ toolName: 'vouch_case.add_finding', toolInput: {} })).toEqual({ type: 'mcp_tool', serverName: 'vouch-case', toolName: 'add_finding' });
    expect(nestedDetails({ toolName: 'Edit', toolInput: { file_path: 'work/x.py' } })).toEqual({ type: 'edit', filePath: 'work/x.py' });
  });
});
