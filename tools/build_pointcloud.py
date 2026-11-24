"""Build a web-ready octree LOD point cloud from the georeferenced LAZ.

Output: web/pointcloud/octree.json + web/pointcloud/n/<node>.bin
Coordinates are stored relative to the RTC center used by the GLB so that
model + cloud + map all align in one scene.
"""
import json
import os
import struct

import numpy as np
import laspy

SRC = r"C:\Users\andyd\Downloads\-georeferenced_model.laz"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\pointcloud"

CENTER = (743487.0, 3857689.0, 0.0)
GRID = 704.0          # root cube side (metres); covers x[-370..334] y[-310..394] z[-76..628]
MINX = -370.0
MINY = -310.0
MINZ = -76.0
LEAF_LEVEL = 4        # levels 0..3 sample, level 4 keeps everything
SAMPLE_DIV = 128.0    # node keeps points on a grid of size/128
# 叶子层原来保留全部点，导致 49.5 MB —— 但渲染预算只有约 260 万点，
# 多出的点永远不会被画出来。按更粗的网格抽稀，体积减半而观感几乎不变。
LEAF_SAMPLE_DIV = 96.0


def main():
    os.makedirs(os.path.join(OUT, "n"), exist_ok=True)

    print("reading laz ...", flush=True)
    las = laspy.read(SRC)
    x = np.asarray(las.x, dtype=np.float64) - CENTER[0]
    y = np.asarray(las.y, dtype=np.float64) - CENTER[1]
    z = np.asarray(las.z, dtype=np.float64) - CENTER[2]

    rgb = np.empty((len(x), 3), dtype=np.uint8)
    for i, ch in enumerate(("red", "green", "blue")):
        c = np.asarray(las[ch], dtype=np.float64)
        if c.max() > 255:
            c = c / 257.0
        rgb[:, i] = np.clip(c, 0, 255).astype(np.uint8)
    print("points:", len(x), "rgb mean:", rgb.mean(axis=0), flush=True)

    minx = MINX
    miny = MINY
    minz = MINZ

    # --- octant path digits for every point (level 0..LEAF_LEVEL-1) ---
    size0 = GRID / (2 ** LEAF_LEVEL)
    ix = np.floor((x - minx) / size0).astype(np.int64)
    iy = np.floor((y - miny) / size0).astype(np.int64)
    iz = np.floor((z - minz) / size0).astype(np.int64)
    n = 2 ** LEAF_LEVEL
    ix = np.clip(ix, 0, n - 1)
    iy = np.clip(iy, 0, n - 1)
    iz = np.clip(iz, 0, n - 1)

    digits = np.empty((len(x), LEAF_LEVEL), dtype=np.uint8)
    for j in range(LEAF_LEVEL):
        shift = LEAF_LEVEL - 1 - j
        digits[:, j] = (
            ((ix >> shift) & 1)
            | (((iy >> shift) & 1) << 1)
            | (((iz >> shift) & 1) << 2)
        ).astype(np.uint8)

    nodes = {}
    alive = np.arange(len(x), dtype=np.int64)

    def node_id(level, path_code):
        """path_code packs digits[0:level] base 8."""
        s = "r"
        for j in range(level):
            s += str((path_code >> (3 * (level - 1 - j))) & 7)
        return s

    for level in range(LEAF_LEVEL):
        size = GRID / (2 ** level)
        s = size / SAMPLE_DIV
        cellx = np.floor((x[alive] - minx) / s).astype(np.int64)
        celly = np.floor((y[alive] - miny) / s).astype(np.int64)
        cellz = np.floor((z[alive] - minz) / s).astype(np.int64)
        ncell = int(2 ** level * SAMPLE_DIV)
        key = cellx + celly * ncell + cellz * (ncell * ncell)
        _, first = np.unique(key, return_index=True)
        sel = alive[first]

        # path code for the node this point belongs to
        if level == 0:
            code = np.zeros(len(sel), dtype=np.int64)
        else:
            code = np.zeros(len(sel), dtype=np.int64)
            for j in range(level):
                code = code * 8 + digits[sel, j]

        ids = {}
        for c in np.unique(code):
            nid = node_id(level, int(c))
            ids[int(c)] = nid
            nodes.setdefault(nid, {"level": level, "idx": np.empty(0, dtype=np.int64)})

        for c, nid in ids.items():
            m = code == c
            nodes[nid]["idx"] = np.concatenate([nodes[nid]["idx"], sel[m]])

        alive = np.delete(alive, first)
        print(f"level {level}: sampled {len(sel)} -> {len(ids)} nodes, {len(alive)} left", flush=True)

    # remaining points -> level LEAF_LEVEL leaves（按 LEAF_SAMPLE_DIV 抽稀）
    size_leaf = GRID / (2 ** LEAF_LEVEL)
    s_leaf = size_leaf / LEAF_SAMPLE_DIV
    cellx = np.floor((x[alive] - minx) / s_leaf).astype(np.int64)
    celly = np.floor((y[alive] - miny) / s_leaf).astype(np.int64)
    cellz = np.floor((z[alive] - minz) / s_leaf).astype(np.int64)
    ncell = int(2 ** LEAF_LEVEL * LEAF_SAMPLE_DIV)
    key = cellx + celly * ncell + cellz * (ncell * ncell)
    _, first = np.unique(key, return_index=True)
    alive = alive[first]

    code = np.zeros(len(alive), dtype=np.int64)
    for j in range(LEAF_LEVEL):
        code = code * 8 + digits[alive, j]
    for c in np.unique(code):
        nid = node_id(LEAF_LEVEL, int(c))
        nodes.setdefault(nid, {"level": LEAF_LEVEL, "idx": np.empty(0, dtype=np.int64)})
        nodes[nid]["idx"] = np.concatenate([nodes[nid]["idx"], alive[code == c]])
    print(f"leaves: {len(np.unique(code))} nodes", flush=True)

    # --- write node files ---
    meta = {}
    total_written = 0
    for nid, info in sorted(nodes.items()):
        idx = info["idx"]
        if len(idx) == 0:
            continue
        level = info["level"]
        size = GRID / (2 ** level)
        # recover node origin from id digits: digit j selects a half of the
        # remaining span, so the step is GRID / 2**(j+1)
        ox, oy, oz = minx, miny, minz
        for j, ch in enumerate(nid[1:]):
            o = int(ch)
            st = GRID / (2 ** (j + 1))
            if o & 1:
                ox += st
            if o & 2:
                oy += st
            if o & 4:
                oz += st

        px = (x[idx] - ox) / size
        py = (y[idx] - oy) / size
        pz = (z[idx] - oz) / size
        qx = np.clip(px * 65535.0, 0, 65535).astype(np.uint16)
        qy = np.clip(py * 65535.0, 0, 65535).astype(np.uint16)
        qz = np.clip(pz * 65535.0, 0, 65535).astype(np.uint16)

        buf = np.empty((len(idx), 9), dtype=np.uint8)
        buf[:, 0:2] = qx.reshape(-1, 1).view(np.uint8).reshape(-1, 2)
        buf[:, 2:4] = qy.reshape(-1, 1).view(np.uint8).reshape(-1, 2)
        buf[:, 4:6] = qz.reshape(-1, 1).view(np.uint8).reshape(-1, 2)
        buf[:, 6:9] = rgb[idx]

        path = os.path.join(OUT, "n", nid + ".bin")
        with open(path, "wb") as f:
            f.write(struct.pack("<I", len(idx)))
            f.write(buf.tobytes())
        total_written += len(idx)

        meta[nid] = {
            "level": level,
            "count": int(len(idx)),
            "bbox": [ox, oy, oz, ox + size, oy + size, oz + size],
            "bytes": int(9 * len(idx) + 4),
        }

    # children links
    for nid in meta:
        meta[nid]["children"] = [
            nid + str(k) for k in range(8) if (nid + str(k)) in meta
        ]
    meta["r"]["children"] = [c for c in meta["r"]["children"] if c in meta]

    doc = {
        "version": 1,
        "center": list(CENTER),
        "grid": GRID,
        "levels": LEAF_LEVEL,
        "points": int(total_written),
        "bbox": [minx, miny, minz, minx + GRID, miny + GRID, minz + GRID],
        "nodes": meta,
    }
    with open(os.path.join(OUT, "octree.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))

    size_bytes = sum(m["bytes"] for m in meta.values())
    print(f"nodes: {len(meta)}  points: {total_written}  total: {size_bytes/1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
