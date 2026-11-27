"""Compress the site screenshots into web-friendly JPEGs.

Produces:
  hero-3d.jpg        (wide hero, 1600px)
  hero-3d-top.jpg    (top-down, 1400px)
  ui-map.jpg / ui-3d.jpg   (UI shots, 1600px)
plus a 2x card version and small thumbs where useful.
"""
import os

from PIL import Image

IMG = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\site\img"

JOBS = [
    ("shot-map-light.png", "ui-map.jpg", 1700, 80),
    ("shot-map.png", "ui-map-dark.jpg", 1700, 80),
    ("shot-3d.png", "ui-3d.jpg", 1700, 80),
    ("hero-3d.png", "hero-3d.jpg", 1900, 84),
    ("hero-3d-top.png", "hero-3d-top.jpg", 1500, 84),
]

for src, dst, w, q in JOBS:
    p = os.path.join(IMG, src)
    if not os.path.exists(p):
        print(f"missing {src}")
        continue
    im = Image.open(p).convert("RGB")
    if im.width > w:
        h = round(im.height * w / im.width)
        im = im.resize((w, h), Image.LANCZOS)
    out = os.path.join(IMG, dst)
    im.save(out, "JPEG", quality=q, optimize=True, progressive=True)
    print(f"{dst}: {im.width}x{im.height}  {os.path.getsize(out)/1024:.0f} KB")
