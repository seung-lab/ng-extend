"""Read only: the supervoxel and current root under each reviewed coordinate.

A practice cell is pinned by one supervoxel on each side of its join. People
hand us viewer coordinates (config/practice-inspect-coords.json); only the
volume can say which supervoxel sits there. Nothing is written anywhere.
"""
import json, os, sys
from cloudvolume import CloudVolume

token = os.environ["CAVE_SERVICE_TOKEN"]
cfg = json.load(open(os.path.join(os.path.dirname(__file__), "..", "config", "practice-inspect-coords.json")))
for name, fx in cfg.items():
    if fx["pcg_server"] != "https://minnie.microns-daf.com" or fx["pcg_table"] != "pinky_nf_v2":
        sys.exit("Unapproved sandbox")
    cv = CloudVolume(f"graphene://{fx['pcg_server']}/segmentation/table/{fx['pcg_table']}",
                     use_https=True, secrets={"token": token}, progress=False, fill_missing=True)
    print(json.dumps({"coords": name, "resolution": [int(v) for v in cv.resolution], "bounds": str(cv.bounds)}))
    for label, (x, y, z) in fx["points"].items():
        sv = int(cv[x:x + 1, y:y + 1, z:z + 1][0, 0, 0, 0])
        root = int(cv.get_roots([sv])[0]) if sv else 0
        print(json.dumps({"coords": name, "point": label, "xyz": [x, y, z], "supervoxel": str(sv), "root": str(root)}))
