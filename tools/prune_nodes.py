"""Remove point-cloud node files that are no longer referenced by octree.json."""
import glob
import json
import os

P = r"C:\Users\andyd\Documents\deepseek-harness\default-workspace\MapForZZ7Z\web\pointcloud"

meta = json.load(open(os.path.join(P, "octree.json")))["nodes"]
keep = {n + ".bin" for n in meta}
files = {os.path.basename(f) for f in glob.glob(os.path.join(P, "n", "*.bin"))}
stale = files - keep
print("meta nodes", len(meta), "files", len(files), "stale", len(stale))

removed = 0
for f in stale:
    fp = os.path.join(P, "n", f)
    removed += os.path.getsize(fp)
    os.remove(fp)
print("removed", round(removed / 1e6, 1), "MB")

left = glob.glob(os.path.join(P, "n", "*.bin"))
total = sum(os.path.getsize(f) for f in left)
print("remaining", len(left), "files", round(total / 1e6, 1), "MB")
