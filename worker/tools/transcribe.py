#!/usr/bin/env python3
"""Transcribe a 16 kHz mono WAV with faster-whisper, word timestamps included.

usage: transcribe.py audio.wav transcript.json [--model small] [--txt transcript.txt]

Exit codes: 0 ok, 2 bad arguments, 3 faster-whisper is not installed
(pip install faster-whisper), 4 the model failed to run.
The JSON is {"model", "language", "durationS", "segments":[{"start","end","text"}],
"words":[{"w","start","end","p"}]} so claims can be timed to the word.
"""
import argparse
import json
import sys
import time
import wave


def read_wav(path: str):
    """The worker always writes 16 kHz mono s16le, so numpy reads it directly.
    faster-whisper's own decoder goes through PyAV, whose API changed under it
    (av 15+ dropped open(metadata_errors=)), which made every transcript fail."""
    import numpy as np  # type: ignore

    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != 16000:
            raise ValueError(f"expected 16 kHz mono 16-bit WAV, got {w.getframerate()} Hz, {w.getnchannels()} ch, {8 * w.getsampwidth()}-bit")
        pcm = w.readframes(w.getnframes())
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def load_model(name: str):
    from faster_whisper import WhisperModel  # type: ignore

    # Use the cached model without asking the Hub first: the online check can
    # hang for minutes on a slow or captive network, longer than the worker waits.
    try:
        return WhisperModel(name, device="cpu", compute_type="int8", local_files_only=True)
    except Exception:  # noqa: BLE001  not cached yet: download once
        return WhisperModel(name, device="cpu", compute_type="int8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav")
    parser.add_argument("out")
    parser.add_argument("--model", default="small")
    parser.add_argument("--txt")
    args = parser.parse_args()
    try:
        import faster_whisper  # type: ignore  # noqa: F401
    except Exception as e:  # noqa: BLE001
        json.dump({"error": "faster-whisper is not installed", "detail": str(e)}, open(args.out, "w"))
        print("faster-whisper is not installed: pip install faster-whisper", file=sys.stderr)
        return 3
    t0 = time.time()
    try:
        audio = read_wav(args.wav)
        model = load_model(args.model)
        segments, info = model.transcribe(audio, word_timestamps=True, vad_filter=True, beam_size=3, condition_on_previous_text=False)
        segs, words = [], []
        for s in segments:
            segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
            for w in s.words or []:
                words.append({"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2), "p": round(float(w.probability), 3)})
    except Exception as e:  # noqa: BLE001
        json.dump({"error": "transcription failed", "detail": str(e)}, open(args.out, "w"))
        print(f"transcription failed: {e}", file=sys.stderr)
        return 4
    doc = {
        "model": f"faster-whisper {args.model} int8",
        "language": getattr(info, "language", None),
        "durationS": round(float(getattr(info, "duration", 0) or 0), 2),
        "segments": segs,
        "words": words,
        "tookMs": int((time.time() - t0) * 1000),
    }
    json.dump(doc, open(args.out, "w"), indent=1)
    if args.txt:
        with open(args.txt, "w") as f:
            for s in segs:
                f.write(f"[{s['start']:06.2f}-{s['end']:06.2f}] {s['text']}\n")
    print(f"{len(segs)} segments, {len(words)} words, {doc['tookMs']} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
