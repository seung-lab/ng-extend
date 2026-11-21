"""Import the lab's Lost Fragments hand-out list into ew_lost_fragment_pool.

The lab's orphans_handout.csv (HANDOVER-GAME.md, 2026-11-21): one row per
segment, sorted from the centre of the volume outward (dist_rank). Every field
is checked before it goes in. Rows are upserted by fragment_id, so running it
again with a refreshed list updates ranks and IDs; rows from an older list that
are not in the new one are deleted (Ames 2026-11-21: "This replaces the old
list"), unless --keep is given.

  firebase functions:secrets:access EW_SUPABASE_SERVICE_KEY --project eyewire-ii-e4d52 \
    | python -I scripts/lost-fragments-import.py path/to/orphans_handout.csv

The service key is read from stdin and never printed.
"""
import csv, json, re, sys, urllib.request

URL = 'https://javthknksdcrlhiaaptj.supabase.co/rest/v1/ew_lost_fragment_pool'
ID = re.compile(r'^\d{15,20}$')
HINT = re.compile(r'^[A-Za-z0-9;]{0,200}$')
CLS = {'orphan', 'split_off_orphan', 'uncertain_orphan'}
DIFF = {'easy', 'medium', 'hard'}


def rows(path):
    out = []
    for r in csv.DictReader(open(path, encoding='utf-8')):
        fid = r['seg_id_current'].strip()
        if not ID.match(fid):
            raise SystemExit(f'bad id {fid!r}')
        if r['difficulty'] not in DIFF or r['cls'] not in CLS:
            raise SystemExit(f'bad difficulty or class on {fid}')
        split_from, sheet = r['split_from'].strip(), r['sheet_index'].strip()
        if not HINT.match(split_from) or not HINT.match(sheet):
            raise SystemExit(f'bad sheet hint on {fid}')
        anchor = [int(r['anchor_x_vx']), int(r['anchor_y_vx']), int(r['anchor_z_vx'])]
        out.append({
            'fragment_id': fid, 'rank': int(r['dist_rank']), 'difficulty': r['difficulty'], 'cls': r['cls'],
            'split_from': split_from, 'sheet_index': sheet,
            'likely_soma': r['likely_with_soma'] == 'True',
            'vol_ipl_um3': round(float(r['vol_ipl_um3']), 2), 'vol_total_um3': round(float(r['vol_total_um3']), 2),
            'dist_um': round(float(r['dist_center_um']), 1), 'anchor': anchor, 'stale': False,
        })
    if len({x['fragment_id'] for x in out}) != len(out):
        raise SystemExit('duplicate ids')
    return out


def call(key, method, url, body=None, prefer=''):
    req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                                          **({'Prefer': prefer} if prefer else {})})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.status, res.read()


def main():
    path = sys.argv[1]
    keep = '--keep' in sys.argv
    key = sys.stdin.read().strip()
    if not key:
        raise SystemExit('no service key on stdin')
    data = rows(path)
    print(f'{len(data)} rows checked')
    for i in range(0, len(data), 1000):
        status, _ = call(key, 'POST', URL + '?on_conflict=fragment_id', data[i:i + 1000], 'resolution=merge-duplicates,return=minimal')
        print(f'rows {i + 1}-{min(i + 1000, len(data))}: {status}')
    if not keep:
        # Anything not in this list is retired from the pool.
        status, body = call(key, 'GET', URL + '?select=fragment_id&limit=100000')
        have = {x['fragment_id'] for x in json.loads(body)}
        gone = sorted(have - {x['fragment_id'] for x in data})
        for i in range(0, len(gone), 200):
            ids = ','.join(gone[i:i + 200])
            call(key, 'DELETE', URL + f'?fragment_id=in.({ids})', None, 'return=minimal')
        print(f'{len(gone)} old rows retired')


main()
