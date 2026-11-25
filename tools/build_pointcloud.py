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

SRC = r"C:\Users\andyd\Downloads\三维.laz"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\pointcloud"

# 与新 GLB 的 CESIUM_RTC 中心一致，模型与点云才能对齐。
CENTER = (743469.0, 3857681.0, 0.0)

# 根立方体必须包住全部点：x[-470..467] y[-549..549] z[86..149]。
# MINZ=70 让 86..149 整段落在同一层叶子（叶边长 80 m），叶子节点数减半。
GRID = 1280.0
MINX = -640.0
MINY = -640.0
MINZ = 70.0

LEAF_LEVEL = 4         # 0..3 层采样，第 4 层保留全部（抽稀后）
SAMPLE_DIV = 128.0     # 每个节点按 size/128 的网格抽稀
# 叶子层 80 m 边长，按 80 细分 → 1.0 m 一格，全区约 150 万点、13 MB。
LEAF_SAMPLE_DIV = 80.0

Z_MIN_KEEP = 80.0      # 丢掉低于此值的零星噪声点（LAZ 里有 706 个 <80 的异常点）


def main():
    os.makedirs(os.path.join(OUT, "n"), exist_ok=True)

    print("reading laz ...", flush=True)
    las = laspy.read(SRC)
    x = (np.asarray(las.x, dtype=np.float64) - CENTER[0]).astype(np.float32)
    y = (np.asarray(las.y, dtype=np.float64) - CENTER[1]).astype(np.float32)
    z = (np.asarray(las.z, dtype=np.float64) - CENTER[2]).astype(np.float32)

    rgb = np.empty((len(x), 3), dtype=np.uint8)
    for i, ch in enumerate(("red", "green", "blue")):
        c = np.asarray(las[ch], dtype=np.float64)
        if c.max() > 255:
            c = c / 257.0
        rgb[:, i] = np.clip(c, 0, 255).astype(np.uint8)
    del las

    keep = z >= Z_MIN_KEEP
    x, y, z, rgb = x[keep], y[keep], z[keep], rgb[keep]
    print("points: %d (kept %d)" % (len(x), int(keep.sum())), flush=True)
    print("rel bounds x %.1f..%.1f  y %.1f..%.1f  z %.1f..%.1f"
          % (x.min(), x.max(), y.min(), y.max(), z.min(), z.max()), flush=True)
    assert x.min() >= MINX and x.max() <= MINX + GRID, "x outside root cube"
    assert y.min() >= MINY and y.max() <= MINY + GRID, "y outside root cube"
    assert z.min() >= MINZ and z.max() <= MINZ + GRID, "z outside root cube"

    # --- octant path digits for every point (level 0..LEAF_LEVEL-1) ---
    size0 = GRID / (2 ** LEAF_LEVEL)
    ix = np.clip(np.floor((x - MINX) / size0).astype(np.int64), 0, 2 ** LEAF_LEVEL - 1)
    iy = np.clip(np.floor((y - MINY) / size0).astype(np.int64), 0, 2 ** LEAF_LEVEL - 1)
    iz = np.clip(np.floor((z - MINZ) / size0).astype(np.int64), 0, 2 ** LEAF_LEVEL - 1)

    digits = np.empty((len(x), LEAF_LEVEL), dtype=np.uint8)
    for j in range(LEAF_LEVEL):
        shift = LEAF_LEVEL - 1 - j
        digits[:, j] = (
            ((ix >> shift) & 1)
            | (((iy >> shift) & 1) << 1)
            | (((iz >> shift) & 1) << 2)
        ).astype(np.uint8)
    del ix, iy, iz

    nodes = {}
    alive = np.arange(len(x), dtype=np.int64)

    def node_id(level, code):
        s = "r"
        for j in range(level):
            s += str((code >> (3 * (level - 1 - j))) & 7)
        return s

    def split_by_key(keys):
        """把 keys 排序后按等值切成若干段，返回每段的 [start,end)。"""
        order = np.argsort(keys, kind="stable")
        ks = keys[order]
        starts = np.concatenate(([0], np.nonzero(np.diff(ks))[0] + 1))
        ends = np.concatenate((starts[1:], [len(ks)]))
        return order, ks, starts, ends

    for level in range(LEAF_LEVEL):
        size = GRID / (2 ** level)
        s = size / SAMPLE_DIV
        cellx = np.floor((x[alive] - MINX) / s).astype(np.int64)
        celly = np.floor((y[alive] - MINY) / s).astype(np.int64)
        cellz = np.floor((z[alive] - MINZ) / s).astype(np.int64)
        ncell = int(2 ** level * SAMPLE_DIV)
        key = cellx + celly * ncell + cellz * (ncell * ncell)
        del cellx, celly, cellz

        order, _, starts, ends = split_by_key(key)
        first = order[starts]
        sel = alive[first]
        del key, order

        code = np.zeros(len(sel), dtype=np.int64)
        for j in range(level):
            code = code * 8 + digits[sel, j]

        corder, cks, cstarts, cends = split_by_key(code)
        for st, en in zip(cstarts, cends):
            nid = node_id(level, int(cks[st]))
            nodes.setdefault(nid, {"level": level, "idx": np.empty(0, dtype=np.int64)})
            nodes[nid]["idx"] = np.concatenate([nodes[nid]["idx"], sel[corder[st:en]]])
        del code, corder, cks

        mask = np.ones(len(alive), dtype=bool)
        mask[first] = False
        alive = alive[mask]
        print("level %d: sampled %d -> %d nodes, %d left"
              % (level, len(sel), len(cstarts), len(alive)), flush=True)

    # remaining points -> level LEAF_LEVEL leaves（按 LEAF_SAMPLE_DIV 抽稀）
    size_leaf = GRID / (2 ** LEAF_LEVEL)
    s_leaf = size_leaf / LEAF_SAMPLE_DIV
    cellx = np.floor((x[alive] - MINX) / s_leaf).astype(np.int64)
    celly = np.floor((y[alive] - MINY) / s_leaf).astype(np.int64)
    cellz = np.floor((z[alive] - MINZ) / s_leaf).astype(np.int64)
    ncell = int(2 ** LEAF_LEVEL * LEAF_SAMPLE_DIV)
    key = cellx + celly * ncell + cellz * (ncell * ncell)
    del cellx, celly, cellz

    order, _, starts, _ = split_by_key(key)
    alive = alive[order[starts]]
    del key, order

    code = np.zeros(len(alive), dtype=np.int64)
    for j in range(LEAF_LEVEL):
        code = code * 8 + digits[alive, j]
    corder, cks, cstarts, cends = split_by_key(code)
    for st, en in zip(cstarts, cends):
        nid = node_id(LEAF_LEVEL, int(cks[st]))
        nodes.setdefault(nid, {"level": LEAF_LEVEL, "idx": np.empty(0, dtype=np.int64)})
        nodes[nid]["idx"] = np.concatenate([nodes[nid]["idx"], alive[corder[st:en]]])
    print("leaves: %d nodes" % len(cstarts), flush=True)
    del digits, code, corder, cks, alive

    # --- write node files ---
    meta = {}
    total_written = 0
    biggest = 0
    for nid, info in sorted(nodes.items()):
        idx = info["idx"]
        if len(idx) == 0:
            continue
        level = info["level"]
        size = GRID / (2 ** level)
        ox, oy, oz = MINX, MINY, MINZ
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
        biggest = max(biggest, 9 * len(idx) + 4)

        meta[nid] = {
            "level": level,
            "count": int(len(idx)),
            "bbox": [ox, oy, oz, ox + size, oy + size, oz + size],
            "bytes": int(9 * len(idx) + 4),
        }

    for nid in meta:
        meta[nid]["children"] = [nid + str(k) for k in range(8) if (nid + str(k)) in meta]

    doc = {
        "version": 1,
        "center": list(CENTER),
        "grid": GRID,
        "levels": LEAF_LEVEL,
        "points": int(total_written),
        "bbox": [MINX, MINY, MINZ, MINX + GRID, MINY + GRID, MINZ + GRID],
        "nodes": meta,
    }
    with open(os.path.join(OUT, "octree.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))

    size_bytes = sum(m["bytes"] for m in meta.values())
    print("nodes: %d  points: %d  total: %.1f MB  biggest node: %.2f MB"
          % (len(meta), total_written, size_bytes / 1e6, biggest / 1e6), flush=True)


if __name__ == "__main__":
    main()
