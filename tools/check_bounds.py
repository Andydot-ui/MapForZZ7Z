"""Check GLB per-primitive bounds and LAZ low-z outliers."""
import json
import struct

import numpy as np
import laspy


def read_glb(path):
    with open(path, "rb") as f:
        magic, ver, length = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    return json.loads(chunks[0][1])


def glb_bounds(path):
    g = read_glb(path)
    cx, cy, cz = 743469.0, 3857681.0, 0.0
    rows = []
    for m in g["meshes"]:
        for p in m["primitives"]:
            acc = g["accessors"][p["attributes"]["POSITION"]]
            if "min" in acc:
                rows.append(acc["min"] + acc["max"])
    rows = np.array(rows)
    print("prims:", len(rows))
    print("x  min %.1f  max %.1f" % (rows[:, 0].min(), rows[:, 3].max()))
    print("y  min %.1f  max %.1f" % (rows[:, 1].min(), rows[:, 4].max()))
    print("z  min %.1f  max %.1f" % (rows[:, 2].min(), rows[:, 5].max()))
    # outliers: sort by y max descending, show top few
    order = np.argsort(rows[:, 4])[::-1]
    print("top y-max prims:", [(round(float(rows[i, 4]), 1), round(float(rows[i, 1]), 1)) for i in order[:8]])
    order = np.argsort(rows[:, 1])
    print("low y-min prims:", [(round(float(rows[i, 1]), 1), round(float(rows[i, 4]), 1)) for i in order[:8]])


def laz_lowz(path):
    las = laspy.read(path)
    z = np.asarray(las.z, dtype=np.float64)
    for t in (0, 50, 70, 80, 85, 88):
        print("z < %d : %d" % (t, int((z < t).sum())))
    x = np.asarray(las.x, dtype=np.float64)
    y = np.asarray(las.y, dtype=np.float64)
    print("x range %.2f .. %.2f  (rel %.2f .. %.2f)" % (x.min(), x.max(), x.min() - 743469, x.max() - 743469))
    print("y range %.2f .. %.2f  (rel %.2f .. %.2f)" % (y.min(), y.max(), y.min() - 3857681, y.max() - 3857681))
    ok = z >= 80
    print("kept %d / %d" % (ok.sum(), len(z)))
    print("kept x rel %.2f .. %.2f" % (x[ok].min() - 743469, x[ok].max() - 743469))
    print("kept y rel %.2f .. %.2f" % (y[ok].min() - 3857681, y[ok].max() - 3857681))
    print("kept z %.2f .. %.2f" % (z[ok].min(), z[ok].max()))


if __name__ == "__main__":
    glb_bounds(r"C:\Users\andyd\Downloads\三维.glb")
    print()
    laz_lowz(r"C:\Users\andyd\Downloads\三维.laz")
