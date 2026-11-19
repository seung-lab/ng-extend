"""Copy the lab's All Glia tab into muller_glia_cells (Muller Glia Quest, 2026-11-19).

    python -I scripts/muller-glia-import.py ALLGLIA.csv [--dry]

ALLGLIA.csv is the tab exported as CSV:
  https://docs.google.com/spreadsheets/d/1o4i53h92oyzsBc8jEWKmF8ZnfyXKXtFCTaYSecs8tBk/export?format=csv&gid=2051269861
Env: EW_KEY = the Supabase service key (firebase functions:secrets:access
EW_SUPABASE_SERVICE_KEY), and the CAVE token at ~/.cloudvolume/secrets/cave-secret.json
to ask the chunked graph which segments are still current. Never printed.

Stage 2: every row whose Latest SegID is current and shared with another row
(two or more glia merged into one segment). Stage 1: the rest of the current
rows that the lab has not typed yet (no Cell Type, no Other Type). Rows are
upserted on sheet_index, so a second run refreshes them.
"""
import collections, csv, json, os, sys, urllib.request

PCG = 'https://minnie.microns-daf.com/segmentation/api/v1/table/stroeh_mouse_retina'
REST = 'https://javthknksdcrlhiaaptj.supabase.co/rest/v1'


def post(url, body, headers):
    q = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **headers})
    with urllib.request.urlopen(q, timeout=120) as r:
        return r.read()


def main(path, dry):
    rows = list(csv.DictReader(open(path, encoding='utf-8')))
    tok = json.load(open(os.path.expanduser('~/.cloudvolume/secrets/cave-secret.json')))['token']
    segs = sorted({r['Latest SegID'] for r in rows if r['Latest SegID'].isdigit()})
    latest = {}
    for i in range(0, len(segs), 500):
        b = segs[i:i + 500]
        out = json.loads(post(PCG + '/is_latest_roots?int64_as_str=1', {'node_ids': b}, {'Authorization': 'Bearer ' + tok}))
        latest.update(zip(b, out['is_latest']))
    current = [r for r in rows if latest.get(r['Latest SegID'])]
    shared = collections.Counter(r['Latest SegID'] for r in current)
    coord = lambda s: ','.join(p.strip() for p in s.split(',')) if s.strip() else None
    out = []
    for r in current:
        seg = r['Latest SegID']
        if shared[seg] > 1:
            stage, pair = 2, seg
        elif not r['Cell Type'].strip() and not r['Other Type'].strip():
            stage, pair = 1, None
        else:
            continue
        soma = coord(r['Soma Coords']) or coord(r['Nuc Coords'])
        if not soma:
            continue
        out.append({'sheet_index': r['Index'], 'segment_id': seg, 'nucleus_id': r['Latest NucID'] or None,
                    'nuc_coords': coord(r['Nuc Coords']), 'soma_coords': soma,
                    'guess': r['Proofreader Cell Type Guess'] or None, 'stage': stage, 'pair_segment': pair})
    c = collections.Counter(x['stage'] for x in out)
    print(f'rows {len(rows)}, current {len(current)}, stage 1 {c[1]}, stage 2 {c[2]} in {len({x["pair_segment"] for x in out if x["pair_segment"]})} segments')
    if dry:
        return
    key = os.environ['EW_KEY'].strip()
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Prefer': 'resolution=merge-duplicates,return=minimal'}
    for i in range(0, len(out), 500):
        post(REST + '/muller_glia_cells?on_conflict=sheet_index', out[i:i + 500], h)
    print('upserted', len(out))


if __name__ == '__main__':
    main(sys.argv[1], '--dry' in sys.argv)
