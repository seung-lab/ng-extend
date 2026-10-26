"""Read only: a proofread cell's edit history -> a candidate Hunt key and before view.

Research script behind docs/HUNT-FROM-EDITS.md. It only reads (GET, and POST /roots,
which looks roots up); it writes nothing to CAVE or Supabase.

usage: python -I scripts/hunt-from-edits.py <server> <table> <final_root> --sv SOMA_SUPERVOXEL [--out f.json] [--other TABLE]
  e.g. python -I scripts/hunt-from-edits.py https://minnie.microns-daf.com minnie65_public 864691136814060915 --sv 97114570682278096 --other minnie65_public_v117
The CAVE token is read from ~/.cloudvolume/secrets/cave-secret.json and never printed.
"""
import json, math, os, re, time, argparse, datetime as dt, collections
import requests

ap = argparse.ArgumentParser()
ap.add_argument('server'); ap.add_argument('table'); ap.add_argument('root', type=int)
ap.add_argument('--sv', type=int, required=True)
ap.add_argument('--out'); ap.add_argument('--other', default='')
ap.add_argument('--tiny_l2', type=int, default=1, help='pieces this many L2 chunks or fewer are tiny')
ap.add_argument('--tol_nm', type=float, default=3000)
a = ap.parse_args()

TOK = json.load(open(os.path.expanduser('~/.cloudvolume/secrets/cave-secret.json')))['token']
S = requests.Session(); S.headers['Authorization'] = 'Bearer ' + TOK
SEG = f'{a.server}/segmentation/api/v1/table/{a.table}'
calls = collections.OrderedDict()

def req(method, url, **kw):
    t = time.time(); r = S.request(method, url, **kw)
    key = (method, re.sub(r'/\d{6,}', '/{id}', url.replace(a.server, '').split('?')[0]))
    n, tot, codes = calls.get(key, (0, 0.0, set())); codes.add(r.status_code)
    calls[key] = (n + 1, tot + time.time() - t, codes)
    r.raise_for_status(); return r
get = lambda url, **kw: req('GET', url, **kw)

info = get(f'{a.server}/segmentation/table/{a.table}/info').json()
res = info['scales'][0]['resolution']; chunk = info['graph']['chunk_size']
l2_um = [round(chunk[i] * res[i] / 1000, 2) for i in range(3)]

j = get(f'{SEG}/root/{a.root}/tabular_change_log', params={'filtered': False}).json()
ops = sorted(({c: j[c][i] for c in j} for i in j['operation_id']), key=lambda o: o['timestamp'])
det = {}
ids = [o['operation_id'] for o in ops]
for i in range(0, len(ids), 200):
    det.update(get(f'{SEG}/operation_details', params={'operation_ids': json.dumps(ids[i:i + 200])}).json())

t0 = ops[0]['timestamp']
start = int(get(f'{SEG}/node/{a.sv}/root', params={'timestamp': (t0 - 1000) / 1000}).json()['root_id'])
cur = start; main = []
for o in ops:
    if cur in [int(x) for x in o['before_root_ids']]:
        main.append((o, cur)); cur = int(o['after_root_ids'][0])
reaches = cur == a.root

def nm(p): return [p[0] * res[0], p[1] * res[1], p[2] * res[2]]
def cen(ps): return [sum(p[k] for p in ps) / len(ps) for k in range(3)]

undone = set()
for oid, x in det.items():
    for k in ('undo_operation_id', 'redo_operation_id'):
        if x.get(k) is not None: undone.add(int(oid)); undone.add(int(x[k]))
failed = {int(k) for k, x in det.items() if x.get('operation_status') not in (None, 0)}
# a split that removes an edge an earlier merge added undoes it (MICrONS public has no undo fields)
first_added = {}
for oid in sorted(map(int, det)):
    for e in det[str(oid)].get('added_edges') or []: first_added.setdefault(tuple(sorted(map(int, e))), oid)
for oid in sorted(map(int, det)):
    hit = {first_added[e] for e in (tuple(sorted(map(int, e))) for e in det[str(oid)].get('removed_edges') or []) if e in first_added and first_added[e] < oid}
    if hit: undone.add(oid); undone.update(hit)

# where each edit's supervoxels were at the start (one batched call)
edge_svs = {}
for o, _ in main:
    x = det[str(o['operation_id'])]
    E = (x.get('added_edges') if o['is_merge'] else x.get('removed_edges')) or []
    edge_svs[o['operation_id']] = [(int(e[0]), int(e[1])) for e in E[:60]]
svs = sorted({s for E in edge_svs.values() for e in E for s in e})
root_at_start = {}
for i in range(0, len(svs), 1000):
    r = req('POST', f'{SEG}/roots', params={'timestamp': (t0 - 1000) / 1000}, data=json.dumps({'node_ids': svs[i:i + 1000]}))
    root_at_start.update(zip(svs[i:i + 1000], map(int, r.json()['root_ids'])))

edits = []
for o, before_main in main:
    oid = o['operation_id']; x = det[str(oid)]
    src = [nm(p) for p in (x.get('source_coords') or [])]; snk = [nm(p) for p in (x.get('sink_coords') or [])]
    A, B = cen(src), cen(snk)
    E = edge_svs[oid]
    in_start = [(root_at_start[u] == start, root_at_start[v] == start) for u, v in E]
    if o['is_merge']:
        kind = 'merge'
        # visible as a missing extension: one side is the start cell, the other is not
        visible = any(p != q for p, q in in_start)
        both_in = any(p and q for p, q in in_start)
        piece = [int(r) for r in o['before_root_ids'] if int(r) != before_main]
    else:
        kind = 'split'
        # visible as a merger: the edges cut were inside the start cell
        visible = any(p and q for p, q in in_start)
        both_in = False
        piece = [int(r) for r in (x.get('roots') or []) if int(r) not in [int(y) for y in o['after_root_ids']]]
    l2 = {}
    for r in piece[:3]:
        try: l2[r] = len(get(f'{SEG}/node/{r}/leaves', params={'stop_layer': 2}).json()['leaf_ids'])
        except Exception as ex: l2[r] = None
    edits.append(dict(op=oid, at=o['timestamp'], kind=kind, pt_nm=[round(v) for v in cen([A, B])],
                      click_gap_nm=round(math.dist(A, B)), visible=visible, remerge=both_in,
                      undo=oid in undone, failed=oid in failed, piece_l2=sum(v or 0 for v in l2.values()), user=o.get('user_name')))

# filters, in order
steps = [('main chain edits', list(edits))]
keep = [e for e in edits if not e['undo'] and not e['failed']]; steps.append(('minus undo/redo and failed', keep))
keep = [e for e in keep if e['visible'] and not e['remerge']]; steps.append(('minus not visible in the before view', keep))
keep = [e for e in keep if e['piece_l2'] > a.tiny_l2]; steps.append((f'minus tiny pieces (<= {a.tiny_l2} L2 chunk)', keep))
# one target per kind within the tolerance (greedy, earliest first)
merged = []
for e in keep:
    if any(f['kind'] == e['kind'] and math.dist(f['pt_nm'], e['pt_nm']) < a.tol_nm for f in merged): continue
    merged.append(e)
steps.append((f'minus same kind within {a.tol_nm/1000:g} um', merged))
key = [[*e['pt_nm'], 'cut' if e['kind'] == 'split' else 'merge'] for e in merged]

def nn(points):
    return sorted(round(min(math.dist(p, q) for q in points if q is not p)) for p in points) if len(points) > 1 else []

# 7. other "before" times: the start of each editing session (gap > 1 h) on the main chain
def visible_from(Ts, R, E_list):
    svs_ = sorted({s_ for e in E_list for (u, v) in edge_svs[e['op']] for s_ in (u, v)})
    rat = {}
    for i in range(0, len(svs_), 1000):
        r = req('POST', f'{SEG}/roots', params={'timestamp': (Ts - 1000) / 1000}, data=json.dumps({'node_ids': svs_[i:i + 1000]}))
        rat.update(zip(svs_[i:i + 1000], map(int, r.json()['root_ids'])))
    out = []
    for e in E_list:
        ins = [(rat[u] == R, rat[v] == R) for u, v in edge_svs[e['op']]]
        ok = any(p != q for p, q in ins) and not any(p and q for p, q in ins) if e['kind'] == 'merge' else any(p and q for p, q in ins)
        if ok and not e['undo'] and not e['failed'] and e['piece_l2'] > a.tiny_l2: out.append(e)
    m_ = []
    for e in out:
        if not any(f['kind'] == e['kind'] and math.dist(f['pt_nm'], e['pt_nm']) < a.tol_nm for f in m_): m_.append(e)
    return m_
sessions = []
for i, e in enumerate(edits):
    if i == 0 or e['at'] - edits[i - 1]['at'] > 3600 * 1000: sessions.append(i)
sess = []
for i in sessions:
    Ts = edits[i]['at']; R = main[i][1]
    vis = visible_from(Ts, R, edits[i:])
    sess.append(dict(day=dt.datetime.fromtimestamp(Ts / 1000, dt.timezone.utc).strftime('%Y-%m-%d %H:%M'), before_root=str(R),
                     edits_after=len(edits) - i, key_cut=sum(e['kind'] == 'split' for e in vis), key_merge=sum(e['kind'] == 'merge' for e in vis),
                     key=[[*e['pt_nm'], 'cut' if e['kind'] == 'split' else 'merge'] for e in vis],
                     key_ops=[e['op'] for e in vis], nn_um=[round(v / 1000, 1) for v in nn([e['pt_nm'] for e in vis])]))

def manifest(table, r):
    out = {}
    for v in ('1', '0'):
        try: out['verify' + v] = len(get(f'{a.server}/meshing/api/v1/table/{table}/manifest/{r}:0', params={'verify': v, 'prepend_seg_ids': 1}).json().get('fragments', []))
        except Exception as ex: out['verify' + v] = 'ERR ' + str(ex)[:60]
    return out
l2_start = len(get(f'{SEG}/node/{start}/leaves', params={'stop_layer': 2}).json()['leaf_ids'])
l2_final = len(get(f'{SEG}/node/{a.root}/leaves', params={'stop_layer': 2}).json()['leaf_ids'])
mesh = {'start': manifest(a.table, start), 'final': manifest(a.table, a.root)}
if a.other: mesh['start_on_' + a.other] = manifest(a.other, start)

when = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%d')
summary = dict(
    table=a.table, root=str(a.root), start_root=str(start), chain_reaches_final=reaches,
    res_nm=res, l2_chunk_um=l2_um, lineage_ops=len(ops), lineage_merges=sum(o['is_merge'] for o in ops),
    lineage_splits=sum(not o['is_merge'] for o in ops), lineage_undo_redo=len(undone & set(ids)),
    first=when(ops[0]['timestamp']), last=when(ops[-1]['timestamp']),
    main=len(edits), main_merges=sum(e['kind'] == 'merge' for e in edits), main_splits=sum(e['kind'] == 'split' for e in edits),
    filter_steps=[(name, len(v), sum(e['kind'] == 'split' for e in v), sum(e['kind'] == 'merge' for e in v)) for name, v in steps],
    key_cut=sum(k[3] == 'cut' for k in key), key_merge=sum(k[3] == 'merge' for k in key),
    nn_um_main=[round(v / 1000, 1) for v in nn([e['pt_nm'] for e in edits])],
    nn_um_key=[round(v / 1000, 1) for v in nn([k[:3] for k in key])],
    click_gap_um_main=sorted(round(e['click_gap_nm'] / 1000, 2) for e in edits),
    piece_l2_main=sorted(e['piece_l2'] for e in edits),
    sessions=[{k: v for k, v in x.items() if k not in ('key', 'key_ops')} for x in sess],
    l2_start=l2_start, l2_final=l2_final, mesh=mesh, users=sorted({e['user'] for e in edits if e['user']}),
)
print(json.dumps(summary, default=str))
print('CALLS ' + json.dumps([(m, p, n, round(t, 1), sorted(c)) for (m, p), (n, t, c) in calls.items()]))
if a.out:
    json.dump(dict(summary=summary, edits=edits, key=key, view=dict(table=a.table, segments=[str(start)], soma_sv=str(a.sv)), sessions=sess), open(a.out, 'w'), indent=1, default=str)
