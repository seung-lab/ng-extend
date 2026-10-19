"""Build the proofreading test's answer key from a finished reference cell.

Reads only; prints SQL for the Supabase editor (Ames runs it).

The reference (config/proofreading-test.json, "reference") is a pro tracer's
finished version of the test cell: a root id, the moment it was finished, and
her branch end points. A root id is a fixed set of supervoxels for good, so
the reference can be measured long after the live cell has moved on.

  start cell      the cell at the test's baseline (its root then, from the
                  anchor supervoxel on the soma)
  reference cell  the tracer's finished root

Checks, all paired with the anchor on the soma:
  merge     every piece the start cell lacks and the reference has: the
            supervoxels in reference - start, grouped by their root at the
            baseline. Starts apart, must end together.
  cut       every piece the start cell has and the reference lacks: the
            supervoxels in start - reference, grouped by their root in the
            reference state. Starts together, must end apart.
  keep      at each of her ends that sits on the start cell: a real branch
            tip. Starts together, must stay together; breaking one is damage.
  endpoint  her ends, a point annotation within the radius of each.

Weights: a piece weighs its supervoxel count, so a dendrite counts for far
more than a crumb. The ends together weigh `ends_share` of the whole score.

Every check is verified in its start state on the live cell before any SQL
is printed (the live cell must be at its start), and in its end state in the
reference.

  python scripts/proofreading-test-from-reference.py > key.sql
"""
import datetime
import json
import os
import sys
import urllib.request

import numpy as np
from cloudvolume import CloudVolume

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "..", "config", "proofreading-test.json")
VIEW = np.array([4, 4, 40])          # viewer voxels, nm
log = lambda *a: print(*a, file=sys.stderr)


def sql_str(v):
    return "'" + str(v).replace("'", "''") + "'"


def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    ref = cfg["reference"]
    if cfg["pcg_server"] != "https://minnie.microns-daf.com" or cfg["pcg_table"] != "pinky_nf_v2":
        sys.exit("Only the Pinky sandbox is approved for the test cell.")
    token = os.environ.get("CAVE_SERVICE_TOKEN") or json.load(open(os.path.expanduser("~/.cloudvolume/secrets/cave-secret.json")))["token"]
    base = f"{cfg['pcg_server']}/segmentation/api/v1/table/{cfg['pcg_table']}"

    def get(path):
        req = urllib.request.Request(base + path, headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.load(r)

    cv = CloudVolume(f"graphene://{cfg['pcg_server']}/segmentation/table/{cfg['pcg_table']}",
                     use_https=True, progress=False, fill_missing=True, bounded=False, secrets={"token": token})
    res = np.array([int(v) for v in cv.resolution])
    T0 = datetime.datetime.fromisoformat(cfg["baseline_at"])
    TR = datetime.datetime.fromisoformat(ref["at"]) + datetime.timedelta(seconds=1)
    anchor = int(cfg["anchor_supervoxel"])
    start_root = int(cv.get_roots([anchor], timestamp=T0)[0])
    ref_root = int(ref["root"])
    if int(cv.get_roots([anchor], timestamp=TR)[0]) != ref_root:
        sys.exit("The anchor is not on the reference root at the reference time.")
    now_root = int(cv.get_roots([anchor])[0])

    def leaves(root):
        return set(int(x) for x in get(f"/node/{root}/leaves?int64_as_str=1")["leaf_ids"])
    start, refset, live = leaves(start_root), leaves(ref_root), leaves(now_root)
    if live != start:
        sys.exit(f"The live cell is not at its start ({len(live - start)} extra, {len(start - live)} missing supervoxels). Put it back first.")
    missing, extra = sorted(refset - start), sorted(start - refset)
    log(f"start cell {start_root}: {len(start)} supervoxels; reference {ref_root}: {len(refset)}; "
        f"the reference adds {len(missing)} and drops {len(extra)}")

    def groups(svs, when):
        roots = cv.get_roots(svs, timestamp=when) if svs else []
        g = {}
        for sv, r in zip(svs, roots):
            g.setdefault(int(r), []).append(sv)
        return g
    merge_groups = groups(missing, T0)     # a missing piece = its root at the baseline
    cut_groups = groups(extra, TR)         # a wrong piece = its root in the reference

    # Where each piece is, from the tracer's own edits (their points are in
    # the volume's voxels): the side of a merge that is the piece, the middle
    # of a cut.
    changes = get(f"/root/{ref_root}/tabular_change_log?filtered=false")
    rows = changes.get(str(ref_root), changes)
    if isinstance(rows, str):
        rows = json.loads(rows)
    if not isinstance(rows, list):
        rows = [{k: rows[k][i] for k in rows} for i in rows["operation_id"]]
    t0ms, trms = T0.timestamp() * 1000, TR.timestamp() * 1000
    ops = [r for r in rows if t0ms < float(r["timestamp"]) <= trms and str(r.get("user_id")) == str(ref["edits_user"])]
    ids = [int(r["operation_id"]) for r in ops]
    det = {}
    for i in range(0, len(ids), 100):
        det.update(get("/operation_details?int64_as_str=1&operation_ids=" + urllib.request.quote(json.dumps(ids[i:i + 100]))))
    at = {}                                   # supervoxel -> viewer point
    to_view = lambda p: [int(p[0] * res[0] / VIEW[0]), int(p[1] * res[1] / VIEW[1]), int(p[2] * res[2] / VIEW[2])]
    for r in ops:
        d = det.get(str(r["operation_id"]), {})
        src, snk = d.get("source_coords") or [], d.get("sink_coords") or []
        if r.get("is_merge"):
            for e in d.get("added_edges") or []:
                if src:
                    at.setdefault(int(e[0]), to_view(src[0]))
                if snk:
                    at.setdefault(int(e[1]), to_view(snk[0]))
        else:
            pts = src + snk
            mid = [sum(p[k] for p in pts) / len(pts) for k in range(3)] if pts else None
            for e in d.get("removed_edges") or []:
                for sv in e:
                    if mid:
                        at.setdefault(int(sv), to_view(mid))

    def pick(members):
        located = [sv for sv in members if sv in at]
        sv = min(located) if located else min(members)
        return sv, at.get(sv)

    checks = []
    for root, members in sorted(merge_groups.items(), key=lambda kv: -len(kv[1])):
        sv, p = pick(members)
        checks.append({"kind": "merge", "label": "Missing piece" + (f" near {p[0]}, {p[1]}, {p[2]}" if p else ""),
                       "a": sv, "b": anchor, "pa": p, "weight": len(members)})
    for root, members in sorted(cut_groups.items(), key=lambda kv: -len(kv[1])):
        sv, p = pick(members)
        checks.append({"kind": "cut", "label": "Wrong piece" + (f" near {p[0]}, {p[1]}, {p[2]}" if p else ""),
                       "a": anchor, "b": sv, "pb": p, "weight": len(members)})

    # Her ends: a keep check where the end is on the start cell, and the end itself.
    radius = int(cfg.get("endpoint_radius_nm", 1500))
    ends = ref["ends"]
    for j, pt in enumerate(ends):
        v = (np.array(pt) * VIEW // res).astype(int)
        best = None
        for rr in (2, 4, 8, 16, 32):
            block = cv[v[0] - rr:v[0] + rr + 1, v[1] - rr:v[1] + rr + 1, max(0, v[2] - 2):v[2] + 3][:, :, :, 0]
            labels = np.asarray(block)
            ok = np.isin(labels, np.array([s for s in np.unique(labels) if int(s) in refset], dtype=labels.dtype))
            if ok.any():
                # the reference cell's supervoxel nearest the point, in nm
                pos = np.argwhere(ok)
                centre = np.array([rr, rr, v[2] - max(0, v[2] - 2)])
                k = int(np.argmin((((pos - centre) * res) ** 2).sum(axis=1)))
                best = int(labels[tuple(pos[k])])
                break
        if best is not None and best in start:
            checks.append({"kind": "keep", "label": f"Branch {j + 1}", "a": best, "b": anchor, "pa": pt, "weight": 0})
        elif best is None:
            log(f"  end {j + 1} at {pt}: no supervoxel of the reference cell within 256 nm")

    error_weight = sum(c["weight"] for c in checks if c["kind"] in ("merge", "cut"))
    share = float(cfg.get("ends_share", 0.2))
    per_end = max(1, round(error_weight * share / (1 - share) / max(1, len(ends))))
    for j, pt in enumerate(ends):
        checks.append({"kind": "endpoint", "label": f"Branch end {j + 1}", "pa": pt, "weight": per_end, "radius": radius})

    # Verify: start state on the live cell now, end state in the reference.
    svs = sorted({c[k] for c in checks for k in ("a", "b") if k in c})
    now_r = dict(zip(svs, (int(x) for x in cv.get_roots(svs))))
    ref_r = dict(zip(svs, (int(x) for x in cv.get_roots(svs, timestamp=TR))))
    want = {"merge": ("apart", "together"), "cut": ("together", "apart"), "keep": ("together", "together")}
    bad = []
    for c in checks:
        if c["kind"] == "endpoint":
            continue
        s = "together" if now_r[c["a"]] == now_r[c["b"]] else "apart"
        e = "together" if ref_r[c["a"]] == ref_r[c["b"]] else "apart"
        if (s, e) != want[c["kind"]]:
            bad.append(f"{c['kind']} {c['label']}: now {s}, in the reference {e}")
    if bad:
        sys.exit("Checks not in their start or end state:\n  " + "\n  ".join(bad))

    n = {k: sum(1 for c in checks if c["kind"] == k) for k in ("merge", "cut", "keep", "endpoint")}
    big = sorted((c["weight"] for c in checks if c["kind"] == "merge"), reverse=True)
    log(f"checks: {n['merge']} missing pieces, {n['cut']} wrong pieces, {n['keep']} keep, {n['endpoint']} ends; "
        f"error weight {error_weight}, each end {per_end} ({per_end * len(ends)} in all)")
    log(f"missing piece sizes, largest first: {big}")
    # Supervoxel ids as text: they pass 2^53, which a JavaScript number cannot hold.
    json.dump([{**c, **{k: str(c[k]) for k in ("a", "b") if k in c}} for c in checks],
              open(os.path.join(HERE, "..", "config", "proofreading-test-key.json"), "w"), indent=1, default=int)

    title = sql_str(cfg["title"])
    lines = []
    for i, c in enumerate(checks, 1):
        pa = c.get("pa")
        pb = c.get("pb")
        lines.append("  (" + ", ".join([
            str(i), sql_str(c["kind"]), sql_str(c["label"]),
            sql_str(c.get("a", "")), sql_str(c.get("b", "")),
            sql_str(json.dumps(pa)) if pa else "NULL", sql_str(json.dumps(pb)) if pb else "NULL",
            str(c["radius"]) if c.get("radius") else "NULL", str(int(c["weight"]))]) + ")")
    print(f"-- The proofreading test's answer key from the tracer's finished cell ({ref['by']}, root {ref['root']}),")
    print(f"-- generated {datetime.datetime.now(datetime.timezone.utc).isoformat()}: {n['merge']} missing pieces and {n['cut']} wrong pieces")
    print(f"-- weighted by size, {n['keep']} keep checks at real branch tips, {n['endpoint']} branch ends ({int(share * 100)} percent of the score).")
    print(f"-- Pass mark {cfg['pass_mark']}. Replaces every check of the test. Run in the Supabase SQL editor after the schema file.")
    print("BEGIN;")
    print(f"UPDATE public.proofreading_tests SET pass_mark = {int(cfg['pass_mark'])}, feedback = {sql_str(cfg.get('feedback', 'detail'))} WHERE title = {title};")
    print(f"DELETE FROM public.proofreading_test_checks WHERE test_id = (SELECT id FROM public.proofreading_tests WHERE title = {title});")
    print("INSERT INTO public.proofreading_test_checks (test_id, ordinal, kind, label, supervoxel_a, supervoxel_b, point_a, point_b, radius_nm, weight)")
    print("SELECT t.id, v.ordinal::integer, v.kind, v.label, v.sv_a, v.sv_b, v.point_a::jsonb, v.point_b::jsonb, v.radius::integer, v.weight::integer")
    print(f"FROM (SELECT id FROM public.proofreading_tests WHERE title = {title}) t, (VALUES")
    print(",\n".join(lines))
    print(") AS v(ordinal, kind, label, sv_a, sv_b, point_a, point_b, radius, weight);")
    print("COMMIT;")


if __name__ == "__main__":
    main()
