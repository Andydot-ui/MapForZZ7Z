"""Export a single ground texture (in the same local frame as the GLB / point cloud)."""
import os

import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

SRC = r"C:\Users\andyd\Downloads\输出.tif"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\models\ground.webp"
CENTER = (743487.0, 3857689.0, 0.0)
# 地面贴图只是三维场景的背景底图，不需要很高的清晰度；
# 压低分辨率与质量可以显著减少首屏流量（pages.dev 实测带宽很低）。
SIZE = 1536

with rasterio.open(SRC) as ds:
    data = ds.read(out_shape=(4, SIZE, SIZE), resampling=Resampling.lanczos)
    b = ds.bounds

rgba = np.transpose(data, (1, 2, 0))
img = Image.fromarray(rgba, "RGBA")

# plane extent in local coords
x0 = b.left - CENTER[0]
x1 = b.right - CENTER[0]
y0 = b.bottom - CENTER[1]
y1 = b.top - CENTER[1]
print("plane x", x0, x1, "y", y0, y1)
print("size", img.size)

img.save(OUT, "WEBP", quality=72, method=6)
print("bytes", os.path.getsize(OUT) / 1e6, "MB")
