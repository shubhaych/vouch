#!/usr/bin/env python3
"""Read text in a frame (labels, serial numbers, model names) with tesseract.

usage: ocr.py frame.jpg [--region x,y,w,h] [--pattern REGEX] [--crop work/crop.jpg] [--out work/ocr.json]

Prints {"text","lines":[...],"matches":[...]}. Exit 3 when tesseract is missing.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from common import emit, parse, region  # noqa: E402


def main():
    pos, o = parse(sys.argv[1:])
    if not pos:
        print(__doc__)
        return 2
    tess = shutil.which("tesseract") or "/opt/homebrew/bin/tesseract"
    if not os.path.exists(tess):
        emit({"error": "tesseract is not installed"}, o.get("out"))
        return 3
    im = Image.open(pos[0]).convert("L")
    x, y, w, h = region(o.get("region"), im.width, im.height)
    crop = im.crop((x, y, x + w, y + h))
    if crop.width < 600:
        crop = crop.resize((crop.width * 3, crop.height * 3))
    if o.get("crop"):
        crop.save(o["crop"])
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        crop.save(f.name)
        r = subprocess.run([tess, f.name, "-", "--psm", "6"], capture_output=True, text=True)
    text = r.stdout.strip()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    matches = re.findall(o["pattern"], text) if o.get("pattern") else []
    emit({"probe": "ocr", "file": pos[0], "region": [x, y, w, h], "text": text, "lines": lines, "matches": matches, "crop": o.get("crop")}, o.get("out"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
