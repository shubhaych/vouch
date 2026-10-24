#!/usr/bin/env python3
"""Screen-recapture hint: a periodic pixel grid (moire) shows up as sharp peaks in the 2-D spectrum.

usage: recapture.py frame.jpg [frame2.jpg ...] [--out work/recapture.json]

Prints {"frames":[{"file","grid_score"}], "max_grid_score", "hint"}. grid_score is the energy of the
strongest high-frequency spectral peak relative to its neighbourhood; above 8 is worth a look, above 15
is a strong hint. Phone footage of a real object scores low (1-4). A hint, never a verdict.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, parse  # noqa: E402


def grid_score(path):
    im = Image.open(path).convert("L")
    im = im.resize((512, 512))
    a = np.asarray(im, dtype=np.float32)
    a = a - a.mean()
    spec = np.abs(np.fft.fftshift(np.fft.fft2(a)))
    c = 256
    yy, xx = np.mgrid[0:512, 0:512]
    r = np.sqrt((yy - c) ** 2 + (xx - c) ** 2)
    band = (r > 40) & (r < 240)
    vals = spec[band]
    if vals.size == 0:
        return 0.0
    med = np.median(vals) + 1e-6
    peak = np.sort(vals)[-5:].mean()
    return float(peak / med) / 10.0


def main():
    pos, o = parse(sys.argv[1:])
    if not pos:
        print(__doc__)
        return 2
    frames = [{"file": p, "grid_score": round(grid_score(p), 2)} for p in pos if os.path.exists(p)]
    mx = max((f["grid_score"] for f in frames), default=0.0)
    hint = "strong hint of a periodic grid (screen?)" if mx > 15 else "worth a look" if mx > 8 else "no grid pattern found"
    emit({"probe": "recapture", "frames": frames, "max_grid_score": round(mx, 2), "hint": hint}, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
