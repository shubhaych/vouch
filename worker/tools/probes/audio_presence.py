#!/usr/bin/env python3
"""Is there sound, and when? RMS loudness per 100 ms of a 16 kHz mono WAV.

usage: audio_presence.py audio.wav [--window 0.1] [--out work/audio.json] [--chart work/audio.png]

Prints {"series":[{"t","db"}], "peak_db", "noise_floor_db", "sound_segments":[{"start","end","peak_db"}],
"onsets":[t...], "silent": bool}. A segment is sound when it rises 12 dB above the noise floor.
"""
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, line_chart, parse  # noqa: E402


def main():
    pos, o = parse(sys.argv[1:])
    if not pos:
        print(__doc__)
        return 2
    win = float(o.get("window", 0.1))
    with wave.open(pos[0], "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
        data = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() > 1:
            data = data.reshape(-1, w.getnchannels()).mean(axis=1)
    step = max(1, int(sr * win))
    series = []
    for i in range(0, len(data), step):
        seg = data[i : i + step]
        rms = float(np.sqrt(np.mean(seg * seg))) if len(seg) else 0.0
        series.append({"t": round(i / sr, 2), "db": round(20 * np.log10(max(rms, 1e-6)), 1)})
    dbs = np.array([s["db"] for s in series]) if series else np.array([-120.0])
    floor = float(np.percentile(dbs, 20))
    peak = float(dbs.max())
    thr = floor + 12
    segs, start = [], None
    for s in series:
        if s["db"] > thr and start is None:
            start = s
        elif s["db"] <= thr and start is not None:
            segs.append({"start": start["t"], "end": s["t"], "peak_db": round(max(x["db"] for x in series if start["t"] <= x["t"] < s["t"]), 1)})
            start = None
    if start is not None:
        segs.append({"start": start["t"], "end": series[-1]["t"], "peak_db": round(peak, 1)})
    doc = {
        "probe": "audio_presence",
        "wav": pos[0],
        "window_s": win,
        "series": series,
        "peak_db": round(peak, 1),
        "noise_floor_db": round(floor, 1),
        "sound_segments": segs,
        "onsets": [s["start"] for s in segs],
        "silent": peak - floor < 12,
    }
    if o.get("chart"):
        line_chart(o["chart"], [s["t"] for s in series], [s["db"] for s in series], "loudness (dBFS) per 100 ms", [(s["start"], "sound") for s in segs[:8]])
        doc["chart"] = o["chart"]
    emit(doc, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
