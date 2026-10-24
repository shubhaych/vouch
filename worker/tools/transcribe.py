#!/usr/bin/env python3
"""Transcribe a 16 kHz mono WAV with faster-whisper, word timestamps included.

usage: transcribe.py audio.wav transcript.json [--model small] [--txt transcript.txt]

Exit codes: 0 ok, 2 bad arguments, 3 faster-whisper is not installed
(pip install faster-whisper), 4 the model failed to run.
The JSON is {"model", "language", "durationS", "segments":[{"start","end","text"}],
"words":[{"w","start","end","p"}]} so claims can be timed to the word.
"""
import json
import sys
import time


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = {k: v for k, v in zip(sys.argv[1:], sys.argv[2:]) if k.startswith("--")}
    if len(args) < 2:
        print(__doc__)
        return 2
    wav, out = args[0], args[1]
    model_name = opts.get("--model", "small")
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as e:  # noqa: BLE001
        json.dump({"error": "faster-whisper is not installed", "detail": str(e)}, open(out, "w"))
        print("faster-whisper is not installed: pip install faster-whisper", file=sys.stderr)
        return 3
    t0 = time.time()
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(wav, word_timestamps=True, vad_filter=True, beam_size=3)
        segs, words = [], []
        for s in segments:
            segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
            for w in s.words or []:
                words.append({"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2), "p": round(float(w.probability), 3)})
    except Exception as e:  # noqa: BLE001
        json.dump({"error": "transcription failed", "detail": str(e)}, open(out, "w"))
        print(f"transcription failed: {e}", file=sys.stderr)
        return 4
    doc = {
        "model": f"faster-whisper {model_name} int8",
        "language": getattr(info, "language", None),
        "durationS": round(float(getattr(info, "duration", 0) or 0), 2),
        "segments": segs,
        "words": words,
        "tookMs": int((time.time() - t0) * 1000),
    }
    json.dump(doc, open(out, "w"), indent=1)
    txt = opts.get("--txt")
    if txt:
        with open(txt, "w") as f:
            for s in segs:
                f.write(f"[{s['start']:06.2f}-{s['end']:06.2f}] {s['text']}\n")
    print(f"{len(segs)} segments, {len(words)} words, {doc['tookMs']} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
