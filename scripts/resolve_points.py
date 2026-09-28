#!/usr/bin/env python3
"""Resolve voxel points to (supervoxel, root) in a graphene segmentation.

Used by scripts/sync-sheet-cells.mjs for sheets that list cells by their
starting coordinates instead of a segment ID (MEC, Ames 2026-09-28).

    python scripts/resolve_points.py <graphene cloudpath> <resolution x,y,z> < points.json > resolved.json

stdin:  [[x, y, z], ...] in voxels at <resolution>
stdout: [{"point": [x, y, z], "sv": "123", "root": "456"}, ...]  sv/root "0"
        when the point is outside every segment.
Token: CAVE_SERVICE_TOKEN (falls back to ~/.cloudvolume/secrets for local runs).
"""
import json
import os
import sys

from cloudvolume import CloudVolume


def main():
    cloudpath, res = sys.argv[1], [float(v) for v in sys.argv[2].split(',')]
    points = json.load(sys.stdin)
    token = os.environ.get('CAVE_SERVICE_TOKEN') or None
    cv = CloudVolume(cloudpath, use_https=True, progress=False, fill_missing=True,
                     **({'secrets': token} if token else {}))
    svs = []
    for x, y, z in points:
        v = cv.download_point((int(x), int(y), int(z)), size=1, agglomerate=False, coord_resolution=res)
        svs.append(int(v.flatten()[0]))
    nonzero = [s for s in svs if s]
    roots = dict(zip(nonzero, (int(r) for r in cv.get_roots(nonzero)))) if nonzero else {}
    json.dump([{'point': p, 'sv': str(s), 'root': str(roots.get(s, 0))} for p, s in zip(points, svs)], sys.stdout)


if __name__ == '__main__':
    main()
