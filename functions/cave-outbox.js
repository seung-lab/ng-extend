// Saves waiting for CAVE (Ames 2026-10-14): the rules for ewSecureWrite's
// "outbox.*" actions. Table: supabase-cave-outbox.sql. Client:
// src/cave_outbox.ts.
//
// When CAVE is down, a completion or cell type waits in our own table and the
// player's browser sends it once CAVE is back, with the player's own sign in.
// This file only keeps the list: it never talks to CAVE. Every action works on
// the caller's own rows.

// The CAVE hosts the game writes to. A row names one of these, so the
// player's browser never sends its sign in anywhere else. Keep in step with
// CAVE_HOSTS in src/cave_outbox.ts and the caveServer values in src/config.ts.
const CAVE_HOSTS = ["minnie.microns-daf.com", "hc.himc-cave.com", "cave.fanc-fly.com", "prod.flywire-daf.com", "global.daf-apis.com"];
const KINDS = ["complete", "cell_type"];
const MAX_WAITING = 200; // per player: a CAVE outage of days, not a flood
const NAME = /^[A-Za-z0-9_.\-]{1,80}$/;

const bad = msg => Object.assign(new Error(msg), { status: 400 });

function caveServerOk(s) {
  if (typeof s !== "string" || s.length > 200) return false;
  let u;
  try { u = new URL(s); } catch (e) { return false; }
  return u.protocol === "https:" && CAVE_HOSTS.includes(u.host) && !u.username && !u.password && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash;
}

const isPoint = p => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e9);

/** The row to store for an item a player hands in, or throws a 400. */
function cleanItem(item, userId) {
  const it = item || {};
  if (!KINDS.includes(it.kind)) throw bad("Unknown kind of save.");
  if (!caveServerOk(it.caveServer)) throw bad("Not a CAVE server the game writes to.");
  for (const k of ["dataset", "alignedVolume", "table"]) if (!NAME.test(String(it[k] || ""))) throw bad(`Bad ${k}.`);
  if (it.datastack != null && it.datastack !== "" && !NAME.test(String(it.datastack))) throw bad("Bad datastack.");
  if (!/^\d{1,20}$/.test(String(it.rootId || ""))) throw bad("Bad cell ID.");
  if (!isPoint(it.pt)) throw bad("Bad point.");
  const a = it.annotation;
  if (!a || typeof a !== "object" || Array.isArray(a) || JSON.stringify(a).length > 2000) throw bad("Bad annotation.");
  // What CAVE files the save under is the point, so it must be the item's own.
  if (!a.pt || !isPoint(a.pt.position) || a.pt.position.some((n, i) => n !== it.pt[i])) throw bad("The annotation's point is not the item's point.");
  for (const [k, v] of Object.entries(a)) {
    if (k === "pt") continue;
    if (!/^[a-z_]{1,40}$/.test(k) || !["string", "boolean", "number"].includes(typeof v) || String(v).length > 300) throw bad("Bad annotation field.");
  }
  if (it.kind === "complete" && !(typeof a.tag === "string" && (a.tag === "complete" || a.tag.startsWith("complete|")))) throw bad("A completion is tagged complete.");
  const replaces = it.replacesId == null ? null : Number(it.replacesId);
  if (replaces !== null && !(Number.isSafeInteger(replaces) && replaces > 0)) throw bad("Bad replacesId.");
  return {
    user_id: userId, kind: it.kind, dataset: String(it.dataset), cave_server: new URL(it.caveServer).origin,
    aligned_volume: String(it.alignedVolume), datastack: String(it.datastack || ""), table_name: String(it.table),
    root_id: String(it.rootId), pt: it.pt, annotation: a, replaces_id: it.kind === "cell_type" ? replaces : null,
  };
}

/** What a player's browser is handed back: enough to send it, nothing else. */
const forClient = r => ({ id: r.id, kind: r.kind, dataset: r.dataset, caveServer: r.cave_server, alignedVolume: r.aligned_volume,
  datastack: r.datastack, table: r.table_name, rootId: r.root_id, pt: r.pt, annotation: r.annotation, replacesId: r.replaces_id,
  attempts: r.attempts, createdAt: r.created_at });

const ownId = id => { const n = Number(id); if (!Number.isSafeInteger(n) || n <= 0) throw bad("Bad id."); return n; };

/**
 * One outbox action for player `me`. `db` is restDb(sb) below (a fake in the
 * tests). Returns what the browser is told.
 */
async function outboxAction(action, args, { db, me, isAdmin }) {
  const now = new Date().toISOString();
  switch (action) {
    case "outbox.add": {
      const row = cleanItem(args.item, me.id);
      // One waiting save per cell and kind: a newer cell type replaces the
      // one still waiting, a second completion is the same completion.
      const same = await db.waiting(me.id, { kind: row.kind, dataset: row.dataset, root_id: row.root_id });
      if (same.length) {
        const kept = await db.patch(same[0].id, me.id, { ...row, created_at: now, attempts: 0, last_error: null });
        for (const extra of same.slice(1)) await db.patch(extra.id, me.id, { status: "cancelled" });
        return forClient(kept);
      }
      if ((await db.countWaiting(me.id)) >= MAX_WAITING) throw Object.assign(new Error("Too many saves are waiting for CAVE."), { status: 429 });
      return forClient(await db.insert(row));
    }
    case "outbox.mine":
      return (await db.waiting(me.id)).map(forClient);
    case "outbox.sent": {
      const annotationId = args.annotationId == null ? null : Number(args.annotationId);
      const r = await db.patch(ownId(args.id), me.id, { status: "sent", sent_at: now, last_try_at: now,
        annotation_id: Number.isSafeInteger(annotationId) ? annotationId : null }, true);
      return { sent: !!r };
    }
    case "outbox.fail": {
      const id = ownId(args.id);
      const cur = await db.get(id, me.id);
      if (!cur || cur.status !== "waiting") return { waiting: false };
      await db.patch(id, me.id, { attempts: (cur.attempts || 0) + 1, last_try_at: now, last_error: String(args.error || "").slice(0, 300) }, true);
      return { waiting: true };
    }
    case "outbox.cancel": {
      // By id, or by cell: an un-mark of a completion still waiting.
      if (args.id != null) return { cancelled: !!(await db.patch(ownId(args.id), me.id, { status: "cancelled" }, true)) };
      if (!KINDS.includes(args.kind) || !NAME.test(String(args.dataset || "")) || !/^\d{1,20}$/.test(String(args.rootId || ""))) throw bad("Bad cell.");
      const same = await db.waiting(me.id, { kind: args.kind, dataset: String(args.dataset), root_id: String(args.rootId) });
      for (const r of same) await db.patch(r.id, me.id, { status: "cancelled" });
      return { cancelled: same.length };
    }
    // For the Admin Hub: how many wait, the oldest, and for how many players.
    case "outbox.summary": {
      if (!isAdmin) throw Object.assign(new Error("Admins only"), { status: 403 });
      return summarize(await db.allWaiting());
    }
    default:
      throw bad(`unknown action ${action}`);
  }
}

function summarize(rows) {
  const players = new Set(rows.map(r => r.user_id));
  const oldest = rows.reduce((m, r) => (!m || r.created_at < m ? r.created_at : m), null);
  const byKind = { complete: 0, cell_type: 0 };
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  return { waiting: rows.length, players: players.size, oldest, byKind };
}

/** The table, through the service key client from index.js (ewSb). */
function restDb(sb) {
  const eq = v => `eq.${encodeURIComponent(v)}`;
  return {
    waiting: (userId, where = {}) => sb(`cave_outbox?user_id=${eq(userId)}&status=eq.waiting${Object.entries(where).map(([k, v]) => `&${k}=${eq(v)}`).join("")}&order=created_at.asc&limit=${MAX_WAITING}`),
    countWaiting: async userId => (await sb(`cave_outbox?user_id=${eq(userId)}&status=eq.waiting&select=id&limit=${MAX_WAITING}`)).length,
    allWaiting: () => sb("cave_outbox?status=eq.waiting&select=user_id,kind,created_at&limit=5000"),
    get: async (id, userId) => (await sb(`cave_outbox?id=eq.${id}&user_id=${eq(userId)}&limit=1`))[0] || null,
    insert: async row => (await sb("cave_outbox", { method: "POST", body: JSON.stringify(row) }))[0],
    // waitingOnly: only a row still waiting changes (a sent one stays sent).
    patch: async (id, userId, fields, waitingOnly) => (await sb(`cave_outbox?id=eq.${id}&user_id=${eq(userId)}${waitingOnly ? "&status=eq.waiting" : ""}`,
      { method: "PATCH", body: JSON.stringify(fields) }))[0] || null,
  };
}

module.exports = { outboxAction, restDb, cleanItem, caveServerOk, summarize, CAVE_HOSTS, MAX_WAITING };
