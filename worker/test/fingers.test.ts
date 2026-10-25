import { describe, expect, it } from 'vitest';
import { fingerMessage, judgeFingers } from '../src/fingers';

// The quick finger check only sends the customer back on a confident miss.
// Anything unsure lets the upload through; the full review looks again.
const j = (o: object) => `Here you go: ${JSON.stringify(o)}`;

describe('finger challenge at upload', () => {
  it('passes the right count', () => {
    const r = judgeFingers(j({ handVisible: true, fingers: 3, confidence: 0.9 }), 3);
    expect(r.verdict).toBe('ok');
    expect(fingerMessage({ ...r, ms: 0 }, 3)).toBeNull();
  });

  it('asks to record again when no fingers are held up, or the count is wrong', () => {
    const none = judgeFingers(j({ handVisible: false, fingers: null, confidence: 0.85 }), 4);
    expect(none.verdict).toBe('missing');
    expect(fingerMessage({ ...none, ms: 0 }, 4)).toContain('holding up 4 fingers');
    const wrong = judgeFingers(j({ handVisible: true, fingers: 2, confidence: 0.8 }), 4);
    expect(wrong.verdict).toBe('wrong');
    expect(fingerMessage({ ...wrong, ms: 0 }, 4)).toContain('we counted 2 fingers');
  });

  it('never blocks on an unsure or unreadable answer', () => {
    for (const reply of [j({ handVisible: false, fingers: 0, confidence: 0.5 }), j({ handVisible: true, fingers: null, confidence: 0.9 }), 'no idea', '']) {
      const r = judgeFingers(reply, 3);
      expect(r.verdict).toBe('unsure');
      expect(fingerMessage({ ...r, ms: 0 }, 3)).toBeNull();
    }
  });
});
