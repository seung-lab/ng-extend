"""Build src/data/retina-cast.ts, the Cell Library's Cast tab: one example
cell of each retinal type (Ames 2026-10-24).

    python scripts/retina-cast/build_data.py <cast_types.csv> <current_roots.csv> <meshes_cast_v2 dir>

The cast CSV and meshes come from D:\Meshes\retina\film_proofread (fetch_cast.py);
current_roots.csv maps each proofread cell to its soma supervoxel.

No root ids are written: roots change whenever anyone edits. Each type keeps
its soma SUPERVOXEL, which never changes, and Pyr asks the chunked graph for
the root holding it when the type is opened. This script checks, today, that
every supervoxel still resolves and that the cell's mesh reaches within 10 um
of its soma (the check that caught 33 wrong cast cells on 2026-10-22).
"""
import json, os, sys, warnings
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd, trimesh, caveclient

cast_csv, roots_csv, mesh_dir = sys.argv[1:4]
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'data', 'retina-cast.ts')

cast = pd.read_csv(cast_csv, dtype={'example_root': str})
sv = pd.read_csv(roots_csv, dtype=str)[['root_now', 'supervoxel']].drop_duplicates('root_now')
cast = cast.merge(sv, left_on='example_root', right_on='root_now', how='left')
assert cast.supervoxel.notna().all(), 'a cast cell has no soma supervoxel'

index = json.load(open(os.path.join(mesh_dir, 'index.json')))
mesh_of = {c['root']: c['k'] for c in index['cells']}

c = caveclient.CAVEclient('stroeh_mouse_retina')
now = np.asarray(c.chunkedgraph.get_roots(cast.supervoxel.astype(np.uint64).to_numpy()), dtype=np.uint64).astype(str)
cast['root_today'] = now

cv = None
rows, problems = [], []

# Small thumbnails for the list (Ames 2026-10-24). Bipolar and horizontal
# cells stand upright in the sheet, so they are drawn from the side (z up,
# as the 3D view's Side shows them); the rest from above.
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
COLOR = {'BC': (0.96, 0.72, 0.29), 'HC': (0.71, 0.55, 1.0), 'AC': (1.0, 0.37, 0.69), 'RGC': (0.24, 0.59, 0.94)}
import tempfile
thumb_dir = tempfile.mkdtemp()
sprite_out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'images', 'retina-cast-thumbs.png')
THUMB, COLS = 96, 12

def thumb(v, f, cls, path, px=96):
    side = cls in ('BC', 'HC')
    # Screen x, screen y (up), depth toward the viewer.
    P = np.c_[v[:, 0], v[:, 2], v[:, 1]] if side else np.c_[v[:, 0], -v[:, 1], v[:, 2]]
    if len(f) > 300000:
        f = f[np.random.default_rng(0).choice(len(f), 300000, replace=False)]
    tri = P[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    shade = 0.55 + 0.45 * np.abs(n @ np.array([0.3, 0.5, 0.81]))
    order = np.argsort(tri[:, :, 2].mean(1))
    cols = np.clip(np.outer(shade[order], COLOR[cls]), 0, 1)
    lo, hi = P[:, :2].min(0), P[:, :2].max(0)
    c, r = (lo + hi) / 2, (hi - lo).max() / 2 * 1.06
    fig = plt.figure(figsize=(1, 1), dpi=px)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_axis_off()
    ax.add_collection(PolyCollection(tri[order][:, :, :2], facecolors=cols, edgecolors=cols, linewidths=0.2))
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_aspect('equal')
    fig.savefig(path, transparent=True); plt.close(fig)
for r in cast.itertuples():
    soma = np.array([r.soma_x_um, r.soma_y_um, r.soma_z_um])
    v = None
    if r.root_today == r.example_root and r.example_root in mesh_of:
        m = trimesh.load(os.path.join(mesh_dir, f"{mesh_of[r.example_root]}.glb"), force='mesh')
        v, f = np.asarray(m.vertices), np.asarray(m.faces)
        # A local file can be stale (A2's was another cell, 2026-10-24); then
        # measure from the server like an edited cell.
        if np.min(np.linalg.norm(v - soma, axis=1)) > 10:
            v = None
    if v is None:
        if cv is None:
            import cloudvolume
            cv = cloudvolume.CloudVolume(c.info.segmentation_source(), use_https=True, progress=False, secrets=c.auth.token)
        mm = cv.mesh.get(int(r.root_today), fuse=True)
        mm = mm[int(r.root_today)] if isinstance(mm, dict) else mm
        v, f = np.asarray(mm.vertices) / 1000.0, np.asarray(mm.faces)
    near = float(np.min(np.linalg.norm(v - soma, axis=1)))
    if r.root_today == '0' or near > 10:
        problems.append(f"{r.type}: root {r.root_today}, nearest mesh point {near:.1f} um from the soma")
    lo, hi = v.min(0), v.max(0)
    thumb(v, f, r[1], os.path.join(thumb_dir, f'{len(rows)}.png'), THUMB)
    rows.append({
        'cls': r[1],  # the 'class' column
        'type': r.type,
        'n': int(r.n_proofread_cells),
        'sv': str(r.supervoxel),
        'soma': [round(float(x), 2) for x in soma],
        'min': [round(float(x), 1) for x in lo],
        'max': [round(float(x), 1) for x in hi],
        'k': len(rows),
    })
    print(f"{r[1]:4} {r.type[:40]:40} {'same' if r.root_today == r.example_root else 'EDITED':6} near {near:5.1f} um", flush=True)

# One sprite for every thumbnail, in the order the list shows them (most
# cells first); each type's 'thumb' is its place in the sprite.
from PIL import Image
order = sorted(range(len(rows)), key=lambda i: -rows[i]['n'])
sheet = Image.new('RGBA', (COLS * THUMB, -(-len(rows) // COLS) * THUMB), (0, 0, 0, 0))
for place, i in enumerate(order):
    im = Image.open(os.path.join(thumb_dir, f"{rows[i]['k']}.png"))
    sheet.paste(im, ((place % COLS) * THUMB, (place // COLS) * THUMB))
sheet.quantize(colors=255, method=Image.Quantize.FASTOCTREE).save(sprite_out, optimize=True)
rows = [rows[i] for i in order]
for place, r in enumerate(rows):
    del r['k']
    r['thumb'] = place
HEADER = """// Built by scripts/retina-cast/build_data.py; do not edit by hand.
// sv is each example cell's soma supervoxel: Pyr looks up the root that
// holds it when the type is opened, so no root id is stored here.
// min and max are the mesh bounds in micrometres; thumb is the place in
// src/images/retina-cast-thumbs.png.
"""
with open(out, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write(HEADER)
    fh.write(f"export const CAST_THUMB_PX = {THUMB};\nexport const CAST_THUMB_COLS = {COLS};\n")
    fh.write("export const CAST_TYPES: { cls: string; type: string; n: number; sv: string; soma: number[]; min: number[]; max: number[]; thumb: number }[] = [\n")
    for r in rows:
        fh.write('  ' + json.dumps(r, ensure_ascii=False) + ',\n')
    fh.write('];\n')
print(f"\n{len(rows)} types written to {os.path.normpath(out)}")
print('PROBLEMS:' if problems else 'All within 10 um of their soma.', *problems, sep='\n  ')
