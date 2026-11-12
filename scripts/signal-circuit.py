#!/usr/bin/env python
"""
Build static/signal/circuit.json, the real circuit the Signal Controller mini
game plays on (src/util/signal_controller.ts), from the MICrONS public
release through CAVE (datastack minnie65_public, materialization 1300, the
version whose flat segmentation gs://iarpa_microns/minnie/minnie65/seg_m1300
the game shows).

For each cell: its type (aibs_metamodel_celltypes_v661, allen_column_mtypes_v2)
and soma. For each pair of cells with synapses between them (synapses_pni_2):
the synapse count, and the path a spike takes, read off the cells' skeletons
(skeleton service, version 4): down the presynaptic axon from the soma to a
representative synapse, then along the postsynaptic dendrite to that soma.

The cells were chosen by a search over every synapse among the proofread
cells of the release (2026-11-08): a layer 4 pyramidal cell (T), the
Martinotti cell that inhibits it and most of its neighbors (I1), the bipolar
cell that inhibits the Martinotti cell (I2), T's excitatory drivers (E1..E4),
E4's drivers (F1..F3), two more cells under I1 (G1, G2), and the layer 2/3
cell that drives I2 (S).

    python scripts/signal-circuit.py          (needs caveclient and a CAVE token)
    python scripts/signal-circuit.py --counts-only   (only the synapse totals, into the existing file)
    python scripts/signal-circuit.py --partners-only (only the partners by cell type, into the existing file)
    python scripts/signal-circuit.py --parts-only    (one file a cell: arbors with path distances, every synapse)
    python scripts/signal-circuit.py --paths-only    (each dendrite's way in to the cell body, added to those files)
"""
import json, os, sys, time
import numpy as np
import pandas as pd
from caveclient import CAVEclient

VERSION = 1300
OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'signal', 'circuit.json')
RES = np.array([4.0, 4.0, 40.0])  # table positions are in these voxels, nm
CELLS = [
    ('T',  864691135308621126), ('I1', 864691135777697453), ('I2', 864691135214160184),
    ('E1', 864691135838788755), ('E2', 864691137021245294), ('E3', 864691135562147041), ('E4', 864691135996497834),
    ('F1', 864691135503611829), ('F2', 864691135479705030), ('F3', 864691135183426562),
    ('G1', 864691134941824611), ('G2', 864691134919019274), ('S', 864691135270780837),
]
LABELS = {'4P': 'Pyramidal cell', '23P': 'Pyramidal cell', '5P-IT': 'Pyramidal cell', 'MC': 'Martinotti cell',
          'BPC': 'Bipolar cell', 'BC': 'Basket cell', 'NGC': 'Neurogliaform cell'}
SIMPLIFY_NM = 1500
MAX_POINTS = 90


def positions(df, col):
    if col in df.columns:
        return np.vstack([np.asarray(p, dtype=float) for p in df[col]]) * RES
    return df[[f'{col}_x', f'{col}_y', f'{col}_z']].to_numpy(dtype=float) * RES


def rdp(points, eps):
    """Ramer Douglas Peucker, keeping the ends."""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    ab = b - a
    n = np.linalg.norm(ab)
    if n < 1e-9:
        d = np.linalg.norm(points - a, axis=1)
    else:
        d = np.linalg.norm(np.cross(points - a, ab), axis=1) / n
    i = int(np.argmax(d))
    if d[i] > eps:
        return np.vstack([rdp(points[:i + 1], eps)[:-1], rdp(points[i:], eps)])
    return np.vstack([a, b])


class Skel:
    def __init__(self, sk):
        self.V = np.asarray(sk['vertices'], dtype=float)
        E = np.asarray(sk['edges'], dtype=int)
        self.comp = np.asarray(sk.get('compartment', []), dtype=int)
        self.root = int(sk['root'])
        n = len(self.V)
        adj = [[] for _ in range(n)]
        for a, b in E:
            adj[a].append(b); adj[b].append(a)
        parent = np.full(n, -1, dtype=int)
        seen = np.zeros(n, bool); seen[self.root] = True
        stack = [self.root]
        while stack:
            u = stack.pop()
            for w in adj[u]:
                if not seen[w]:
                    seen[w] = True; parent[w] = u; stack.append(w)
        self.parent = parent
        L = np.linalg.norm(self.V[E[:, 0]] - self.V[E[:, 1]], axis=1)
        self.cable = float(L.sum())
        self.axon = float(L[self.comp[E[:, 0]] == 2].sum()) if len(self.comp) else 0.0

    def nearest(self, p, compartment=None):
        d = np.linalg.norm(self.V - p, axis=1)
        if compartment is not None and len(self.comp):
            m = self.comp == compartment
            if m.any() and d[m].min() < 6000:
                d = np.where(m, d, np.inf)
        return int(np.argmin(d))

    def path_from_root(self, v):
        path = []
        while v != -1:
            path.append(v); v = self.parent[v]
        path.reverse()
        return self.V[path]


def synapse_totals(c, ids):
    """Every synapse each cell makes and receives in the release (synapses_pni_2),
    counted: the card the Starship projects over a cell shows them (Ames
    2026-11-11: "stats should include synapse count")."""
    print('synapse totals...')
    out_ = c.materialize.query_table('synapses_pni_2', filter_in_dict={'pre_pt_root_id': ids},
                                     select_columns=['id', 'pre_pt_root_id', 'post_pt_root_id'])
    in_ = c.materialize.query_table('synapses_pni_2', filter_in_dict={'post_pt_root_id': ids},
                                    select_columns=['id', 'pre_pt_root_id', 'post_pt_root_id'])
    # a synapse onto the same cell (an autapse, or a merge) counts once
    syn_out = out_[out_.pre_pt_root_id != out_.post_pt_root_id].groupby('pre_pt_root_id').size()
    syn_in = in_[in_.pre_pt_root_id != in_.post_pt_root_id].groupby('post_pt_root_id').size()
    return {int(r): (int(syn_in.get(r, 0)), int(syn_out.get(r, 0))) for r in ids}


def partner_types(c, ids):
    """Who each cell talks to, by cell type: its synapses onto and from every
    other cell of the release, counted by the partner's type
    (aibs_metamodel_celltypes_v661); partners without a type (fragments,
    glia, unlabelled cells) count as one 'other' bin. Ames 2026-11-11: "do we
    have any stats on what other cell types this cell connects to?" """
    print('partner types...')
    out_ = c.materialize.query_table('synapses_pni_2', filter_in_dict={'pre_pt_root_id': ids},
                                     select_columns=['id', 'pre_pt_root_id', 'post_pt_root_id'])
    in_ = c.materialize.query_table('synapses_pni_2', filter_in_dict={'post_pt_root_id': ids},
                                    select_columns=['id', 'pre_pt_root_id', 'post_pt_root_id'])
    out_ = out_[out_.pre_pt_root_id != out_.post_pt_root_id]
    in_ = in_[in_.pre_pt_root_id != in_.post_pt_root_id]
    partners = sorted(set(out_.post_pt_root_id.astype(int)) | set(in_.pre_pt_root_id.astype(int)))
    partners = [r for r in partners if r > 0]
    print(f'  {len(partners)} partner cells to type')
    types = {}
    for i in range(0, len(partners), 4000):
        chunk = partners[i:i + 4000]
        df = c.materialize.tables.aibs_metamodel_celltypes_v661(pt_root_id=chunk).query(
            select_columns=['pt_root_id', 'cell_type', 'classification_system'])
        df = df.drop_duplicates('pt_root_id')
        for r, t, cls in zip(df.pt_root_id.astype(int), df.cell_type, df.classification_system):
            types[r] = (str(t), 'I' if cls == 'inhibitory_neuron' else 'E' if cls == 'excitatory_neuron' else 'N')
        print(f'  typed {min(i + 4000, len(partners))} of {len(partners)}')
    def tally(series):
        bins = {}
        for r in series.astype(int):
            t = types.get(int(r))
            key = (t[0], t[1]) if t else ('other', 'N')
            bins[key] = bins.get(key, 0) + 1
        return [{'type': k[0], 'cls': k[1], 'n': v} for k, v in sorted(bins.items(), key=lambda kv: -kv[1])]
    result = {}
    for r in ids:
        result[r] = {'out': tally(out_[out_.pre_pt_root_id == r].post_pt_root_id),
                     'in': tally(in_[in_.post_pt_root_id == r].pre_pt_root_id)}
    return result


def add_partners():
    """Add partners (synapses by the partner's cell type) to the cells of an existing circuit.json."""
    c = CAVEclient('minnie65_public', version=VERSION)
    with open(OUT) as f:
        data = json.load(f)
    ids = [int(cell['root']) for cell in data['cells']]
    pt = partner_types(c, ids)
    for cell in data['cells']:
        cell['partners'] = pt[int(cell['root'])]
        top = ', '.join(f"{b['type']} {b['n']}" for b in cell['partners']['out'][:5])
        print(f"  {cell['key']:3s} onto: {top}")
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote {OUT}')


def arbor_walk(skel):
    """The skeleton from the root: its vertices parents first, each one's
    path distance from the root, and each one's children."""
    n = len(skel.V)
    dist = np.zeros(n)
    order = []
    stack = [skel.root]
    kids = [[] for _ in range(n)]
    for v in range(n):
        if skel.parent[v] >= 0:
            kids[skel.parent[v]].append(v)
    while stack:
        u = stack.pop()
        order.append(u)
        for w in kids[u]:
            dist[w] = dist[u] + float(np.linalg.norm(skel.V[w] - skel.V[u]))
            stack.append(w)
    return order, dist, kids


def sampled(skel, comps, order, dist, step):
    """The vertices of those compartments at which the path distance crosses
    a multiple of `step`, in traversal order: the arbor's points."""
    out = []
    for v in order:
        p = skel.parent[v]
        if p < 0 or not len(skel.comp) or skel.comp[v] not in comps:
            continue
        if int(dist[v] // step) > int(dist[p] // step):
            out.append(v)
    return out


def arbor_points(skel, comps, step=3000):
    """The skeleton's vertices of those compartments, one every `step` nm of
    path from the soma, each with its path distance: [x, y, z, d] in nm. A
    wavefront drawn at distance d then runs down every branch at once."""
    order, dist, _ = arbor_walk(skel)
    out = []
    for v in sampled(skel, comps, order, dist, step):
        x, y, z = skel.V[v]
        out.append([int(x), int(y), int(z), int(dist[v])])
    return out


def dend_paths(skel, comps, step=3000, min_nm=40_000, cap=100):
    """Each dendrite tip's way in to the cell body, as indices into
    arbor_points(skel, comps, step) from the tip end, so a signal can run in
    along one dendrite at a time (Ames 2026-11-11: "signals do not come in
    from all the dendrites at once"). Tips nearer than 40 µm of path to the
    cell body are left out, and the hundred farthest are kept."""
    order, dist, kids = arbor_walk(skel)
    idx = {v: i for i, v in enumerate(sampled(skel, comps, order, dist, step))}
    tips = [v for v in order if len(skel.comp) and skel.comp[v] in comps and not kids[v] and dist[v] >= min_nm]
    tips.sort(key=lambda v: -dist[v])
    paths = []
    for v in tips[:cap]:
        path = []
        while v >= 0:
            i = idx.get(v)
            if i is not None:
                path.append(i)
            v = skel.parent[v]
        if len(path) >= 3:
            paths.append(path)
    return paths


def add_paths():
    """Add dendPaths (dend_paths) to every cell file that has its arbors,
    from the skeleton again so the indices match the dendrite points written
    with them; the synapses are kept as they are."""
    c = CAVEclient('minnie65_public', version=VERSION)
    with open(OUT) as f:
        data = json.load(f)
    folder = os.path.dirname(OUT)
    for cell in data['cells']:
        r = int(cell['root'])
        path = os.path.join(folder, f'cell-{r}.json')
        if not os.path.exists(path):
            print(f"  {cell['key']:3s} has no file yet: run --parts-only first")
            continue
        with open(path) as f:
            part = json.load(f)
        if part.get('arbor', {}).get('dendPaths'):
            print(f"  {cell['key']:3s} already has its dendrite paths")
            continue
        t0 = time.time()
        sk = None
        for attempt in range(3):
            try:
                sk = Skel(c.skeleton.get_skeleton(r, skeleton_version=4, output_format='dict'))
                break
            except Exception as e:  # noqa: BLE001
                print(f"  {cell['key']:3s} skeleton attempt {attempt + 1} failed: {str(e)[:80]}")
                time.sleep(20)
        if sk is None:
            continue
        part['arbor'] = {'axon': arbor_points(sk, (2,)), 'dend': arbor_points(sk, (3, 4)), 'dendPaths': dend_paths(sk, (3, 4))}
        with open(path, 'w') as f:
            json.dump(part, f, separators=(',', ':'))
        print(f"  {cell['key']:3s} {len(part['arbor']['dendPaths'])} dendrite paths, {os.path.getsize(path) // 1024} KB ({time.time() - t0:.1f}s)", flush=True)


def add_parts():
    """One file a cell, static/signal/cell-<root>.json: its axon and dendrite
    arbors as points with their distance from the soma (arbor_points), and
    every synapse it makes and receives in the release, by position
    (Ames 2026-11-11: "axon animation is cool, it should propagate out and
    down all the branches"; "synapses, can we see all 3,000?")."""
    c = CAVEclient('minnie65_public', version=VERSION)
    with open(OUT) as f:
        data = json.load(f)
    ids = [int(cell['root']) for cell in data['cells']]
    print('synapse positions...')
    out_ = c.materialize.synapse_query(pre_ids=ids).reset_index(drop=True)
    in_ = c.materialize.synapse_query(post_ids=ids).reset_index(drop=True)
    out_pos = positions(out_, 'ctr_pt_position'); in_pos = positions(in_, 'ctr_pt_position')
    out_pre = out_.pre_pt_root_id.astype(int).to_numpy(); out_post = out_.post_pt_root_id.astype(int).to_numpy()
    in_pre = in_.pre_pt_root_id.astype(int).to_numpy(); in_post = in_.post_pt_root_id.astype(int).to_numpy()
    folder = os.path.dirname(OUT)
    for cell in data['cells']:
        r = int(cell['root'])
        t0 = time.time()
        path = os.path.join(folder, f'cell-{r}.json')
        # a file already holding arbors is done; one without gets another try
        # at the skeleton service (it answered 503 on 2026-11-11)
        old = None
        if os.path.exists(path):
            with open(path) as f:
                old = json.load(f)
            if old.get('arbor', {}).get('axon'):
                print(f"  {cell['key']:3s} already has its arbors")
                continue
        axon, dend, dpaths = [], [], []
        for attempt in range(3):
            try:
                sk = Skel(c.skeleton.get_skeleton(r, skeleton_version=4, output_format='dict'))
                axon = arbor_points(sk, (2,))
                dend = arbor_points(sk, (3, 4))
                dpaths = dend_paths(sk, (3, 4))
                break
            except Exception as e:  # noqa: BLE001
                print(f"  {cell['key']:3s} skeleton attempt {attempt + 1} failed: {str(e)[:80]}")
                time.sleep(20)
        so = out_pos[(out_pre == r) & (out_post != r)]
        si = in_pos[(in_post == r) & (in_pre != r)]
        part = {
            'root': str(r),
            'arbor': {'axon': axon, 'dend': dend, 'dendPaths': dpaths},
            'syn': {'out': [[int(v) for v in p] for p in so], 'in': [[int(v) for v in p] for p in si]},
        }
        with open(path, 'w') as f:
            json.dump(part, f, separators=(',', ':'))
        print(f"  {cell['key']:3s} axon {len(axon)} pts, dendrites {len(dend)} pts, synapses {len(si)} in {len(so)} out, {os.path.getsize(path) // 1024} KB ({time.time() - t0:.1f}s)")


def add_counts():
    """Add synIn and synOut to the cells of an existing circuit.json."""
    c = CAVEclient('minnie65_public', version=VERSION)
    with open(OUT) as f:
        data = json.load(f)
    totals = synapse_totals(c, [int(cell['root']) for cell in data['cells']])
    for cell in data['cells']:
        cell['synIn'], cell['synOut'] = totals[int(cell['root'])]
        print(f"  {cell['key']:3s} in {cell['synIn']:6d}  out {cell['synOut']:6d}")
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'wrote {OUT}')


def main():
    if '--counts-only' in sys.argv:
        add_counts()
        return
    if '--partners-only' in sys.argv:
        add_partners()
        return
    if '--parts-only' in sys.argv:
        add_parts()
        return
    if '--paths-only' in sys.argv:
        add_paths()
        return
    c = CAVEclient('minnie65_public', version=VERSION)
    ids = [r for _, r in CELLS]
    key = {r: k for k, r in CELLS}
    totals = synapse_totals(c, ids)
    print(f'cell types, materialization {VERSION}...')
    ct = c.materialize.tables.aibs_metamodel_celltypes_v661(pt_root_id=ids).query().drop_duplicates('pt_root_id')
    col = c.materialize.tables.allen_column_mtypes_v2(pt_root_id=ids).query().drop_duplicates('pt_root_id')
    ctp = positions(ct, 'pt_position')
    soma = {int(r): ctp[i] for i, r in enumerate(ct.pt_root_id)}
    fine = dict(zip(ct.pt_root_id.astype(int), ct.cell_type))
    cls = dict(zip(ct.pt_root_id.astype(int), ct.classification_system))
    mtype = dict(zip(col.pt_root_id.astype(int), col.cell_type))

    print('synapses among the cells...')
    syn = c.materialize.synapse_query(pre_ids=ids, post_ids=ids).reset_index(drop=True)
    syn['pre'] = syn.pre_pt_root_id.astype(int); syn['post'] = syn.post_pt_root_id.astype(int)
    pre_pos = positions(syn, 'pre_pt_position'); post_pos = positions(syn, 'post_pt_position'); ctr_pos = positions(syn, 'ctr_pt_position')

    print('skeletons...')
    skel = {}
    for k, r in CELLS:
        t0 = time.time()
        skel[r] = Skel(c.skeleton.get_skeleton(r, skeleton_version=4, output_format='dict'))
        print(f'  {k:3s} {r} cable {skel[r].cable / 1000:.0f} um ({time.time() - t0:.1f}s)')

    cells = []
    for k, r in CELLS:
        s = skel[r]
        f = fine.get(r, '?')
        cells.append({
            'key': k, 'root': str(r), 'type': 'I' if cls.get(r) == 'inhibitory_neuron' else 'E',
            'fine': f, 'mtype': mtype.get(r, ''), 'label': LABELS.get(f, 'Neuron'),
            'soma': [int(x) for x in soma[r]], 'cableUm': round(s.cable / 1000), 'axonUm': round(s.axon / 1000),
            'synIn': totals[r][0], 'synOut': totals[r][1],
        })

    conns = []
    for (a, b), g in syn.groupby(['pre', 'post']):
        if a == b:
            continue
        idx = g.index.to_numpy()
        ctr = ctr_pos[idx]
        # the synapse nearest the middle of this connection's synapses
        rep = idx[int(np.argmin(np.linalg.norm(ctr - ctr.mean(0), axis=1)))]
        sa, sb = skel[a], skel[b]
        axon = sa.path_from_root(sa.nearest(pre_pos[rep], compartment=2))
        dend = sb.path_from_root(sb.nearest(post_pos[rep], compartment=3))[::-1]  # synapse to soma
        axon_um = float(np.linalg.norm(np.diff(axon, axis=0), axis=1).sum()) / 1000
        dend_um = float(np.linalg.norm(np.diff(dend, axis=0), axis=1).sum()) / 1000
        ax = rdp(axon, SIMPLIFY_NM); de = rdp(dend, SIMPLIFY_NM)
        if len(ax) > MAX_POINTS: ax = ax[np.linspace(0, len(ax) - 1, MAX_POINTS).astype(int)]
        if len(de) > MAX_POINTS: de = de[np.linspace(0, len(de) - 1, MAX_POINTS).astype(int)]
        marks = ctr[np.linspace(0, len(ctr) - 1, min(len(ctr), 10)).astype(int)]
        conns.append({
            'pre': key[a], 'post': key[b], 'count': int(len(g)),
            'axonUm': round(axon_um), 'dendriteUm': round(dend_um),
            'axon': [[int(x) for x in p] for p in ax], 'dendrite': [[int(x) for x in p] for p in de],
            'synapse': [int(x) for x in ctr_pos[rep]], 'synapses': [[int(x) for x in p] for p in marks],
        })
        print(f'  {key[a]:3s} -> {key[b]:3s} {len(g):3d} synapses, axon {axon_um:.0f} um, dendrite {dend_um:.0f} um, path points {len(ax)}+{len(de)}')

    out = {
        'source': 'MICrONS minnie65 public release, CAVE materialization 1300; synapses_pni_2, aibs_metamodel_celltypes_v661, allen_column_mtypes_v2, skeleton service v4',
        'built': time.strftime('%Y-%m-%d'), 'version': VERSION, 'resolutionNm': [8, 8, 40],
        'cells': cells, 'connections': conns,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'wrote {OUT}: {len(cells)} cells, {len(conns)} connections, {os.path.getsize(OUT) // 1024} KB')


if __name__ == '__main__':
    main()
