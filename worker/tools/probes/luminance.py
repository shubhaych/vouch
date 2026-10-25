#!/usr/bin/env python3
"""Mean luminance of a region over time, with the jumps that matter for "it does not turn on" claims.

usage: luminance.py video.mp4 [--region x,y,w,h] [--fps 4] [--t0 S] [--t1 S] [--out work/luma.json] [--chart work/luma.png]

Prints {"series":[{"t","y"}], "min","max","mean", "jumps":[{"t","from","to"}], "lit_from": t|null}.
A jump is a change of more than 25 levels between consecutive samples; lit_from is the first time
the region stays above (min + 0.5*(max-min)) for at least two samples.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, gray_frames, line_chart, parse, probe_size, region  # noqa: E402


def main():
    pos, o = parse(sys.argv[1:])
    if not pos:
        print(__doc__)
        return 2
    video = pos[0]
    fps = float(o.get("fps", 4))
    t0 = float(o["t0"]) if "t0" in o else None
    t1 = float(o["t1"]) if "t1" in o else None
    w, h, _ = probe_size(video)
    series = []
    first = True
    rx = ry = rw = rh = 0
    for t, fr in gray_frames(video, fps, t0, t1):
        if first:
            sh, sw = fr.shape
            rx, ry, rw, rh = region(o.get("region"), sw, sh)
            first = False
        y = float(fr[ry : ry + rh, rx : rx + rw].mean())
        series.append({"t": round(t, 2), "y": round(y, 1)})
    ys = [s["y"] for s in series]
    jumps = [
        {"t": series[i]["t"], "from": series[i - 1]["y"], "to": series[i]["y"]}
        for i in range(1, len(series))
        if abs(series[i]["y"] - series[i - 1]["y"]) > 25
    ]
    lit_from = None
    if ys:
        thr = min(ys) + 0.5 * (max(ys) - min(ys))
        for i in range(len(ys) - 1):
            if ys[i] > thr and ys[i + 1] > thr and max(ys) - min(ys) > 25:
                lit_from = series[i]["t"]
                break
    doc = {
        "probe": "luminance",
        "video": video,
        "region": [rx, ry, rw, rh],
        "fps": fps,
        "series": series,
        "min": round(min(ys), 1) if ys else None,
        "max": round(max(ys), 1) if ys else None,
        "mean": round(sum(ys) / len(ys), 1) if ys else None,
        "jumps": jumps,
        "lit_from": lit_from,
    }
    if o.get("chart"):
        line_chart(o["chart"], [s["t"] for s in series], ys, "mean luminance (0-255) in region", [(j["t"], f"{j['from']:.0f}->{j['to']:.0f}") for j in jumps[:6]])
        doc["chart"] = o["chart"]
    emit(doc, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
