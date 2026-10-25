#!/usr/bin/env python3
"""Does a part move? Frame-to-frame change inside a region, for hinges, buttons, wheels, loose parts.

usage: part_motion.py video.mp4 [--region x,y,w,h] [--t0 S] [--t1 S] [--fps 8] [--out work/motion.json] [--chart work/motion.png]

Prints {"series":[{"t","change"}], "mean_change", "peaks":[t...], "moving": bool}. change is the mean
absolute pixel difference (0-255) between consecutive samples in the region; a peak is > 2x the median.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, gray_frames, line_chart, parse, region  # noqa: E402


def main():
    pos, o = parse(sys.argv[1:])
    if not pos:
        print(__doc__)
        return 2
    fps = float(o.get("fps", 8))
    t0 = float(o["t0"]) if "t0" in o else None
    t1 = float(o["t1"]) if "t1" in o else None
    prev = None
    series = []
    rx = ry = rw = rh = 0
    for t, fr in gray_frames(pos[0], fps, t0, t1):
        if prev is None:
            sh, sw = fr.shape
            rx, ry, rw, rh = region(o.get("region"), sw, sh)
        cur = fr[ry : ry + rh, rx : rx + rw].astype(np.int16)
        if prev is not None:
            series.append({"t": round(t, 2), "change": round(float(np.abs(cur - prev).mean()), 2)})
        prev = cur
    ch = np.array([s["change"] for s in series]) if series else np.array([0.0])
    med = float(np.median(ch))
    peaks = [s["t"] for s in series if s["change"] > max(2 * med, 4.0)]
    doc = {
        "probe": "part_motion",
        "region": [rx, ry, rw, rh],
        "fps": fps,
        "series": series,
        "mean_change": round(float(ch.mean()), 2),
        "median_change": round(med, 2),
        "peaks": peaks,
        "moving": bool(ch.mean() > 3.0),
    }
    if o.get("chart"):
        line_chart(o["chart"], [s["t"] for s in series], [s["change"] for s in series], "mean abs pixel change in region", [(p, "peak") for p in peaks[:8]])
        doc["chart"] = o["chart"]
    emit(doc, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
