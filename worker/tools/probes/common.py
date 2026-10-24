"""Shared helpers for the probes: frames via ffmpeg (always present), tiny PIL charts, argument parsing.

Every probe prints one JSON object to stdout and, with --out, writes the same JSON to a file
inside work/. Charts are PNGs drawn with PIL so nothing beyond numpy and Pillow is needed.
"""
import json
import subprocess
import sys

import numpy as np


def parse(argv):
    """positional args and --key value options (a bare --flag is True)."""
    pos, opts, i = [], {}, 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                opts[a[2:]] = argv[i + 1]
                i += 2
            else:
                opts[a[2:]] = True
                i += 1
        else:
            pos.append(a)
            i += 1
    return pos, opts


def region(spec, w, h):
    """'x,y,w,h' as fractions of the frame (0..1) or pixels; default the whole frame."""
    if not spec:
        return 0, 0, w, h
    x, y, rw, rh = [float(v) for v in spec.split(",")]
    if max(x, y, rw, rh) <= 1.0:
        x, y, rw, rh = x * w, y * h, rw * w, rh * h
    x, y, rw, rh = int(x), int(y), max(1, int(rw)), max(1, int(rh))
    return max(0, x), max(0, y), min(rw, w - x), min(rh, h - y)


def probe_size(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", video],
        capture_output=True, text=True, check=True,
    ).stdout
    j = json.loads(out)
    s = j["streams"][0]
    return int(s["width"]), int(s["height"]), float(j["format"]["duration"])


def gray_frames(video, fps=4.0, t0=None, t1=None, scale_w=320):
    """Yields (t, frame uint8 HxW) sampled at fps between t0 and t1, scaled to scale_w wide."""
    w, h, dur = probe_size(video)
    sw = scale_w
    sh = max(2, int(round(h * sw / w / 2)) * 2)
    cmd = ["ffmpeg", "-v", "error"]
    if t0 is not None:
        cmd += ["-ss", f"{t0:.3f}"]
    cmd += ["-i", video]
    if t1 is not None:
        cmd += ["-t", f"{max(0.05, t1 - (t0 or 0)):.3f}"]
    cmd += ["-vf", f"fps={fps},scale={sw}:{sh},format=gray", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (sw * sh)
    arr = np.frombuffer(raw[: n * sw * sh], dtype=np.uint8).reshape(n, sh, sw)
    start = t0 or 0.0
    for i in range(n):
        yield start + i / fps, arr[i]


def line_chart(path, xs, ys, title, marks=None, y_label=""):
    """A 640x240 line chart. marks: list of (x, label) vertical lines."""
    from PIL import Image, ImageDraw

    W, H, L, B = 640, 240, 48, 28
    img = Image.new("RGB", (W, H), (18, 18, 22))
    d = ImageDraw.Draw(img)
    d.text((L, 6), title, fill=(230, 230, 230))
    if not xs:
        img.save(path)
        return
    x0, x1 = min(xs), max(xs) or 1
    y0, y1 = min(ys), max(ys)
    if y1 - y0 < 1e-6:
        y1 = y0 + 1
    px = lambda x: L + (x - x0) / max(1e-6, (x1 - x0)) * (W - L - 10)  # noqa: E731
    py = lambda y: H - B - (y - y0) / (y1 - y0) * (H - B - 30)  # noqa: E731
    d.line([(L, H - B), (W - 10, H - B)], fill=(90, 90, 100))
    d.line([(L, 24), (L, H - B)], fill=(90, 90, 100))
    d.text((4, py(y1) - 6), f"{y1:.0f}", fill=(160, 160, 170))
    d.text((4, py(y0) - 6), f"{y0:.0f}", fill=(160, 160, 170))
    d.text((L, H - B + 6), f"{x0:.1f}s", fill=(160, 160, 170))
    d.text((W - 60, H - B + 6), f"{x1:.1f}s", fill=(160, 160, 170))
    pts = [(px(x), py(y)) for x, y in zip(xs, ys)]
    if len(pts) > 1:
        d.line(pts, fill=(80, 200, 255), width=2)
    for x, label in marks or []:
        d.line([(px(x), 24), (px(x), H - B)], fill=(255, 120, 80))
        d.text((px(x) + 3, 26), label, fill=(255, 160, 120))
    if y_label:
        d.text((L + 4, 26), y_label, fill=(160, 160, 170))
    img.save(path)


def emit(doc, out=None):
    s = json.dumps(doc, indent=1)
    if out:
        with open(out, "w") as f:
            f.write(s)
    print(s)
    sys.stdout.flush()
