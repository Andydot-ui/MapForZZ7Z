"""Export a single ground texture (in the same local frame as the GLB / point cloud)."""
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

SRC = r"C:\Users\andyd\Downloads\输出.tif"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\models\ground.webp"
CENTER = (743487.0, 3857689.0, 0.0)
SIZE = 4096

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

img.save(OUT, "WEBP", quality=86, method=6)
import os
print("bytes", os.path.getsize(OUT) / 1e6, "MB")
