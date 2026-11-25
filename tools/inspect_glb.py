"""Inspect a GLB: extensions, RTC center, images, primitives, accessors."""
import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as f:
        magic, ver, length = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67, "not a glb"
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack("<II", f.read(8))
            data = f.read(clen)
            chunks.append((ctype, data))
    return json.loads(chunks[0][1]), chunks[1][1], chunks


def main(path):
    g, binbuf, _ = read_glb(path)
    print("asset:", g.get("asset"))
    print("extensionsUsed:", g.get("extensionsUsed"))
    print("extensionsRequired:", g.get("extensionsRequired"))
    print("counts: meshes=%d prims=%d mats=%d images=%d nodes=%d accessors=%d bv=%d"
          % (len(g.get("meshes", [])), sum(len(m["primitives"]) for m in g.get("meshes", [])),
             len(g.get("materials", [])), len(g.get("images", [])), len(g.get("nodes", [])),
             len(g.get("accessors", [])), len(g.get("bufferViews", []))))

    for k in ("extensions", "extras"):
        if k in g:
            print(k + ":", json.dumps(g[k])[:500])

    # RTC center may live at scene / node / mesh level
    for i, n in enumerate(g.get("nodes", [])):
        ex = n.get("extensions") or {}
        if "CESIUM_RTC" in ex:
            print("node %d RTC:" % i, ex["CESIUM_RTC"])
            print("node %d matrix:" % i, n.get("matrix"))
            print("node %d translation:" % i, n.get("translation"))
    for i, m in enumerate(g.get("meshes", [])):
        ex = m.get("extensions") or {}
        if "CESIUM_RTC" in ex:
            print("mesh %d RTC:" % i, ex["CESIUM_RTC"])
    if "scenes" in g:
        print("scenes:", json.dumps(g["scenes"])[:300])

    # triangle count
    tris = 0
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            if "indices" in p:
                tris += g["accessors"][p["indices"]]["count"] // 3
            else:
                tris += g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
    print("triangles:", tris)

    # position bounds across all primitives
    lo = [1e18] * 3
    hi = [-1e18] * 3
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            acc = g["accessors"][p["attributes"]["POSITION"]]
            if "min" in acc and "max" in acc:
                for j in range(3):
                    lo[j] = min(lo[j], acc["min"][j])
                    hi[j] = max(hi[j], acc["max"][j])
    print("position bounds (RTC-relative):", [round(v, 2) for v in lo], [round(v, 2) for v in hi])

    # image payload sizes
    tot = 0
    for i, img in enumerate(g.get("images", [])):
        bv = g["bufferViews"][img["bufferView"]]
        tot += bv["byteLength"]
    print("image payload total: %.1f MB" % (tot / 1e6))
    print("bin chunk: %.1f MB" % (len(binbuf) / 1e6))

    # image dimensions via JPEG/PNG header
    for i, img in enumerate(g.get("images", [])[:60]):
        bv = g["bufferViews"][img["bufferView"]]
        off = bv.get("byteOffset", 0)
        raw = binbuf[off:off + 64]
        dims = jpeg_dims(raw)
        print("  img%d mime=%s %s %.2f MB" % (i, img.get("mimeType"), dims, bv["byteLength"] / 1e6))


def jpeg_dims(raw):
    if raw[:2] == b"\xff\xd8":
        i = 2
        while i < len(raw) - 9:
            if raw[i] != 0xFF:
                i += 1
                continue
            marker = raw[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                h, w = struct.unpack(">HH", raw[i + 5:i + 9])
                return "%dx%d" % (w, h)
            i += 2 + struct.unpack(">H", raw[i + 2:i + 4])[0]
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", raw[16:24])
        return "%dx%d" % (w, h)
    return "?"


if __name__ == "__main__":
    main(sys.argv[1])
