"""Report the new LAZ: CRS, extent, z distribution, colour range."""
import numpy as np
import laspy

NEW = r"C:\Users\andyd\Downloads\三维.laz"


def main():
    las = laspy.read(NEW)
    print("points:", len(las.points), "version:", las.header.version,
          "pdrf:", las.header.point_format.id, flush=True)
    print("scales:", las.header.scales, "offsets:", las.header.offsets, flush=True)
    try:
        print("crs:", las.header.parse_crs(), flush=True)
    except Exception as e:
        print("crs error:", e, flush=True)

    x = np.asarray(las.x, dtype=np.float64)
    y = np.asarray(las.y, dtype=np.float64)
    z = np.asarray(las.z, dtype=np.float64)
    for name, a in (("x", x), ("y", y), ("z", z)):
        q = np.percentile(a, [0.01, 0.1, 1, 50, 99, 99.9, 99.99])
        print("  %s min=%.2f p0.01=%.2f p0.1=%.2f p1=%.2f med=%.2f p99=%.2f p99.9=%.2f p99.99=%.2f max=%.2f"
              % (name, a.min(), *q, a.max()), flush=True)

    print("  dims:", list(las.point_format.dimension_names), flush=True)

    for ch in ("red", "green", "blue"):
        if ch in las.point_format.dimension_names:
            c = np.asarray(las[ch])
            print("  %s: min=%d max=%d mean=%.1f" % (ch, c.min(), c.max(), c.mean()), flush=True)
        else:
            print("  no", ch, flush=True)

    if "classification" in las.point_format.dimension_names:
        cls, cnt = np.unique(np.asarray(las.classification), return_counts=True)
        print("  classification:", dict(zip(cls.tolist(), cnt.tolist())), flush=True)

    # how many points are above the GLB's z floor (88.81 relative => absolute?)
    print("  z<0 count: %d (%.2f%%)" % ((z < 0).sum(), (z < 0).mean() * 100), flush=True)


if __name__ == "__main__":
    main()
