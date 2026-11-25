"""List real pixel dimensions of every texture inside a GLB."""
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    with open(path, "rb") as f:
        magic, ver, length = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    return json.loads(chunks[0][1]), chunks[1][1]


def main(path):
    g, binbuf = read_glb(path)
    total = 0
    dims = []
    for i, img in enumerate(g["images"]):
        bv = g["bufferViews"][img["bufferView"]]
        off = bv.get("byteOffset", 0)
        raw = binbuf[off:off + bv["byteLength"]]
        total += len(raw)
        try:
            im = Image.open(io.BytesIO(raw))
            dims.append((i, im.size, len(raw), im.mode))
        except Exception as e:
            dims.append((i, ("?", "?"), len(raw), str(e)))
    print("images:", len(dims), "total %.1f MB" % (total / 1e6))
    sizes = {}
    for i, sz, n, mode in dims:
        sizes[sz] = sizes.get(sz, 0) + 1
    print("distinct sizes:", sizes)
    for i, sz, n, mode in dims[:12]:
        print("  img%d %s %s %.2f MB" % (i, sz, mode, n / 1e6))
    big = [d for d in dims if isinstance(d[1][0], int) and max(d[1]) > 2048]
    print("images > 2048:", len(big))


if __name__ == "__main__":
    main(sys.argv[1])
