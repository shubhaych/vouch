import { describe, expect, it } from 'vitest';
import { claimNeedsWork } from '../src/orchestrator';

describe('which claims the Desk Lead picks up', () => {
  it('starts claims whose frames are ready', () => {
    expect(claimNeedsWork({ status: 'frames_ready' }, false)).toBe(true);
    expect(claimNeedsWork({ status: 'awaiting_video' }, false)).toBe(false);
    expect(claimNeedsWork({ status: 'recommended' }, true)).toBe(false);
  });
  it('QA-006 resumes a claim a crash left "investigating", but only in the start-up scan', () => {
    expect(claimNeedsWork({ status: 'investigating' }, true)).toBe(true);
    expect(claimNeedsWork({ status: 'investigating' }, false)).toBe(false); // our own run's status update
  });
});
