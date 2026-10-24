#!/usr/bin/env python3
"""Signal changes near each spoken claim that may support or contradict it.

usage: contradiction_markers.py claims.json [--luma work/luma.json] [--audio work/audio.json] [--pad 5] [--out work/markers.json]

For each claim, lists luminance jumps and sound onsets inside tSaid +/- pad, and a hint:
a claim about something not turning on / no light that overlaps a luminance jump up,
or a claim about no sound that overlaps a sound onset, is marked "check: may contradict".
It is a pointer for the analyst, not a verdict: look at the frames before writing a finding.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, parse  # noqa: E402

NO_LIGHT = re.compile(r"(won'?t|does ?n'?t|not|never|no)\s+(turn|power|light|switch|come)|dead|no light|stays dark", re.I)
NO_SOUND = re.compile(r"(no|not|won'?t|does ?n'?t)\s+(sound|audio|play|noise)|silent|mute", re.I)


def main():
    pos, o = parse(sys.argv[1:])
    if not pos:
        print(__doc__)
        return 2
    pad = float(o.get("pad", 5))
    claims = json.load(open(pos[0]))
    claims = claims if isinstance(claims, list) else claims.get("claims", [])
    luma = json.load(open(o["luma"])) if o.get("luma") and os.path.exists(o["luma"]) else {}
    audio = json.load(open(o["audio"])) if o.get("audio") and os.path.exists(o["audio"]) else {}
    out = []
    for c in claims:
        t = float(c.get("tSaid", 0))
        w0, w1 = max(0.0, t - pad), t + pad
        jumps = [j for j in luma.get("jumps", []) if w0 <= j["t"] <= w1]
        onsets = [x for x in audio.get("onsets", []) if w0 <= x <= w1]
        text = str(c.get("text", ""))
        hints = []
        if NO_LIGHT.search(text) and any(j["to"] > j["from"] for j in jumps):
            hints.append("check: may contradict (brightness rises while the claim says it does not light up)")
        if NO_SOUND.search(text) and onsets:
            hints.append("check: may contradict (sound starts while the claim says there is none)")
        if not jumps and not onsets:
            hints.append("no signal change in the window; look at the frames")
        out.append({"id": c.get("id"), "text": text, "window": [round(w0, 2), round(w1, 2)], "luminance_jumps": jumps, "sound_onsets": onsets, "hints": hints})
    emit({"probe": "contradiction_markers", "claims": out}, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
