"""Robustly trim the near-black plate around the 3D model.

Uses a per-row / per-column content-count test so isolated bright noise or
antialiasing at the frame edge does not defeat the crop. Then pads the result
back out to the requested aspect ratio using the plate colour sampled from the
image itself, so the card looks intentional in either theme.
"""
import os

import numpy as np
from PIL import Image

IMG = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\site\img"

THRESH = 38          # a pixel counts as content above this max-channel value
MIN_FRAC = 0.004     # a row/column needs this share of content pixels to count


def content_box(im, thresh=THRESH, min_frac=MIN_FRAC):
    a = np.asarray(im.convert("RGB")).astype(np.int16).max(axis=2)
    h, w = a.shape
    m = a > thresh
    col = m.sum(axis=0) >= max(2, int(h * min_frac))
    row = m.sum(axis=1) >= max(2, int(w * min_frac))
    xs = np.nonzero(col)[0]
    ys = np.nonzero(row)[0]
    if len(xs) == 0 or len(ys) == 0:
        return (0, 0, w, h)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def plate_colour(im):
    a = np.asarray(im.convert("RGB"))
    # sample the four corner patches
    patches = [a[:24, :24], a[:24, -24:], a[-24:, :24], a[-24:, -24:]]
    vals = [np.median(patch.reshape(-1, 3), axis=0) for patch in patches]
    med = np.median(np.stack(vals), axis=0)
    return tuple(int(v) for v in med)


def pad_to(im, w, h, bg):
    out = Image.new("RGB", (w, h), bg)
    out.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return out


JOBS = [
    ("hero-3d-src.jpg", "hero-3d.jpg", 16 / 9, 1900, 86),
    ("hero-3d-top-src.jpg", "hero-3d-top.jpg", 4 / 3, 1400, 86),
]

for src, dst, aspect, maxw, q in JOBS:
    p = os.path.join(IMG, src)
    if not os.path.exists(p):
        print(f"missing {src}")
        continue
    im = Image.open(p).convert("RGB")
    box = content_box(im)
    bg = plate_colour(im)
    print(f"{src}: {im.width}x{im.height} content={box} plate={bg}")
    c = im.crop(box)

    # add a small uniform breathing room, then fit the aspect
    pad_ratio = 0.035
    pw = int(c.width * pad_ratio)
    ph = int(c.height * pad_ratio)
    c = pad_to(c, c.width + 2 * pw, c.height + 2 * ph, bg)

    if c.width / c.height > aspect:
        c = pad_to(c, c.width, int(round(c.width / aspect)), bg)
    else:
        c = pad_to(c, int(round(c.height * aspect)), c.height, bg)

    if c.width > maxw:
        c = c.resize((maxw, round(c.height * maxw / c.width)), Image.LANCZOS)
    o = os.path.join(IMG, dst)
    c.save(o, "JPEG", quality=q, optimize=True, progressive=True)
    print(f"  -> {dst} {c.width}x{c.height} {os.path.getsize(o)/1024:.0f} KB")
