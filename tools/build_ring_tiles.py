"""Generate fully transparent "ring" tiles around the raster footprint.

MapLibre requests the tiles that merely touch the source `bounds`, so at every
zoom level one ring of tiles just outside the imagery gets fetched and 404s.
Writing a transparent tile for that ring keeps the console clean and lets the
raster edge fade out instead of hitting a missing file.
"""
import io
import math
import os

from PIL import Image

OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\tiles"

ZMIN, ZMAX = 15, 21
TILE = 256
R = 6378137.0
WORLD = 2 * math.pi * R

# 与 build_tiles.py 输出的墨卡托外包框一致
MX0, MY0 = 12652494.657460213, 4140748.97458676
MX1, MY1 = 12653201.969552495, 4141489.8785031163


def tile_range(z):
    n = 2 ** z
    tsz = WORLD / n
    tx0 = int(math.floor((MX0 + WORLD / 2) / tsz))
    tx1 = int(math.floor((MX1 + WORLD / 2) / tsz))
    ty0 = int(math.floor((WORLD / 2 - MY1) / tsz))
    ty1 = int(math.floor((WORLD / 2 - MY0) / tsz))
    return tx0, tx1, ty0, ty1


def main():
    buf = io.BytesIO()
    Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0)).save(buf, "WEBP", quality=0, method=0)
    blank = buf.getvalue()

    total = 0
    for z in range(ZMIN, ZMAX + 1):
        tx0, tx1, ty0, ty1 = tile_range(z)
        written = 0
        for ty in range(ty0 - 1, ty1 + 2):
            for tx in range(tx0 - 1, tx1 + 2):
                inside = tx0 <= tx <= tx1 and ty0 <= ty <= ty1
                if inside:
                    continue
                d = os.path.join(OUT, str(z), str(tx))
                p = os.path.join(d, f"{ty}.webp")
                if os.path.exists(p):
                    continue
                os.makedirs(d, exist_ok=True)
                with open(p, "wb") as f:
                    f.write(blank)
                written += 1
        total += written
        print(f"z{z}: ring tiles +{written}", flush=True)

    print(f"DONE ring={total}", flush=True)


if __name__ == "__main__":
    main()
