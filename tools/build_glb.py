"""Shrink the GLB textures for web delivery without touching geometry.

Geometry stays Draco-compressed; only the JPEG payloads are replaced by
downscaled / re-compressed versions, then the buffer is rebuilt.
"""
import io
import json
import os
import struct
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SRC = r"C:\Users\andyd\Downloads\三维.glb"
OUT = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\models\textured_model.glb"

MAX_TEX = 1024          # 8192² 图集压到 1024²：每块覆盖约 100 m，≈10 cm/px
QUALITY = 82


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


def main():
    gltf, binbuf, chunks = read_glb(SRC)
    print("images", len(gltf["images"]), "bufferViews", len(gltf["bufferViews"]), flush=True)

    new_images = {}
    total_before = 0
    total_after = 0
    for i, img in enumerate(gltf["images"]):
        bv = gltf["bufferViews"][img["bufferView"]]
        off = bv.get("byteOffset", 0)
        raw = binbuf[off:off + bv["byteLength"]]
        total_before += len(raw)
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGB") if im.mode != "RGB" else im
        w, h = im.size
        if max(w, h) > MAX_TEX:
            ratio = MAX_TEX / max(w, h)
            nw = max(64, int(round(w * ratio)))
            nh = max(64, int(round(h * ratio)))
            im = im.resize((nw, nh), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=QUALITY, optimize=True, progressive=False)
        out = buf.getvalue()
        new_images[i] = out
        total_after += len(out)
        if i % 8 == 0 or max(w, h) > 4096:
            print(f"  img{i}: {w}x{h} -> {im.size[0]}x{im.size[1]}  "
                  f"{len(raw)/1e6:.2f} -> {len(out)/1e6:.2f} MB", flush=True)

    print(f"textures {total_before/1e6:.1f} -> {total_after/1e6:.1f} MB", flush=True)

    # --- rebuild buffer, preserving every non-image bufferView byte-for-byte ---
    out_bin = bytearray()
    img_bv = {img["bufferView"] for img in gltf["images"]}
    bv_to_img = {img["bufferView"]: i for i, img in enumerate(gltf["images"])}

    for bi, bv in enumerate(gltf["bufferViews"]):
        while len(out_bin) % 4:
            out_bin.append(0)
        if bi in img_bv:
            payload = new_images[bv_to_img[bi]]
        else:
            off = bv.get("byteOffset", 0)
            payload = binbuf[off:off + bv["byteLength"]]
        bv["byteOffset"] = len(out_bin)
        bv["byteLength"] = len(payload)
        out_bin.extend(payload)

    gltf["buffers"] = [{"byteLength": len(out_bin)}]
    gltf.pop("uri", None)

    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "
    binlen = len(out_bin)
    while binlen % 4:
        out_bin.append(0)
        binlen += 1

    total = 12 + 8 + len(js) + 8 + binlen
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", binlen, 0x004E4942))
        f.write(out_bin)

    print(f"GLB: {total/1e6:.2f} MB -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
