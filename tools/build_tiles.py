"""Reproject the GeoTIFF to Web Mercator and emit XYZ WebP tiles (z16..z21)."""
import math
import os

import numpy as np
import rasterio
from rasterio.warp import Resampling, calculate_default_transform, reproject
from PIL import Image

SRC = r"C:\Users\andyd\Downloads\输出.tif"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\tiles"

ZMIN, ZMAX = 16, 21
TILE = 256
QUALITY = 82


def merc_res(z, lat):
    return 156543.03392804097 * math.cos(math.radians(lat)) / (2 ** z)


def tile_bounds(x, y, z):
    n = 2 ** z
    lon0 = x / n * 360.0 - 180.0
    lon1 = (x + 1) / n * 360.0 - 180.0
    lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lon0, lat0, lon1, lat1


def lonlat_to_merc(lon, lat):
    r = 6378137.0
    mx = r * math.radians(lon)
    my = r * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return mx, my


def main():
    with rasterio.open(SRC) as ds:
        print("src", ds.width, ds.height, ds.crs, flush=True)
        bounds = ds.bounds
        # centre lat for resolution maths
        cx = (bounds.left + bounds.right) / 2
        cy = (bounds.bottom + bounds.top) / 2
        from pyproj import Transformer

        t = Transformer.from_crs(ds.crs, "EPSG:4326", always_xy=True)
        lon_c, lat_c = t.transform(cx, cy)
        print("centre lonlat", lon_c, lat_c, flush=True)

        dst_res = 0.05
        left, bottom, right, top = bounds
        # UTM -> merc: use 8 corner samples for the merc bbox
        xs = np.linspace(left, right, 9)
        ys = np.linspace(bottom, top, 9)
        gx, gy = np.meshgrid(xs, ys)
        mxs, mys = Transformer.from_crs(ds.crs, "EPSG:3857", always_xy=True).transform(gx.ravel(), gy.ravel())
        mx0, mx1 = float(np.min(mxs)), float(np.max(mxs))
        my0, my1 = float(np.min(mys)), float(np.max(mys))
        print("merc bounds", mx0, my0, mx1, my1, flush=True)

        w = int(math.ceil((mx1 - mx0) / dst_res))
        h = int(math.ceil((my1 - my0) / dst_res))
        print("reprojected size", w, h, flush=True)

        dst = np.zeros((4, h, w), dtype=np.uint8)
        transform = rasterio.transform.from_origin(mx0, my1, dst_res, dst_res)

        reproject(
            source=rasterio.band(ds, (1, 2, 3, 4)),
            destination=dst,
            src_transform=ds.transform,
            src_crs=ds.crs,
            dst_transform=transform,
            dst_crs="EPSG:3857",
            resampling=Resampling.bilinear,
            num_threads=4,
        )
        print("reprojected", dst.shape, flush=True)

    # to PIL RGBA, premultiplied-aware resampling
    rgba = np.transpose(dst, (1, 2, 0))  # h,w,4
    img = Image.fromarray(rgba, "RGBA")
    img = img.convert("RGBa")  # premultiplied
    base = img

    merc = (mx0, my0, mx1, my1)

    total_tiles = 0
    total_bytes = 0
    for z in range(ZMIN, ZMAX + 1):
        res = merc_res(z, lat_c)
        n = 2 ** z
        world = 2 * math.pi * 6378137.0
        # tile indices covering merc bbox
        tx0 = int(math.floor((merc[0] + world / 2) / (world / n)))
        tx1 = int(math.floor((merc[2] + world / 2) / (world / n)))
        ty0 = int(math.floor((world / 2 - merc[3]) / (world / n)))
        ty1 = int(math.floor((world / 2 - merc[1]) / (world / n)))

        # downscale the whole merc raster to this zoom's resolution
        scale = dst_res / res
        if scale != 1.0:
            lw = max(1, int(round(w * scale)))
            lh = max(1, int(round(h * scale)))
            level = base.resize((lw, lh), Image.LANCZOS)
        else:
            lw, lh = w, h
            level = base

        # merc bbox of the downscaled raster (recompute from its pixel grid)
        lmx0, lmy1 = merc[0], merc[3]
        lres_x = (merc[2] - merc[0]) / lw
        lres_y = (merc[3] - merc[1]) / lh

        cnt = 0
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                lon0, lat0, lon1, lat1 = tile_bounds(tx, ty, z)
                tmx0, tmy0 = lonlat_to_merc(lon0, lat0)
                tmx1, tmy1 = lonlat_to_merc(lon1, lat1)

                px0 = (tmx0 - lmx0) / lres_x
                px1 = (tmx1 - lmx0) / lres_x
                py0 = (lmy1 - tmy1) / lres_y
                py1 = (lmy1 - tmy0) / lres_y

                ix0, ix1 = int(math.floor(px0)), int(math.ceil(px1))
                iy0, iy1 = int(math.floor(py0)), int(math.ceil(py1))
                if ix1 <= 0 or iy1 <= 0 or ix0 >= lw or iy0 >= lh:
                    continue

                cx0, cx1 = max(0, ix0), min(lw, ix1)
                cy0, cy1 = max(0, iy0), min(lh, iy1)
                if cx1 <= cx0 or cy1 <= cy0:
                    continue

                crop = level.crop((cx0, cy0, cx1, cy1))
                tw = max(1, ix1 - ix0)
                th = max(1, iy1 - iy0)
                crop = crop.resize((tw, th), Image.LANCZOS)

                canvas = Image.new("RGBa", (TILE, TILE), (0, 0, 0, 0))
                canvas.paste(crop, (cx0 - ix0, cy0 - iy0))
                out = canvas.convert("RGBA")

                d = os.path.join(OUT, str(z), str(tx))
                os.makedirs(d, exist_ok=True)
                p = os.path.join(d, f"{ty}.webp")
                out.save(p, "WEBP", quality=QUALITY, method=5)
                total_bytes += os.path.getsize(p)
                cnt += 1
                total_tiles += 1
        print(f"z{z}: {cnt} tiles  ({total_bytes/1e6:.1f} MB total)", flush=True)

    print(f"DONE tiles={total_tiles} bytes={total_bytes/1e6:.1f}MB", flush=True)


if __name__ == "__main__":
    main()
