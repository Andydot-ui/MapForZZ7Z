"""从已有截图裁出三张方形配图，供「三层数据」章节使用。
不重新抓图，只做裁切 + 压缩，保持整站体积可控。
"""
import os
from PIL import Image

IMG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site', 'img')

# (源文件, 目标文件, 裁切边长, 质量)
JOBS = [
    ('hero-3d.jpg', 'layer-mesh.jpg', 991, 84),
    ('ui-map.jpg', 'layer-ortho.jpg', 1000, 84),
    ('ui-3d.jpg', 'layer-points.jpg', 1000, 84),
]

for src, dst, side, quality in JOBS:
    p = os.path.join(IMG, src)
    im = Image.open(p).convert('RGB')
    w, h = im.size
    side = min(side, w, h)
    x0 = (w - side) // 2
    y0 = (h - side) // 2
    crop = im.crop((x0, y0, x0 + side, y0 + side))
    if crop.width != 900:
        crop = crop.resize((900, 900), Image.LANCZOS)
    out = os.path.join(IMG, dst)
    crop.save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
    print(f'{dst}: {crop.size[0]}x{crop.size[1]} {os.path.getsize(out) // 1024} KB')
