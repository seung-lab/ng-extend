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
    # Viewer coordinates are in the view's own voxels (4 x 4 x 40 nm for
    # pinky); the stored volume can be coarser (8 x 8 x 40), so convert.
    view = fx.get("view_resolution", [4, 4, 40])
    for label, pt in fx["points"].items():
        x, y, z = [int(float(pt[i]) * view[i] // int(cv.resolution[i])) for i in range(3)]
        sv = int(cv[x:x + 1, y:y + 1, z:z + 1][0, 0, 0, 0])
        at = None
        if fx.get("at"):
            import datetime
            at = datetime.datetime.fromisoformat(fx["at"].replace("Z", "+00:00"))
        root = int(cv.get_roots([sv], timestamp=at)[0]) if sv else 0
        print(json.dumps({"coords": name, "point": label, "viewer_xyz": pt, "volume_xyz": [x, y, z], "supervoxel": str(sv), "root": str(root)}))
