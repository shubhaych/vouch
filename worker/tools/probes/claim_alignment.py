#!/usr/bin/env python3
"""Where in the video each spoken claim was said, and the words around it.

usage: claim_alignment.py transcript.json claims.json [--pad 5] [--out work/alignment.json]

Prints {"claims":[{"id","text","tSaid","window":[t0,t1],"said":"...words in the window..."}]}.
With no word timestamps (no transcript), the window is tSaid +/- pad and "said" is empty.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, parse  # noqa: E402


def main():
    pos, o = parse(sys.argv[1:])
    if len(pos) < 2:
        print(__doc__)
        return 2
    pad = float(o.get("pad", 5))
    tr = json.load(open(pos[0])) if os.path.exists(pos[0]) else {}
    claims = json.load(open(pos[1]))
    words = tr.get("words", []) if isinstance(tr, dict) else []
    out = []
    for c in claims if isinstance(claims, list) else claims.get("claims", []):
        t = float(c.get("tSaid", 0))
        w0, w1 = max(0.0, t - pad), t + pad
        said = " ".join(w["w"] for w in words if w0 <= float(w["start"]) <= w1)
        out.append({"id": c.get("id"), "text": c.get("text"), "kind": c.get("kind"), "tSaid": t, "window": [round(w0, 2), round(w1, 2)], "said": said})
    emit({"probe": "claim_alignment", "claims": out}, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
