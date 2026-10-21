"""Each mistake's piece as a segment of its own, for the admins' heat map.

Admin Hub > Test tries > Look at their cell colors every scored piece green
(fixed) or red (missed) (Ames, 2026-10-21). For that each cut and merge check
needs its piece as one segment ID, `piece_root`:

  merge  the missing piece: the root of its supervoxel a at the baseline,
         when it was a piece apart from the cell
  cut    the wrong piece: the root of its supervoxel b in the reference cell
         (just after the reference time), when the tracer had cut it off

the same identities scripts/proofreading-test-from-reference.py uses. A root ID
names its set of supervoxels for good, so these still show after later edits.

Reads config/proofreading-test.json and config/proofreading-test-key.json,
looks the roots up, and prints SQL for the Supabase SQL editor. Reads only.
The printed SQL names where the answers are: keep it out of the repository.

    python scripts/proofreading-test-piece-roots.py > piece-roots.sql
"""
import datetime, json, os, sys
from cloudvolume import CloudVolume

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, '..', 'config', 'proofreading-test.json')
KEY = os.path.join(HERE, '..', 'config', 'proofreading-test-key.json')


def main():
    cfg = json.load(open(CFG, encoding='utf-8'))
    key = json.load(open(KEY, encoding='utf-8'))
    T0 = datetime.datetime.fromisoformat(cfg['baseline_at'])
    TR = datetime.datetime.fromisoformat(cfg['reference']['at']) + datetime.timedelta(seconds=1)
    cv = CloudVolume('graphene://https://minnie.microns-daf.com/segmentation/table/pinky_nf_v2', use_https=True, progress=False)
    # Ordinals as the key's SQL numbers them: its place in the key, from 1.
    rows = [(i + 1, c) for i, c in enumerate(key) if c['kind'] in ('merge', 'cut')]
    merges = [(o, c) for o, c in rows if c['kind'] == 'merge']
    cuts = [(o, c) for o, c in rows if c['kind'] == 'cut']
    out = []
    if merges:
        for (o, c), r in zip(merges, cv.get_roots([int(c['a']) for _, c in merges], timestamp=T0)):
            out.append((o, 'merge', c['a'], str(int(r))))
    if cuts:
        for (o, c), r in zip(cuts, cv.get_roots([int(c['b']) for _, c in cuts], timestamp=TR)):
            out.append((o, 'cut', c['b'], str(int(r))))
    out.sort()
    bad = [o for o, *_rest, r in out if r == '0']
    if bad:
        sys.exit(f'no root for the pieces at ordinals {bad}: check the times in the config')
    print(f"-- The Proofreading Test's pieces as segments, for the admins' heat map ({len(out)} pieces,")
    print(f"-- generated {datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')} by scripts/proofreading-test-piece-roots.py).")
    print("-- Each row is matched on its place, kind and supervoxel, so a different key is left alone.")
    print('BEGIN;')
    print("ALTER TABLE public.proofreading_test_checks ADD COLUMN IF NOT EXISTS piece_root text CHECK (piece_root IS NULL OR piece_root ~ '^[0-9]{1,20}$');")
    print('UPDATE public.proofreading_test_checks c SET piece_root = v.root')
    print('FROM (VALUES')
    print(',\n'.join(f"  ({o}, '{k}', '{sv}', '{r}')" for o, k, sv, r in out))
    print(') AS v(ordinal, kind, sv, root)')
    print("WHERE c.test_id = (SELECT id FROM public.proofreading_tests WHERE title = 'Proofreading test')")
    print("  AND c.ordinal = v.ordinal AND c.kind = v.kind")
    print("  AND (CASE WHEN v.kind = 'merge' THEN c.supervoxel_a ELSE c.supervoxel_b END) = v.sv;")
    print('COMMIT;')
    print("SELECT kind, count(*) AS checks, count(piece_root) AS with_a_piece FROM public.proofreading_test_checks")
    print("  WHERE test_id = (SELECT id FROM public.proofreading_tests WHERE title = 'Proofreading test') GROUP BY kind ORDER BY kind;")


if __name__ == '__main__':
    main()
