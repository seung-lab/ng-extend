#!/usr/bin/env python3
"""Resolve voxel points to (supervoxel, root) in a graphene segmentation.

Used by scripts/sync-sheet-cells.mjs for sheets that list cells by their
starting coordinates instead of a segment ID (MEC, Ames 2026-09-28).

    python scripts/resolve_points.py <graphene cloudpath> <resolution x,y,z> [--nucleus] < points.json > resolved.json

stdin:  [[x, y, z], ...] in voxels at <resolution>
stdout: [{"point": [x, y, z], "sv": "123", "root": "456"}, ...]; sv/root "0"
        when the point is outside every segment.

--nucleus: the points sit inside nuclei, and in MEC the nucleus is its own
segment, separate from the cell body around it (Ames 2026-09-29). For each
point also find the cell: the segment covering most of a thin ring just
outside the nucleus boundary, on three z planes at the coarsest mip. Adds
"nucleus" (the root at the point), "share" (fraction of the ring the cell
covers) and, when a cell is found, replaces sv/root with a supervoxel and
root of the CELL. A cell covering under MIN_SHARE of the ring is not
trusted: the entry keeps the nucleus and gets "cell": null.

Token: CAVE_SERVICE_TOKEN (falls back to ~/.cloudvolume/secrets for local runs).
"""
import json
import os
import sys
from collections import Counter

import numpy as np
from cloudvolume import CloudVolume

MIN_SHARE = 0.6
RING_HALF = 160          # cutout half width, coarsest-mip pixels (64 nm: ~20 um)
RING_Z = (-10, 0, 10)    # z planes around the point, in voxels
RING_PX = 4              # ring thickness, coarsest-mip pixels


def cell_around(cv, cv_agg, cv_sv, mip, point, nucleus_root):
    from scipy import ndimage
    scale = [int(cv.meta.resolution(mip)[i] // cv.meta.resolution(0)[i]) for i in (0, 1)]
    cx, cy = point[0] // scale[0], point[1] // scale[1]
    votes, svs_by_root = Counter(), {}
    for dz in RING_Z:
        z = point[2] + dz
        box = np.s_[cx - RING_HALF:cx + RING_HALF, cy - RING_HALF:cy + RING_HALF, z:z + 1]
        roots = np.asarray(cv_agg[box])[:, :, 0, 0]
        mask = roots == nucleus_root
        if not mask.any():
            continue
        ring = ndimage.binary_dilation(mask, iterations=RING_PX) & ~mask & (roots != 0)
        if not ring.any():
            continue
        votes.update(roots[ring].tolist())
        svs = np.asarray(cv_sv[box])[:, :, 0, 0]
        for r, s in zip(roots[ring].tolist(), svs[ring].tolist()):
            if s:
                svs_by_root.setdefault(r, Counter())[s] += 1
    total = sum(votes.values())
    if not total:
        return None, 0.0, None
    root, n = votes.most_common(1)[0]
    share = n / total
    sv = svs_by_root.get(root, Counter()).most_common(1)
    return (root if share >= MIN_SHARE else None), round(share, 3), (sv[0][0] if sv else None)


def main():
    cloudpath, res = sys.argv[1], [float(v) for v in sys.argv[2].split(',')]
    nucleus = '--nucleus' in sys.argv[3:]
    points = json.load(sys.stdin)
    token = os.environ.get('CAVE_SERVICE_TOKEN') or None
    kw = dict(use_https=True, progress=False, fill_missing=True, **({'secrets': token} if token else {}))
    cv = CloudVolume(cloudpath, **kw)
    svs = []
    for x, y, z in points:
        try:
            v = cv.download_point((int(x), int(y), int(z)), size=1, agglomerate=False, coord_resolution=res)
            svs.append(int(v.flatten()[0]))
        except Exception as e:  # outside the volume: no cell here
            print(f'[resolve] {[x, y, z]}: {type(e).__name__}', file=sys.stderr)
            svs.append(0)
    nonzero = [s for s in svs if s]
    roots = dict(zip(nonzero, (int(r) for r in cv.get_roots(nonzero)))) if nonzero else {}
    out = [{'point': p, 'sv': str(s), 'root': str(roots.get(s, 0))} for p, s in zip(points, svs)]
    if nucleus:
        mip = len(cv.info['scales']) - 1
        # bounded=False: a ring near the volume edge reads empty beyond it.
        cv_agg = CloudVolume(cloudpath, mip=mip, agglomerate=True, bounded=False, **kw)
        cv_sv = CloudVolume(cloudpath, mip=mip, agglomerate=False, bounded=False, **kw)
        for o in out:
            o['nucleus'] = o['root']
            o['cell'] = None
            o['share'] = 0.0
            if o['root'] == '0':
                continue
            cell, share, cell_sv = cell_around(cv, cv_agg, cv_sv, mip, [int(v) for v in o['point']], int(o['root']))
            o['share'] = share
            if cell and cell_sv:
                o['cell'] = str(cell)
                o['sv'], o['root'] = str(cell_sv), str(cell)
            print(f"[resolve] {o['point']}: nucleus {o['nucleus']} cell {o['cell']} ({share:.0%} of the ring)", file=sys.stderr)
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
