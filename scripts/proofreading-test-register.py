"""Register the proofreading test cell: coordinates in, SQL out. Reads only.

Ames describes the test cell in config/proofreading-test.json: the cell's
root, its start view, and one line per error (a cut, a merge, a piece that
must stay, a neighbour that must stay apart, or a branch end to annotate),
each as viewer coordinates. Only the volume can say which supervoxel sits at
a coordinate, so this script looks each one up (cloud-volume, layer 1), reads
the root of every supervoxel at the baseline instant, and checks the cell is
in the start state each check expects at that instant. Then it prints the SQL
that registers the test for the Supabase SQL editor. Nothing is written to
the graph or the database.

  python scripts/proofreading-test-register.py                 # inspect, then SQL
  python scripts/proofreading-test-register.py --inspect       # inspect only
  python scripts/proofreading-test-register.py --at 2026-10-10T20:16:45Z
      the baseline: the cell's state at that instant is the start state, and
      every operation after it is undone when the test is reset (default now)
  python scripts/proofreading-test-register.py --anchor 70213,43077,1372
      a soma coordinate for this run only, when the config has none
  python scripts/proofreading-test-register.py --endpoints-only
      only the endpoint checks, as an INSERT for the test already registered
      under the config's title (no graph lookups)

The CAVE token comes from CAVE_SERVICE_TOKEN, else cloud-volume's own secret
file (~/.cloudvolume/secrets/cave-secret.json).
"""
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "..", "config", "proofreading-test.json")

# What each kind expects of its two supervoxels before and after the test.
# 'together' = one root, 'apart' = different roots.
EXPECT = {
    "cut":   ("together", "apart"),     # a false merge: starts fused, must be cut
    "merge": ("apart", "together"),     # a missing piece: starts loose, must be merged on
    "keep":  ("together", "together"),  # a real part of the cell: must survive
    "apart": ("apart", "apart"),        # a neighbour: must not be merged on
}


def sql_str(value):
    return "'" + str(value).replace("'", "''") + "'"


def arg(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else None
    return None


def parse_when(text):
    if text is None:
        return None
    if text.isdigit():
        ms = int(text)
        return datetime.datetime.fromtimestamp(ms / 1000 if ms > 1e11 else ms, datetime.timezone.utc)
    return datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))


def endpoint_rows(cfg, first_ordinal):
    """The endpoint checks from the config: a point each, a radius in nm."""
    radius = int(cfg.get("endpoint_radius_nm", 1500))
    rows, problems = [], []
    for j, e in enumerate(cfg.get("endpoints", [])):
        pt = e if isinstance(e, list) else e.get("point")
        if not pt or len(pt) != 3:
            problems.append(f"endpoint {j + 1}: no point")
            continue
        rows.append({"ordinal": first_ordinal + j, "kind": "endpoint",
                     "label": (e.get("label") if isinstance(e, dict) else "") or f"Branch end {j + 1}",
                     "sv_a": "", "sv_b": "", "point_a": [int(v) for v in pt], "point_b": None,
                     "radius": int(e.get("radius_nm", radius)) if isinstance(e, dict) else radius})
    return rows, problems


def check_values(rows):
    lines = []
    for r in rows:
        lines.append("  (" + ", ".join([
            str(r["ordinal"]), sql_str(r["kind"]), sql_str(r["label"]), sql_str(r["sv_a"]), sql_str(r["sv_b"]),
            sql_str(json.dumps(r["point_a"])), sql_str(json.dumps(r["point_b"])) if r["point_b"] else "NULL",
            "NULL" if r["radius"] is None else str(r["radius"])]) + ")")
    return ",\n".join(lines)


CHECK_COLUMNS = "(test_id, ordinal, kind, label, supervoxel_a, supervoxel_b, point_a, point_b, radius_nm)"
# Every value is cast: a column of the VALUES list that is NULL throughout is
# typed text by Postgres, which the integer radius column refused (2026-10-11).
CHECK_SELECT = "SELECT t.id, v.ordinal::integer, v.kind, v.label, v.sv_a, v.sv_b, v.point_a::jsonb, v.point_b::jsonb, v.radius::integer"


def print_endpoints_only(cfg):
    rows, problems = endpoint_rows(cfg, len(cfg["checks"]) + 1)
    if problems or not rows:
        sys.exit("PROBLEMS: " + "; ".join(problems or ["no endpoints in the config"]))
    title = sql_str(cfg["title"])
    print("-- Endpoint checks for the test " + title + ", generated " + datetime.datetime.now(datetime.timezone.utc).isoformat())
    print("-- Run in the Supabase SQL editor after the test is registered. Re-running replaces the endpoints.")
    print("BEGIN;")
    print("DELETE FROM public.proofreading_test_checks WHERE kind = 'endpoint' AND test_id = (SELECT id FROM public.proofreading_tests WHERE title = " + title + ");")
    print("INSERT INTO public.proofreading_test_checks " + CHECK_COLUMNS)
    print(CHECK_SELECT)
    print("FROM (SELECT id FROM public.proofreading_tests WHERE title = " + title + ") t, (VALUES")
    print(check_values(rows))
    print(") AS v(ordinal, kind, label, sv_a, sv_b, point_a, point_b, radius);")
    print("COMMIT;")


def main():
    inspect_only = "--inspect" in sys.argv
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    if "--endpoints-only" in sys.argv:
        print_endpoints_only(cfg)
        return
    if cfg["pcg_server"] != "https://minnie.microns-daf.com" or cfg["pcg_table"] != "pinky_nf_v2":
        sys.exit("Only the Pinky sandbox is approved for the test cell.")
    from cloudvolume import CloudVolume
    token = os.environ.get("CAVE_SERVICE_TOKEN")
    kwargs = {"secrets": {"token": token}} if token else {}
    cv = CloudVolume(f"graphene://{cfg['pcg_server']}/segmentation/table/{cfg['pcg_table']}",
                     use_https=True, progress=False, fill_missing=True, **kwargs)
    view = cfg.get("view_resolution", [4, 4, 40])
    res = [int(v) for v in cv.resolution]
    at = parse_when(arg("--at")) or datetime.datetime.now(datetime.timezone.utc)
    baseline = at.isoformat()
    print(f"volume resolution {res} nm, view voxels {view} nm, bounds {cv.bounds}", file=sys.stderr)
    print(f"baseline {baseline}: roots are read as of this instant", file=sys.stderr)

    cache = {}

    def lookup(pt):
        key = tuple(int(v) for v in pt)
        if key in cache:
            return cache[key]
        x, y, z = [int(float(pt[i]) * view[i] // res[i]) for i in range(3)]
        sv = int(cv[x:x + 1, y:y + 1, z:z + 1][0, 0, 0, 0])
        root = int(cv.get_roots([sv], timestamp=at)[0]) if sv else 0
        now = int(cv.get_roots([sv])[0]) if sv else 0
        cache[key] = (str(sv), str(root), str(now), [x, y, z])
        return cache[key]

    problems = []
    anchor = cfg.get("anchor")
    override = arg("--anchor")
    if override:
        anchor = [int(v) for v in override.split(",")]
        print(f"anchor from the command line (not the config): {anchor}", file=sys.stderr)
    if not anchor:
        problems.append("No anchor (the soma) in the config: every one sided check needs it.")
        anchor_sv = anchor_root = anchor_now = None
    else:
        anchor_sv, anchor_root, anchor_now, vol = lookup(anchor)
        print(f"anchor {anchor} -> volume {vol}, supervoxel {anchor_sv}, root at baseline {anchor_root}, now {anchor_now}", file=sys.stderr)
        if anchor_sv == "0":
            problems.append("The anchor is on no supervoxel (background).")
        elif anchor_root != str(cfg["root"]):
            problems.append(f"At the baseline the anchor is on root {anchor_root}, not the test cell {cfg['root']}.")

    rows = []
    for i, c in enumerate(cfg["checks"]):
        kind = c["kind"]
        if kind == "endpoint":
            continue
        if kind not in EXPECT:
            problems.append(f"check {i + 1}: unknown kind {kind}")
            continue
        a = c.get("a")
        b = c.get("b")
        if not a and not b:
            problems.append(f"check {i + 1} ({c.get('label', '')}): no coordinates")
            continue
        sides = []
        for name, pt in (("a", a), ("b", b)):
            if pt:
                sv, root, now, vol = lookup(pt)
                sides.append((name, pt, sv, root, now))
            elif anchor_sv:
                sides.append((name, anchor, anchor_sv, anchor_root, anchor_now))
        if len(sides) < 2:
            problems.append(f"check {i + 1} ({c.get('label', '')}): one side only and no anchor")
            continue
        (na, pa, sva, roota, nowa), (nb, pb, svb, rootb, nowb) = sides
        start, end = EXPECT[kind]
        together = sva != "0" and svb != "0" and roota == rootb
        state = "together" if together else "apart"
        ok = sva != "0" and svb != "0" and sva != svb and state == start
        print(f"check {i + 1} {kind:6} {c.get('label', '')}\n"
              f"   a {pa} -> sv {sva} root {roota} (now {nowa})\n"
              f"   b {pb} -> sv {svb} root {rootb} (now {nowb})\n"
              f"   at baseline {state}, start state wanted {start}: {'OK' if ok else 'PROBLEM'}", file=sys.stderr)
        if sva == "0" or svb == "0":
            problems.append(f"check {i + 1}: a coordinate is on no supervoxel")
        elif sva == svb:
            problems.append(f"check {i + 1}: both sides are the same supervoxel")
        elif state != start:
            problems.append(f"check {i + 1}: at the baseline the cell is not in this check's start state ({state}, wanted {start})")
        rows.append({"ordinal": i + 1, "kind": kind, "label": c.get("label", ""), "sv_a": sva, "sv_b": svb,
                     "point_a": list(pa), "point_b": list(pb), "radius": None})

    end_rows, end_problems = endpoint_rows(cfg, len(cfg["checks"]) + 1)
    rows.extend(end_rows)
    problems.extend(end_problems)

    if problems:
        print("\nPROBLEMS:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
    if override and not inspect_only:
        print("\nNo SQL: the anchor came from the command line. Put the soma in the config to register.", file=sys.stderr)
    if inspect_only or problems or override:
        sys.exit(2 if problems else 0)

    cols = ["title", "dataset", "pcg_server", "pcg_table", "state_url", "anchor_supervoxel", "root_at_baseline",
            "baseline_at", "hold_minutes", "pass_mark", "damage_fails", "attempts_allowed", "retry_hours", "feedback"]
    vals = [sql_str(cfg["title"]), sql_str(cfg["dataset"]), sql_str(cfg["pcg_server"]), sql_str(cfg["pcg_table"]),
            sql_str(cfg["state_url"]), sql_str(anchor_sv), sql_str(cfg["root"]), sql_str(baseline),
            str(int(cfg.get("hold_minutes", 60))), str(int(cfg.get("pass_mark", 100))),
            "true" if cfg.get("damage_fails", True) else "false",
            "NULL" if cfg.get("attempts_allowed") in (None, "") else str(int(cfg["attempts_allowed"])),
            str(int(cfg.get("retry_hours", 0))), sql_str(cfg.get("feedback", "summary"))]
    print("-- Proofreading test registration, generated " + datetime.datetime.now(datetime.timezone.utc).isoformat())
    print("-- Baseline " + baseline + ": every graph operation on the cell after this instant is undone at reset.")
    print("-- Run in the Supabase SQL editor. The test stays disabled until you enable it (last line).")
    print("BEGIN;")
    print("WITH t AS (")
    print(f"  INSERT INTO public.proofreading_tests ({', '.join(cols)})")
    print(f"  VALUES ({', '.join(vals)})")
    print("  RETURNING id")
    print(")")
    print("INSERT INTO public.proofreading_test_checks " + CHECK_COLUMNS)
    print(CHECK_SELECT + " FROM t, (VALUES")
    print(check_values(rows))
    print(") AS v(ordinal, kind, label, sv_a, sv_b, point_a, point_b, radius);")
    print("COMMIT;")
    print("-- When ready: UPDATE public.proofreading_tests SET enabled = true WHERE title = " + sql_str(cfg["title"]) + ";")


if __name__ == "__main__":
    main()
