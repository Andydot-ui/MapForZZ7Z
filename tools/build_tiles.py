"""Reproject the GeoTIFF to Web Mercator and emit XYZ WebP tiles (z15..z21).

每个缩放级别都直接重投影到「与 XYZ 瓦片网格严格对齐」的栅格上，
因此每张瓦片就是一次干净的 256×256 裁剪，相邻瓦片像素完全吻合，
不会出现透明补边导致的白色接缝。
"""
import math
import os

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from pyproj import Transformer
from PIL import Image

SRC = r"C:\Users\andyd\Downloads\输出.tif"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\tiles"

ZMIN, ZMAX = 15, 21
TILE = 256
QUALITY = 82

# 只重建指定层级：ONLY_Z=15 python tools/build_tiles.py
ONLY_Z = {int(v) for v in os.environ.get("ONLY_Z", "").replace(",", " ").split()} or None

R = 6378137.0
WORLD = 2 * math.pi * R


def main():
    with rasterio.open(SRC) as ds:
        print("src", ds.width, ds.height, ds.crs, flush=True)
        b = ds.bounds
        t4326 = Transformer.from_crs(ds.crs, "EPSG:4326", always_xy=True)
        lon_c, lat_c = t4326.transform((b.left + b.right) / 2, (b.bottom + b.top) / 2)
        print("centre lonlat", lon_c, lat_c, flush=True)

        # 用 9×9 角点采样求墨卡托外包框（UTM 边与墨卡托边不平行）
        t3857 = Transformer.from_crs(ds.crs, "EPSG:3857", always_xy=True)
        xs = np.linspace(b.left, b.right, 9)
        ys = np.linspace(b.bottom, b.top, 9)
        gx, gy = np.meshgrid(xs, ys)
        mxs, mys = t3857.transform(gx.ravel(), gy.ravel())
        mx0, mx1 = float(np.min(mxs)), float(np.max(mxs))
        my0, my1 = float(np.min(mys)), float(np.max(mys))
        print("merc bounds", mx0, my0, mx1, my1, flush=True)

    total_tiles = 0
    total_bytes = 0
    with rasterio.open(SRC) as ds:
        src_bands = rasterio.band(ds, (1, 2, 3, 4))
        for z in range(ZMIN, ZMAX + 1):
            if ONLY_Z and z not in ONLY_Z:
                continue
            n = 2 ** z
            tsz = WORLD / n              # 每张瓦片对应的墨卡托边长（米）
            px = tsz / TILE              # 每像素对应的墨卡托长度

            # 覆盖外包框的瓦片索引范围
            tx0 = int(math.floor((mx0 + WORLD / 2) / tsz))
            tx1 = int(math.floor((mx1 + WORLD / 2) / tsz))
            ty0 = int(math.floor((WORLD / 2 - my1) / tsz))
            ty1 = int(math.floor((WORLD / 2 - my0) / tsz))

            # 对齐到瓦片网格的左上角
            ax0 = tx0 * tsz - WORLD / 2
            ay1 = WORLD / 2 - ty0 * tsz
            w = (tx1 - tx0 + 1) * TILE
            h = (ty1 - ty0 + 1) * TILE

            dst = np.zeros((4, h, w), dtype=np.uint8)
            transform = rasterio.transform.from_origin(ax0, ay1, px, px)
            reproject(
                source=src_bands,
                destination=dst,
                src_transform=ds.transform,
                src_crs=ds.crs,
                dst_transform=transform,
                dst_crs="EPSG:3857",
                resampling=Resampling.bilinear,
                num_threads=4,
            )

            cnt = 0
            for ty in range(ty0, ty1 + 1):
                for tx in range(tx0, tx1 + 1):
                    ox = (tx - tx0) * TILE
                    oy = (ty - ty0) * TILE
                    block = np.transpose(dst[:, oy:oy + TILE, ox:ox + TILE], (1, 2, 0))
                    # 全透明处保持纯黑，避免半透明边缘出现白色描边
                    alpha = block[..., 3]
                    block[..., :3][alpha == 0] = 0
                    img = Image.fromarray(block, "RGBA")
                    d = os.path.join(OUT, str(z), str(tx))
                    os.makedirs(d, exist_ok=True)
                    p = os.path.join(d, f"{ty}.webp")
                    img.save(p, "WEBP", quality=QUALITY, method=5)
                    total_bytes += os.path.getsize(p)
                    cnt += 1
                    total_tiles += 1
            print(f"z{z}: {cnt} tiles  ({total_bytes/1e6:.1f} MB total)", flush=True)

    print(f"DONE tiles={total_tiles} bytes={total_bytes/1e6:.1f}MB", flush=True)


if __name__ == "__main__":
    main()
