// Runs one CREAO seat end to end: the run row, progress steps, the poll, the
// parse and the finish. The Desk Lead keeps its own copy inside the
// Orchestrator class; the video reviewer and the Returns Monitor share this one.
import type { DbConnection } from '../module_bindings/index';
import type { Seat } from './env';
import { fillFromChat, parseVerdict, startRun, waitForRun, type RunHandle } from './creao';
import { call } from './stdb';

export async function runSeat<T extends object>(
  conn: DbConnection, seat: Seat, caseRef: string, caseJson: unknown, fallback: T, valid: (v: Record<string, unknown>) => boolean, onStep: (s: string) => void, firstStep = 'case sent',
): Promise<{ value: T; ok: boolean; handle: RunHandle }> {
  const handle = await startRun(seat, caseJson, caseRef);
  await call('recordRun', conn.reducers.recordRun({ runId: handle.runId, seat, caseRef, runUrl: handle.runUrl, conversationId: handle.conversationId, mode: handle.path === 'fixture' ? 'fixture' : 'live' }));
  const step = (s: string) => { onStep(s); void call('runStep', conn.reducers.runStep({ runId: handle.runId, step: s })); };
  step(firstStep);
  const result = await waitForRun(handle, caseJson, step);
  const parsed = parseVerdict(result.text, fallback, valid, (v) => fillFromChat(seat, v, result.chat));
  step(result.status !== 'completed' ? `run ${result.status}` : parsed.ok ? 'result received' : 'result unparseable: failed closed');
  await call('finishRun', conn.reducers.finishRun({ runId: handle.runId, status: result.status === 'completed' ? 'completed' : 'failed', runUrl: handle.runUrl }));
  return { ...parsed, handle };
}
