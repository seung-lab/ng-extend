const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

admin.initializeApp();
const db = admin.firestore();
const ewServiceKey = defineSecret("EW_SUPABASE_SERVICE_KEY");
const {pilotContext, requirePilot} = require("./pilot-access");
const {authorizePilotData, conflicts:pilotConflicts} = require("./pilot-data");

// Reference docs for the Slack bot — uploaded to Anthropic Files via
// scripts/upload-bot-docs.js. JSON shape: {"<filename>": "<file_id>"}.
// Empty array if not yet uploaded; bot just runs without doc context.
const BOT_DOCS = (() => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "bot-docs.json"), "utf8"));
    // Sort keys for deterministic prompt prefix → keeps prompt cache stable.
    return Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filename, file_id]) => ({ filename, file_id }));
  } catch { return []; }
})();
console.log(`[bot] Loaded ${BOT_DOCS.length} reference docs:`, BOT_DOCS.map(d => d.filename));

const anthropicKey = defineSecret("ANTHROPIC_API_KEY");
const slackBotToken = defineSecret("SLACK_BOT_TOKEN");
const slackSigningSecret = defineSecret("SLACK_SIGNING_SECRET");

// ─────────────────────────────────────────────────────────────────────────────
// Slack bot — Amy's Claude. Responds to @mentions in allowed channels only.
// Event Subscriptions request URL points here; subscribes to app_mention.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_CHANNEL_IDS = new Set([
  "C09BZ6J6QMV", // #cave_backend_community
  "C0AJDS4AMEH", // #ai_dev
  "C0BG5CN71C3", // #citsci_feedback (where the triage loop posts)
]);

// EyeWire II's Supabase, read-only, for triage status. This is the PUBLIC
// anon key the web app already ships in its bundle; it cannot write here
// because this bot only ever issues GETs with it.
const EW_SUPABASE_URL = "https://javthknksdcrlhiaaptj.supabase.co";
const EW_SUPABASE_ANON = "sb_publishable_a5r5rfbOuWNoVw0Qb_LtRg_xA4H6Jxb";


const NG_EXTEND_SYSTEM_PROMPT = `You are "Amy's Claude", a Slack bot helping the EyeWire II / Seung lab community. You're an expert on Amy Sterling's ng-extend project (EyeWire II community Chrome extension for neuroglancer).

BE BRIEF. Slack replies should be 1-4 sentences unless asked for detail. Use bullet points for lists. Skip pleasantries.

KEY CONTEXT you know about:

**ng-extend** — Vue 3 + Pinia Chrome extension on top of neuroglancer. Repo: seung-lab/ng-extend. Amy's fork: amyleesterling/ng-extend. Active branch: eyewire-ii-community. Deploys via App Engine (service: brain-wire). Also GitHub Pages at amyleesterling.github.io/eyewire-ii/.

**Datasets** — the app is MULTI-SERVER as of 2026-09-22. Do not assume minnie.
- stroeh_mouse_retina on minnie.microns-daf.com. ~22,686 segments. Layer name "stroeh_mouse_retina", alias "eyewire_ii". This is production.
- pinky_sandbox, minnie65_public, minnie65_live: also minnie.
- **pni_mec (MEC, medial entorhinal cortex) on hc.himc-cave.com.** The first dataset NOT on minnie. Built by Eric with Zhihao. This is the first dataset the EyeWire citizen scientists will test.

**MEC specifics** (verified 2026-09-22, re-verify before repeating):
- datastack pni_mec, aligned volume pni_mec (id 17, display name "MEC"), PCG table pni_mec
- image precomputed://https://c10s.pni.princeton.edu/mec_alignment_2025-09/alignment/img/v2, uint8, jxl encoded
- voxel 16 x 16 x 45 nm. Z is 45, NOT 40 like the others.
- segmentation voxel_offset 76728, 65192, 8, size 126968 x 83616 x 9932. A camera position copied from another dataset lands outside the segmented block.
- hc.himc-cave.com uses the SAME global.daf-apis.com/sticky_auth realm as minnie, so one login covers both.
- Eric's shared spelunker states name the layers "img" and "seg". The app registers the segmentation layer as "pni_mec" instead, because "seg" is too short and generic to key a CAVE config on.
- cluster 7 is the presumed stellate population: 1,102 nuclei, 1,094 cells.

**MEC is known broken server-side as of 2026-09-22, re-verified unchanged on 2026-09-23.** This is what Eric and Zhihao were hitting. Observed with a real CAVE token:
- the annotation service on hc.himc-cave.com returns 400 invalid_table_id for aligned_volume pni_mec, while returning 200 for minnie's volumes (minnie65_phase3, stroeh_mouse_retina, pinky100). It appears to be reading the wrong aligned-volume registry. pni_mec is not registered with it.
- materialize on hc.himc-cave.com returns 503 from nginx for /materialize/api/v3/datastack/pni_mec/versions, while minnie returns a real version list for the retina.
- the chunkedgraph on hc IS healthy.
- the same two calls against minnie for stroeh_mouse_retina returned 200 on 2026-09-23 (a real table list, and materialized versions), so this is specific to pni_mec and not a general CAVE outage.
Consequence: viewing and merge/split proofreading work on MEC. Mark Complete, Cell Type, the lightbulb and the leaderboard do NOT, because there is no cell_status or cell_type table and none can be created until CAVE registers the aligned volume. Planned names once fixed: mec_cell_status_v1 (schema bound_tag_user, required for leaderboard credit) and mec_cell_type_v1.
This is a snapshot, not a standing truth. If someone says it is fixed, believe them over this prompt.

**MEC shipped on 2026-09-22 and is live.** It is in the EyeWire II dataset switcher now (build 2e22c4b on eyewire-ii-community). Citizen scientists can view it and proofread it, split and merge, today. Mark Complete, cell typing and the leaderboard error out, for the CAVE reason above. Caveat worth repeating to anyone on a phone: the mobile build, eyewire-ii-mobile, does NOT contain MEC, so connectome.quest/play sends phones to a build without it. Use a computer.

**Public pages**: connectome.quest/mec is the dataset page, connectome.quest/mec/volume is the imaged block to scale with two real reconstructed cells and scale bars. Old /mec.html and /mec-volume.html redirect.

**"Meet an MEC neuron" went live on connectome.quest/mec on 2026-09-23** (verified from the live page, not just the commit). Seven real reconstructions from this block, one each of stellate, pyramidal, inhibitory interneuron, astrocyte, oligodendrocyte, microglia and bipolar, with a render per card and an optional interactive gallery that loads spinnable meshes on click. Every type on it is PRESUMED: called from nucleus size, then checked against the cell's layer, never confirmed by a human looking at the shape. Say that plainly if anyone asks, and point them at the segment ids and soma coordinates published on the page (also /assets/mec/gallery/proofread.csv and cells.json) so they can check the calls themselves. Do not describe these as validated cell types.

**MEC counts, measured 2026-09-22 from the nuclei annotations, which carry both layer and nucleus-size cluster in their description text**: 62,631 nuclei marked; 12,742 presumed pyramidal (cluster 6); 1,370 presumed stellate (cluster 7); 48,519 in six unnamed clusters with no cell type. 1,085 of the 1,370 presumed stellate are in layer II, 79%, from a clustering that never saw the layer labels. Layer totals I to VI: 7871, 10463, 14203, 4200, 16215, 9679. The number of NEURONS is not known: at least 14,112 carry a neuron type name, certainly more, and the unnamed clusters mix interneurons with glia and vasculature. Do not quote a neuron count as if it were settled.

**Joining Amy's cell type labels to those clusters** (2026-09-22) suggests cluster 4 is largely astrocytes, cluster 3 largely oligodendrocytes, and that inhibitory neurons do NOT separate by nucleus size, splitting across clusters 6 and 5. Treat as provisional.

**Getting a mesh out of MEC**: cloudvolume cannot, cv.mesh.get raises "no shard configuration in the mesh info file for level 10". Use the meshing manifest at /meshing/api/v1/table/pni_mec/manifest/<root>:0?verify=1, range-fetch the shard fragments from the public bucket princeton-eric-mec-prod-east1 under ws/seg_20260713164845/graphene_meshes/initial/, and decode with DracoPy. The volume sets uniform_draco_grid_size so decoded vertices are already in global nanometres.

**Root ids in MEC go stale** because it is actively proofread. Pin a cell to a nucleus position, then resolve the current root by reading the segmentation at a point and calling /node/<supervoxel>/root. Supervoxel ids from older segmentation versions return HTTP 500 "Cannot find root id".

**CAVE infrastructure (stroeh_mouse_retina)**:
- PCG: https://minnie.microns-daf.com/segmentation/table/stroeh_mouse_retina
- AnnotationEngine (writes): /annotation/api/v2/aligned_volume/stroeh_mouse_retina/
- Materializer (reads): /materialize/api/v3/datastack/stroeh_mouse_retina/
- Contacts: Akhilesh (first contact, materialization scheduling), #shared_cave_seunglab (escalation), Forrest/Derrick (actual fixes). For MEC specifically: Eric is the dataset owner, with Zhihao.

**CAVE tables**:
- eyewire_ii_cell_status — completions, tag='complete', bound_tag schema (pt_position + tag)
- eyewire_ii_cell_type — cell_type_local schema (pt_position + cell_type + classification_system)

**CAVE state — ALWAYS live-probe, never recite cached claims.** The CAVE backend changes frequently. Every claim about CORS, deployed versions, materialized version numbers, annotation counts, "known bugs", or whether a specific endpoint works MUST come from a fresh check_cave_health call (or a fresh fetch). If a user corrects you on CAVE state, drop your prior claim immediately and update from their info. Do NOT defend a stale belief with "but the documentation says...".

**delta_service.ts (formerly lightbulb_service.ts)** — src/widgets/lightbulb_service.ts. Client code that queries cell status/type via Materializer (live + frozen-version fallback) and writes via AnnotationEngine. Has localStorage write-through so the writer sees their own writes pre-materialization.

**Other active projects** Amy runs: neuronsnake.com (NEURON Game), thislast.com, ytho.club (daily philosophical questions), findmytown.com, shield (fintech).

**YOU HAVE TOOLS.** When asked about ng-extend code, use fetch_ng_extend_file; pass repo="amyleesterling" if a file looks like it is missing recent work, because Amy's fork is often ahead of seung-lab. When asked about CAVE status, use check_cave_health with the right dataset argument (pni_mec for MEC, it is on a different server). Know its limit: it proves reachability and CORS only. It cannot see whether a table exists, whether an aligned volume is registered, or whether materialization runs, because CAVE checks auth first and you have no CAVE token. If someone asks you to confirm MEC's tables, say plainly that you cannot check that and a signed-in human has to. Prefer tool calls over guessing. If asked something outside this context, say so honestly. Route CAVE issues to #shared_cave_seunglab — don't name individuals.

**The feedback triage loop (#citsci_feedback), live since 2026-09-25.** User reports get a triage proposal in their Slack thread. An approver (Amy or Celia) replies approve or dismiss, in the thread or in Admin Hub > Triage; both show the same list. An approved fix is built by Claude in GitHub Actions (seung-lab/ng-extend, workflow "Triage Implement", on Amy's Princeton Claude subscription) on branch triage/<first 8 of the row id>, which deploys a preview at https://triage-<id8>-dot-brain-wire-dot-seung-lab.ue.r.appspot.com/ using the real data. The approver is the tester and is tagged every 10 minutes until they reply: good (deploys live), ship to test (goes live for a real-data test, then good or revert), a question ending in ? (Claude answers), anything else (Claude fixes it, new preview), or hand off to @someone. Claude can also stop and ask a question; the tester's answer sends it back to work. When anyone asks where a fix or Claude's work is, call get_triage_status (with the thread's ts if you are in a triage thread) and answer from the row: its state, preview link, run link, and who it is waiting on. Approvals from before 2026-09-25 were never built by anything unless the row says otherwise. You cannot approve, test, or deploy anything yourself; only people can, by replying in the thread. Mentions of you are skipped by the loop, so they never count as a tester's verdict.`;

async function verifySlackSignature(req, signingSecret) {
  const timestamp = req.header("X-Slack-Request-Timestamp");
  const slackSig = req.header("X-Slack-Signature");
  if (!timestamp || !slackSig) {
    console.warn("verify: missing headers", { hasTs: !!timestamp, hasSig: !!slackSig });
    return false;
  }
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
    console.warn("verify: stale timestamp", timestamp);
    return false;
  }
  // req.rawBody in Firebase Functions v2 is a Buffer of the exact bytes Slack signed
  if (!req.rawBody) {
    console.error("verify: req.rawBody missing!");
    return false;
  }
  const sigBasestring = `v0:${timestamp}:${req.rawBody.toString("utf8")}`;
  const mySig = "v0=" + crypto.createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");
  const ok = mySig === slackSig;
  if (!ok) {
    console.warn("verify: mismatch", {
      mySigPrefix: mySig.slice(0, 15),
      slackSigPrefix: slackSig.slice(0, 15),
      secretLen: signingSecret?.length,
      bodyLen: req.rawBody.length,
      tsAge: Date.now()/1000 - parseInt(timestamp, 10),
    });
  }
  return ok;
}

async function slackPost(token, method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ─── Tool definitions for the bot ───────────────────────────────────────────

const BOT_TOOLS = [
  {
    name: "fetch_ng_extend_file",
    description: "Read a file from seung-lab/ng-extend (branch: eyewire-ii-community) via GitHub raw. Use this to answer code questions precisely instead of guessing. Returns first 8000 chars.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path, e.g. 'src/widgets/lightbulb_service.ts' or 'src/config.ts'" },
        repo: { type: "string", enum: ["seung-lab", "amyleesterling"], description: "Which remote to read. Default seung-lab (production). Amy's fork amyleesterling is often AHEAD - use it when a file seems to be missing recent work." },
      },
      required: ["path"],
    },
  },
  {
    name: "check_cave_health",
    description: "LIVE-probe CAVE reachability for one dataset. Pass dataset='pni_mec' for MEC (server hc.himc-cave.com) or 'stroeh_mouse_retina' for the retina (minnie.microns-daf.com); default is the retina. Probes which CAVE services answer, CORS preflights, and a junk-token request. Returns ONLY currently observed values. IMPORTANT: it proves reachability and CORS only. It CANNOT see whether a table or aligned volume exists or whether materialization runs, because CAVE checks auth first and this bot has no CAVE token. Never report a dataset as healthy on the strength of this tool alone.",
    input_schema: {
      type: "object",
      properties: {
        dataset: { type: "string", enum: ["stroeh_mouse_retina", "pni_mec"], description: "Which dataset's CAVE deployment to probe. Default stroeh_mouse_retina." },
      },
      required: [],
    },
  },
  {
    name: "get_triage_status",
    description: "Read the EyeWire II feedback triage queue (Supabase feedback_triage): user reports, the proposed action, whether it was approved, and where the fix is in the implement-on-approval loop (Claude builds it on a triage/<id> branch, a preview site, the tester's replies, live). Pass thread_ts to get the one report whose Slack thread that is, or query to search report text, or neither for everything still open. Use it whenever someone asks where a fix or Claude's work is.",
    input_schema: {
      type: "object",
      properties: {
        thread_ts: { type: "string", description: "Slack thread ts of a triage thread in #citsci_feedback." },
        query: { type: "string", description: "Words from the report, e.g. 'yellow annotation'." },
      },
      required: [],
    },
  },
  // Persistent memory across Slack threads. Backed by a single Firestore doc
  // (bot_memory/files) with a {path: content} map. Use for things you'd want
  // to remember the next time someone asks (corrections from Forrest, deployed
  // versions, decisions). The model decides what's worth remembering.
  {
    type: "memory_20250818",
    name: "memory",
  },
];

// ─── Tool implementations ──────────────────────────────────────────────────

const NG_EXTEND_REPOS = { "seung-lab": "seung-lab/ng-extend", "amyleesterling": "amyleesterling/ng-extend" };

async function toolFetchNgExtendFile({ path, repo }) {
  if (!path || path.includes("..") || path.startsWith("/")) return "(invalid path)";
  const slug = NG_EXTEND_REPOS[repo] || NG_EXTEND_REPOS["seung-lab"];
  const url = `https://raw.githubusercontent.com/${slug}/eyewire-ii-community/${path}`;
  const r = await fetch(url);
  if (!r.ok) return `(fetch failed from ${slug}: ${r.status} ${r.statusText} for ${path}. If this is new work it may only exist on the amyleesterling fork - retry with repo="amyleesterling".)`;
  const text = await r.text();
  return text.length > 8000 ? text.slice(0, 8000) + `\n\n[truncated — full file is ${text.length} chars]` : text;
}

// Every dataset the bot can probe. MEC is the first one NOT on minnie.
const CAVE_TARGETS = {
  stroeh_mouse_retina: {
    base: "https://minnie.microns-daf.com",
    alignedVolume: "stroeh_mouse_retina",
    datastack: "stroeh_mouse_retina",
    cellStatusTable: "eyewire_ii_cell_status_v2",
    pcgTable: "stroeh_mouse_retina",
  },
  pni_mec: {
    base: "https://hc.himc-cave.com",
    alignedVolume: "pni_mec",
    datastack: "pni_mec",
    cellStatusTable: "mec_cell_status_v1",
    pcgTable: "pni_mec",
  },
};

async function toolCheckCaveHealth({ dataset } = {}) {
  // ALL checks below are LIVE. Nothing here is a remembered claim.
  //
  // HARD LIMIT, state it rather than paper over it: this bot holds no CAVE
  // token. CAVE runs auth BEFORE resource resolution, so every authenticated
  // surface answers 401 invalid_token no matter what is wrong underneath.
  // Verified 2026-09-22: a GET with a junk bearer to a REAL aligned volume and
  // to a volume that does not exist on that server return byte-identical 401s.
  // So this tool can prove an endpoint is reachable and CORS-correct. It
  // CANNOT prove a table exists, that a volume is registered, or that
  // materialization is running. Do not let it imply otherwise.
  const key = CAVE_TARGETS[dataset] ? dataset : "stroeh_mouse_retina";
  const t = CAVE_TARGETS[key];
  const base = t.base;
  const origin = "https://eyewire-ii-community-dot-brain-wire-dot-seung-lab.ue.r.appspot.com";
  const probedAt = new Date().toISOString();
  const checks = [
    `Dataset: ${key}  (CAVE server ${base}, aligned volume ${t.alignedVolume})`,
    `Probed at: ${probedAt} (UTC)`,
  ];
  if (!CAVE_TARGETS[dataset] && dataset) {
    checks.push(`NOTE: "${dataset}" is not a dataset I know, probed ${key} instead. Known: ${Object.keys(CAVE_TARGETS).join(", ")}.`);
  }

  // 1. Which CAVE services are even answering on this host.
  for (const [label, path] of [
    ["annotation", "/annotation/api/versions"],
    ["materialize", "/materialize/api/versions"],
  ]) {
    try {
      const r = await fetch(`${base}${path}`);
      const body = (await r.text()).slice(0, 80).replace(/\s+/g, " ");
      if (r.ok) checks.push(`${label} service: up (HTTP ${r.status}, api versions ${body})`);
      else if (r.status === 503) checks.push(`${label} service: HTTP 503 from the proxy. NOTE minnie answers 503 here too, so 503 on this path is NOT by itself evidence of a fault.`);
      else checks.push(`${label} service: HTTP ${r.status}`);
    } catch (e) { checks.push(`${label} service: error (${e.message})`); }
  }

  // 2. CORS preflights: reachable and browser-usable?
  async function corsCheck(label, url, method) {
    try {
      const r = await fetch(url, {
        method: "OPTIONS",
        headers: {
          "Origin": origin,
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "content-type,authorization",
        },
      });
      const corsOrigin = r.headers.get("access-control-allow-origin");
      const corsMethods = r.headers.get("access-control-allow-methods");
      if (r.ok && corsOrigin) checks.push(`${label}: OK ${r.status} preflight, allow-origin=${corsOrigin}, methods=${corsMethods || "?"}`);
      else if (corsOrigin) checks.push(`${label}: WARN ${r.status} preflight (has CORS but non-2xx)`);
      else checks.push(`${label}: FAIL ${r.status} preflight, no CORS headers, a browser will block this cross-origin`);
    } catch (e) { checks.push(`${label}: error (${e.message})`); }
  }
  await corsCheck("AnnotationEngine preflight (writes)",
    `${base}/annotation/api/v2/aligned_volume/${t.alignedVolume}/table/${t.cellStatusTable}/annotations`, "POST");
  await corsCheck("Materializer preflight (reads)",
    `${base}/materialize/api/v3/datastack/${t.datastack}/query`, "POST");

  // 3. Junk-token GET. A 401 invalid_token means the endpoint is alive and
  //    reached its auth layer. It says nothing about what is behind it.
  try {
    const r = await fetch(`${base}/annotation/api/v2/aligned_volume/${t.alignedVolume}/table`, {
      headers: { "Origin": origin, "Authorization": "Bearer junk_health_probe" },
    });
    const corsOrigin = r.headers.get("access-control-allow-origin");
    const body = (await r.text()).slice(0, 120).replace(/\s+/g, " ");
    if (r.status === 401) checks.push(`AnnotationEngine junk-token GET: 401 as expected, endpoint alive and auth ran (CORS=${corsOrigin || "missing"}). Proves reachability ONLY.`);
    else if (r.status >= 500) checks.push(`AnnotationEngine junk-token GET: ${r.status}, endpoint is throwing before the auth check. ${body}`);
    else checks.push(`AnnotationEngine junk-token GET: ${r.status} ${body}`);
  } catch (e) { checks.push(`AnnotationEngine junk-token GET: error (${e.message})`); }

  checks.push("");
  checks.push("WHAT THIS CANNOT TELL YOU, and you must not claim it does: whether the aligned volume is registered with the annotation service, whether a table exists, whether materialization is running, or any row counts. All of those sit behind auth and this bot has no CAVE token. A signed-in human must run those. For MEC specifically, ask Eric or Zhihao, or check #shared_cave_seunglab.");

  return checks.join("\n");
}

// ─── Memory tool — Firestore-backed persistent storage ─────────────────────
// All memory files live in a single Firestore doc (bot_memory/files) with
// a `files` map: { "/memories/foo.md": "content...", ... }. Atomic writes
// via .set(). 1MB doc limit is plenty for bot-scale memory. Memory tool
// commands per Anthropic spec (memory_20250818).

const memoryDoc = () => db.collection("bot_memory").doc("files");

async function memRead() {
  const snap = await memoryDoc().get();
  return snap.exists ? (snap.data().files || {}) : {};
}
async function memWrite(files) {
  await memoryDoc().set({ files, updated_at: admin.firestore.FieldValue.serverTimestamp() });
}

async function toolMemory(input) {
  if (input.command !== "view") return "Shared memory is read-only. An administrator must review persistent changes.";
  const files = await memRead();
  const p = input.path;
  switch (input.command) {
    case "view": {
      // List directory: empty path, ends with /, or matches the root.
      if (!p || p === "/memories" || p.endsWith("/")) {
        const prefix = p && p !== "/memories" ? p : "/memories/";
        const items = Object.keys(files).filter(k => k.startsWith(prefix)).sort();
        if (!items.length) return `(empty: no files under ${prefix})`;
        return items.map(k => `- ${k}  (${files[k].length} chars)`).join("\n");
      }
      if (!(p in files)) return `Error: ${p} not found`;
      const lines = files[p].split("\n");
      const range = input.view_range;
      const slice = range ? lines.slice(range[0] - 1, range[1]) : lines;
      return slice.map((l, i) => `${(range ? range[0] + i : i + 1)}: ${l}`).join("\n");
    }
    case "create":
      files[p] = input.file_text;
      await memWrite(files);
      return `Created ${p} (${input.file_text.length} chars)`;
    case "str_replace": {
      if (!(p in files)) return `Error: ${p} not found`;
      const c = files[p];
      const occ = c.split(input.old_str).length - 1;
      if (occ === 0) return `Error: old_str not found in ${p}`;
      if (occ > 1) return `Error: old_str matches ${occ} places in ${p} — make it unique`;
      files[p] = c.replace(input.old_str, input.new_str);
      await memWrite(files);
      return `Replaced 1 occurrence in ${p}`;
    }
    case "insert": {
      if (!(p in files)) return `Error: ${p} not found`;
      const lines = files[p].split("\n");
      lines.splice(input.insert_line, 0, input.insert_text);
      files[p] = lines.join("\n");
      await memWrite(files);
      return `Inserted at line ${input.insert_line} in ${p}`;
    }
    case "delete":
      if (!(p in files)) return `Error: ${p} not found`;
      delete files[p];
      await memWrite(files);
      return `Deleted ${p}`;
    case "rename": {
      const o = input.old_path, n = input.new_path;
      if (!(o in files)) return `Error: ${o} not found`;
      files[n] = files[o]; delete files[o];
      await memWrite(files);
      return `Renamed ${o} -> ${n}`;
    }
    default:
      return `Unknown memory command: ${input.command}`;
  }
}

const TRIAGE_FIELDS = "id,status,recommendation,source_excerpt,rationale,spec,approver_note,reviewed_by,reviewed_at," +
  "impl_state,impl_branch,impl_summary,impl_run_url,impl_attempts,preview_url,feedback_log,nag_count," +
  "approver_slack_id,tested_by,result_note,slack_ts,created_at";

const TRIAGE_STATE_WORDS = {
  queued: "approved, waiting for Claude to start (the bridge checks every 10 minutes)",
  implementing: "Claude is building it right now in GitHub Actions",
  needs_info: "Claude asked a question in the thread and is waiting for the tester's answer",
  testing: "the fix is on a preview site; the tester has to reply good, ship to test, a question, or what's wrong",
  changes_requested: "the tester sent it back; Claude is about to rebuild",
  answer_queued: "the tester asked a question; Claude is about to answer",
  answering: "Claude is answering the tester's question",
  deploy_queued: "tested and good; deploy to the live community site is starting",
  deploying: "deploying to the live community site",
  deployed: "live",
  live_test_queued: "going live so the tester can test on real data",
  live_testing: "live for a real-data test; the tester has to reply good (keep) or revert",
  revert_queued: "being taken off the live site",
  reverting: "being taken off the live site",
  failed: "a run failed or Claude refused; Amy was tagged; reply retry or a correction in the thread",
};

async function toolTriageStatus({ thread_ts, query }) {
  let filter;
  if (thread_ts) filter = `slack_ts=eq.${encodeURIComponent(thread_ts)}`;
  else if (query) filter = `source_excerpt=ilike.${encodeURIComponent(`*${query.replace(/[*,()]/g, " ").trim()}*`)}`;
  else filter = "status=in.(proposed,approved)";
  const r = await fetch(`${EW_SUPABASE_URL}/rest/v1/feedback_triage?${filter}&select=${TRIAGE_FIELDS}&order=created_at.desc&limit=15`, {
    headers: { apikey: EW_SUPABASE_ANON, Authorization: `Bearer ${EW_SUPABASE_ANON}` },
  });
  if (!r.ok) return `(triage read failed: ${r.status})`;
  const rows = await r.json();
  if (!rows.length) return "(no matching triage rows)";
  return rows.map(t => ({
    report: t.source_excerpt,
    proposal: t.recommendation,
    decision: t.status,
    decided_by: t.reviewed_by,
    approver_note: t.approver_note,
    where_it_is: t.impl_state ? `${t.impl_state}: ${TRIAGE_STATE_WORDS[t.impl_state] || ""}` :
      t.status === "approved" && /spec|feature/.test(t.recommendation) ? "approved before the build loop existed; nothing is building it. Someone can click 'Have Claude build it' in Admin Hub > Triage." :
      t.status === "done" ? "shipped" : t.status,
    tester: t.approver_slack_id ? `<@${t.approver_slack_id}>` : null,
    what_claude_built: t.impl_summary,
    attempts: t.impl_attempts,
    preview: t.preview_url,
    claude_run_or_commit: t.impl_run_url,
    branch: t.impl_branch ? `https://github.com/seung-lab/ng-extend/tree/${t.impl_branch}` : null,
    reminders_sent: t.nag_count,
    recent_thread_replies: (t.feedback_log || []).slice(-3).map(e => `[${e.role}] ${e.text}`),
    shipped_note: t.result_note,
  })).map(o => JSON.stringify(o)).join("\n");
}

async function runTool(name, input) {
  try {
    if (name === "fetch_ng_extend_file") return await toolFetchNgExtendFile(input);
    if (name === "check_cave_health") return await toolCheckCaveHealth(input || {});
    if (name === "memory") return await toolMemory(input);
    if (name === "get_triage_status") return await toolTriageStatus(input || {});
    return `(unknown tool: ${name})`;
  } catch (e) {
    console.error(`Tool ${name} threw:`, e);
    return `(tool error: ${e.message})`;
  }
}

// ─── Claude API call with tool-use loop ────────────────────────────────────

async function callClaudeWithTools(anthropicApiKey, messages) {
  let iteration = 0;
  // Triage questions can take several lookups (the row, a file or two, memory).
  const maxIterations = 10;
  const conversationMessages = [...messages];

  while (iteration < maxIterations) {
    iteration++;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        system: NG_EXTEND_SYSTEM_PROMPT,
        tools: BOT_TOOLS,
        messages: conversationMessages,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Claude API error: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();

    // If Claude is done, return the final text
    if (data.stop_reason !== "tool_use") {
      const textBlock = data.content.find(b => b.type === "text");
      return textBlock ? textBlock.text : "(no text response)";
    }

    // Claude wants to call tools — execute them and append results
    conversationMessages.push({ role: "assistant", content: data.content });
    const toolResults = [];
    for (const block of data.content) {
      if (block.type === "tool_use") {
        console.log(`[tool] ${block.name}(${JSON.stringify(block.input).slice(0, 200)})`);
        const result = await runTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
    }
    conversationMessages.push({ role: "user", content: toolResults });
  }
  return "Sorry, I looked into this but ran out of steps before I had a good answer. Try asking again more narrowly, or check the admin page: https://connectome.quest/admin/";
}

async function handleMention(event, botToken, anthropicApiKey) {
  const { channel, user, text, ts, thread_ts } = event;

  // Strip the <@BOTUSERID> prefix from the message
  const cleanText = text.replace(/<@[UW][A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  // Fetch thread context if this is in a thread
  let threadContext = "";
  if (thread_ts && thread_ts !== ts) {
    const history = await slackPost(botToken, "conversations.replies", {
      channel, ts: thread_ts, limit: 20,
    });
    if (history.ok && history.messages) {
      threadContext = "\n\nThread context (most recent first):\n" +
        history.messages.slice(-10).map(m => `${m.user || "bot"}: ${m.text}`).join("\n");
    }
  }

  // In a triage thread, give the bot that report's status up front, so
  // "where is your work?" is answered from the real row, not a guess.
  if (thread_ts && channel === "C0BG5CN71C3") {
    try {
      const t = await toolTriageStatus({ thread_ts });
      if (!t.startsWith("(")) threadContext += `\n\nThis thread is a feedback triage thread. Its row right now:\n${t}`;
    } catch (e) { console.warn("triage context failed:", e.message); }
  }

  // React with eyes while thinking (gives the user feedback)
  slackPost(botToken, "reactions.add", {
    channel, timestamp: ts, name: "eyes"
  }).catch(() => {});

  try {
    const reply = await callClaudeWithTools(anthropicApiKey, [
      { role: "user", content: `<@${user}> said: ${cleanText}${threadContext}` },
    ]);
    await slackPost(botToken, "chat.postMessage", {
      channel, thread_ts: thread_ts || ts, text: reply,
    });
  } catch (err) {
    console.error("handleMention error:", err);
    await slackPost(botToken, "chat.postMessage", {
      channel, thread_ts: thread_ts || ts,
      text: `(Error: ${err.message || "unknown"})`,
    });
  }
}

exports.slackBot = onRequest(
  { secrets: [anthropicKey, slackBotToken, slackSigningSecret], invoker: "public", cors: false },
  async (req, res) => {
    // Slack URL verification challenge (sent once when you configure Event Subscriptions)
    if (req.body && req.body.type === "url_verification") {
      res.status(200).send(req.body.challenge);
      return;
    }

    // Verify signature
    const verified = await verifySlackSignature(req, slackSigningSecret.value());
    if (!verified) {
      console.warn("Slack signature verification failed");
      res.status(401).send("invalid signature");
      return;
    }

    const event = req.body?.event;
    if (!event) { res.status(200).send("no event"); return; }

    // Dedup — Slack retries on timeout. Track event_id in Firestore. (all types)
    const eventId = req.body.event_id;
    if (eventId) {
      // create() fails if the doc already exists, and it is atomic. The old
      // get-then-set was a race: Slack retries after 3s, and a retry that
      // arrived while the first invocation was still calling Claude would read
      // "not seen", pass, and post a second identical reply. That is what
      // produced the duplicate answers in #cave_backend_community.
      const seenRef = db.collection("slack_events_seen").doc(eventId);
      try {
        await seenRef.create({ at: admin.firestore.FieldValue.serverTimestamp() });
      } catch (e) {
        console.log(`dedup: event ${eventId} already claimed, dropping retry`);
        res.status(200).send("duplicate");
        return;
      }
    }

    // Case A: a reviewer's plain-language reply inside a Guide review-card
    // thread (in #citsci_bot_feedback, or legacy #citsci_feedback) is a
    // natural-language correction. We don't hard-match the channel id — the
    // bot-feedback channel isn't hardcoded — and rely on handleReviewComment's
    // guide_review_threads lookup to ignore any thread that isn't a review card.
    if (event.type === "message" &&
        event.thread_ts && event.thread_ts !== event.ts &&
        !event.bot_id && !event.subtype) {
      res.status(200).send("ok");
      try { await handleReviewComment(event, slackBotToken.value()); }
      catch (err) { console.error("handleReviewComment error:", err); }
      return;
    }

    // Case B: @-mentions in allow-listed channels (the existing bot).
    if (!ALLOWED_CHANNEL_IDS.has(event.channel)) {
      res.status(200).send("channel not allowed");
      // Silence looked like a broken bot. Say where it does answer.
      if (event.type === "app_mention") {
        slackPost(slackBotToken.value(), "chat.postMessage", {
          channel: event.channel, thread_ts: event.thread_ts || event.ts,
          text: "I only answer in #citsci_feedback, #cave_backend_community and #ai_dev. Ask me there, or ask Amy to add this channel.",
        }).catch(() => {});
      }
      return;
    }
    if (event.type !== "app_mention") {
      res.status(200).send("not a mention");
      return;
    }

    // Ack Slack immediately (<3s), then process async
    res.status(200).send("ok");
    try {
      await handleMention(event, slackBotToken.value(), anthropicKey.value());
    } catch (err) {
      console.error("handleMention error:", err);
    }
  }
);

// A reviewer's thread reply to a Guide review card = a natural-language
// correction. Attach it to that turn's guide_logs doc, react 📝, and reply in
// the thread confirming what happened (received + how far it's integrated, or
// — if we couldn't attach it — that it may not be tracked).
async function handleReviewComment(event, botToken) {
  const snap = await db.collection("guide_review_threads").doc(event.thread_ts).get();
  if (!snap.exists) return; // not one of our review cards
  const { logId, message } = snap.data() || {};
  const text = (event.text || "").trim();
  if (!text) return;

  const note = { author: event.user || null, text: text.slice(0, 2000), ts: event.ts || null, at: Date.now() };
  let saved = false;
  if (logId) {
    try {
      await db.collection("guide_logs").doc(logId).set({
        reviewerNotes: admin.firestore.FieldValue.arrayUnion(note),
        reviewerCorrection: text.slice(0, 2000),   // latest reviewer note, convenient
        reviewerCorrectedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      saved = true;
    } catch (e) {
      console.error("[guide] reviewer note save failed:", e);
    }
  }
  await slackPost(botToken, "reactions.add", {
    channel: event.channel, timestamp: event.ts, name: saved ? "memo" : "warning",
  }).catch(() => {});

  // Confirm in-thread so the reviewer knows it landed (and isn't left wondering).
  const qref = message ? ` to “${String(message).slice(0, 120)}”` : "";
  const reply = saved
    ? `📝 Got it — correction${qref} received and logged for review. Heads up: corrections aren't auto-applied to my live answers yet, so a human folds them into my knowledge before they take effect.`
    : `⚠️ I saw your reply${qref}, but couldn't link it to the original question (no log id on this thread), so it may not be tracked. Worth flagging to the team directly.`;
  await slackPost(botToken, "chat.postMessage", {
    channel: event.channel,
    thread_ts: event.thread_ts,
    text: reply,
    unfurl_links: false,
  }).catch((e) => console.error("[guide] confirm reply failed:", e));
}

// caveProxy (a CORS proxy for CAVE annotation writes) was retired on
// 2026-09-27: nothing calls it, and it was not deployed any more.

// ──────────────────────────────────────────────────────────────────────
// signScreenshotUpload — mints a 5-minute signed PUT URL for an EyeWire II
// help-request screenshot. Frontend (ng-extend ScreenshotDialog in
// mode="attach") POSTs metadata, gets back { uploadUrl, publicUrl }, then
// PUTs the PNG blob to uploadUrl. The publicUrl is stored on the
// help_requests row in Supabase.
//
// POST body: { userId?: string|null, segId?: string|null, contentType: string, size?: number }
// Response:  { uploadUrl, publicUrl, expiresAt }
//
// Object path: eyewire-ii/help-screenshots/<yyyy-mm-dd>/<userId>-<segId>-<rand>.png
// ──────────────────────────────────────────────────────────────────────
exports.signScreenshotUpload = onRequest(
  { region: "us-central1", cors: true, invoker: "public", maxInstances: 2 },
  async (req, res) => res.status(410).json({error:"This upload endpoint has been retired."})
);

// ──────────────────────────────────────────────────────────────────────
// guideAssistant — the EyeWire II Guide. A natural-language helper that
// answers questions about the neuroglancer proofreading UI AND drives it
// by returning allow-listed, non-destructive UI actions the browser runs.
//
// Spec: ng-extend/docs/ai-assistant-spec.md (branch eyewire-ii-community).
//
// POST body: { message, history:[{role,content}], appContext:{...} }
// Response:  { reply: string, actions: [{ name, args }] }
//
// HARD SAFETY RULE: the tool list contains ONLY navigation / teaching
// actions. There is no tool that merges, splits, submits a completion, or
// writes to CAVE. setToolMode only *enters* a mode; the human clicks.
// ──────────────────────────────────────────────────────────────────────

// Allow-list of UI actions. This is the ONLY set Claude can emit. Anything
// not here is dropped server-side before it reaches the browser.
const GUIDE_TOOLS = [
  {
    name: "openPanel",
    description: "Open one of the app's side panels for the user.",
    input_schema: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          enum: ["cellLibrary", "leaderboard", "notifications", "settings",
                 "chat", "recap", "batch", "datasetSelector"],
        },
      },
      required: ["panel"],
    },
  },
  {
    name: "closePanel",
    description: "Close one of the app's side panels.",
    input_schema: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          enum: ["cellLibrary", "leaderboard", "notifications", "settings",
                 "chat", "recap", "batch", "datasetSelector"],
        },
      },
      required: ["panel"],
    },
  },
  {
    name: "setToolMode",
    description: "Enter a proofreading tool mode so the user can then act. " +
      "This ONLY switches the active tool; it never performs a merge, split, " +
      "or any edit. The human always makes the actual edit. 'none' clears the tool.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["merge", "split", "findPath", "none"] },
      },
      required: ["mode"],
    },
  },
  {
    name: "goToSegment",
    description: "Add a segment (root id) to the visible set and recenter the " +
      "view on it. Read-only navigation.",
    input_schema: {
      type: "object",
      properties: { segId: { type: "string", description: "Numeric root segment id" } },
      required: ["segId"],
    },
  },
  {
    name: "openCommandPalette",
    description: "Open the Ctrl+K command palette, optionally pre-filling a search query.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: [],
    },
  },
  {
    name: "spotlight",
    description: "Ring a specific on-screen control with a pulsing glow (and an " +
      "optional short note) so the user can SEE exactly where it is. Use this for " +
      "\"where is the X button / how do I find X\" questions — pointing beats " +
      "describing. Read-only; it only highlights, it never clicks.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Which control to highlight.",
          enum: [
            "pyrLogo", "shareButton", "datasetButton", "askButton", "commandPalette",
            "profileButton", "splitTool", "mergeTool", "findPathTool", "leaderboard",
            "cellLibrary", "batchProcessor", "secondOpinion", "activityFeed",
            "notifications", "chat", "settings", "weeklyRecap", "brainQuest",
          ],
        },
        note: { type: "string", description: "Optional short label shown beside the control (<= 120 chars)." },
      },
      required: ["target"],
    },
  },
  {
    name: "startTutorial",
    description: "Launch a guided walkthrough: 1-3 are the proofreading tutorials, " +
      "4 is the general Site Tour of the interface. Use when the user asks for a " +
      "tour, a walkthrough, or 'show me around'.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", enum: [1, 2, 3, 4], description: "1-3 tutorials, 4 = Site Tour." },
        step: { type: "integer", description: "Optional starting step (default 0)." },
      },
      required: ["id"],
    },
  },
  {
    name: "explainOnly",
    description: "Use when a plain text answer is enough and no UI action is needed. " +
      "Always prefer this over guessing an action.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];
const GUIDE_TOOL_NAMES = new Set(GUIDE_TOOLS.map(t => t.name));

// Knowledge base — kept small enough to inline and prompt-cache. The Nurro
// voice: warm, encouraging, concise, celebrates progress.
const GUIDE_SYSTEM_PROMPT = `You are the EyeWire II Guide (voice: "Nurro"), an in-app assistant for the EyeWire II neuroglancer proofreading tool. Proofreaders trace neurons in a shared connectome. You help newcomers who are lost in neuroglancer's 3-panel WebGL interface.

HOW YOU HELP
- Answer in plain language, briefly (1-3 sentences). Warm, encouraging, never condescending. Celebrate progress.
- Distinguish intent to ACT from a request to UNDERSTAND:
  - ACT ("take me to X", "open X", "switch to merge", "let me split this", "go to segment 123", "start the tutorial"): call the matching tool so the app takes them there, then add one short sentence of context. Showing beats telling.
  - UNDERSTAND ("how do I X", "what is X", "why is X", "what does this do", "when should I Y"): call explainOnly and answer in text. Do NOT enter a tool mode or open a panel just because the user asked how something works — that is jarring when they are only reading. Offer to take them there ("want me to switch you into split mode?") instead of doing it.
- If a request is ambiguous or outside what your tools cover, answer in text with explainOnly. Never guess a destructive intent.

ABSOLUTE SAFETY RULES (never break these)
- You NEVER merge, split, submit a completion, request help, or write any annotation on the user's behalf. Those are the human's job.
- setToolMode only ENTERS a tool mode so the user can act; it does not perform the edit. Say so ("I've switched you into split mode, now click the two points...").
- You have no tool that writes to CAVE or the server. If asked to do such a thing, explain that you can set up the mode and walk them through it, but they make the edit.

THE UI (what your tools map to)
- Panels (openPanel/closePanel): cellLibrary (browse/pick cells + Help tab), leaderboard (rankings), notifications, settings, chat (community chat), recap (weekly recap), batch (batch processor), datasetSelector (switch dataset).
- Tools (setToolMode): merge (keybind M) = join two segments that are one neuron; split/multicut (keybind C) = cut apart segments wrongly joined; findPath (keybind F) = trace the path between two points. 'none' clears.
- Command palette (openCommandPalette): Ctrl+K, the searchable list of everything the app can do. If unsure which panel/action fits, open it with a query.
- goToSegment: jump the camera to a segment by its root id and make it visible.
- spotlight: for "where is X / how do I find the X button" questions, glow the actual control so the user can SEE it — pointing beats describing. Known targets: pyrLogo, shareButton, datasetButton, askButton, commandPalette, profileButton, splitTool, mergeTool, findPathTool, leaderboard, cellLibrary, batchProcessor, secondOpinion (request a second opinion), activityFeed, notifications, chat, settings, weeklyRecap, brainQuest. Prefer spotlight over openPanel when the user asks WHERE something is (show them the button); use openPanel when they just want to GET there. You can add a short note. If a control isn't in the target list, explain in words instead.
- startTutorial: launch a walkthrough when asked for a tour or "show me around" — 1-3 are proofreading tutorials, 4 is the general Site Tour.

PROOFREADING HOW-TOs
- Merge vs split: if a neuron is broken into pieces, MERGE them. If two different neurons are stuck together, SPLIT (multicut) them. When unsure, look before you edit.
- Find path: use findPath to check whether two points are actually connected through the segmentation.
- Marking a cell complete / requesting a second opinion are human actions in the Cell Library; you can open the panel and explain, but the user clicks.

TROUBLESHOOTING FAQ
- "My edits aren't showing" / "why don't I see my changes": their proofreading IS saved — reassure them first. The 3D meshes update live, but materialized queries (cell tables and some views) use the latest materialized snapshot, which lags live edits. If appContext.materialization is present, be SPECIFIC: the newest materialized version is {latestVersion}, timestamped {timestamp} (~{ageMinutes} minutes old); any edit made after that appears at the next materialization run, not immediately. If it's not present, give the general explanation.
- "Why is my segment gray": the mesh may still be loading, or it isn't in the visible set. Offer goToSegment.
- Login / CAVE auth issues: they must be logged in for edits to save; point them to settings or the login flow.

CONTEXT
- The current app state is provided as APP CONTEXT below. Ground answers in it (dataset, whether logged in, which panels are open, current tool).

LANGUAGE
- appContext.lang holds the user's browser locale (e.g. 'en-US', 'es', 'fr', 'de', 'ja', 'zh-CN', 'ko', 'pt-BR'). Write your reply in THAT language. For any 'en...' locale, reply in English.
- If the user clearly writes in a different language than lang, follow the language they actually wrote in.
- Keep proper nouns as-is (EyeWire II, CAVE, neuroglancer, segment ids). Translate everything else naturally; don't sound machine-translated.`;

async function callGuideClaude(anthropicApiKey, messages, systemBlocks) {
  const collectedActions = [];
  let finalText = "";
  let iteration = 0;
  const maxIterations = 4;
  const convo = [...messages];

  while (iteration < maxIterations) {
    iteration++;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        // systemBlocks: [ cached KB + live UI reference, uncached per-request appContext ].
        system: systemBlocks,
        tools: GUIDE_TOOLS,
        messages: convo,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Claude API error: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();

    // Capture any text the model produced this turn.
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (textBlock && textBlock.text) finalText = textBlock.text;

    if (data.stop_reason !== "tool_use") break;

    // Record tool calls into actions (validated) and feed back synthetic
    // results so the model can produce its closing sentence. The real
    // execution happens in the browser.
    convo.push({ role: "assistant", content: data.content });
    const toolResults = [];
    for (const block of data.content) {
      if (block.type !== "tool_use") continue;
      if (GUIDE_TOOL_NAMES.has(block.name) && block.name !== "explainOnly") {
        collectedActions.push({ name: block.name, args: block.input || {} });
      }
      console.log(`[guide] tool ${block.name}(${JSON.stringify(block.input || {}).slice(0, 120)})`);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: "Queued. It will run in the user's browser.",
      });
    }
    convo.push({ role: "user", content: toolResults });
  }

  return { reply: finalText || "Done.", actions: collectedActions };
}

// ── Streaming variant ──────────────────────────────────────────────────
// Same tool-use loop as callGuideClaude, but streams the model's text deltas
// out via onText(delta) as they arrive, so the dock renders token-by-token.

// One streamed API turn. Parses Anthropic's SSE, forwards text deltas to
// onText, and reconstructs the full content blocks (needed to continue a
// tool-use loop). Returns { stopReason, content, text }.
async function streamGuideOnce(anthropicApiKey, systemBlocks, convo, onText) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemBlocks,
      tools: GUIDE_TOOLS,
      messages: convo,
      stream: true,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Claude API error: ${err || resp.statusText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const blocks = [];       // reconstructed content blocks, by index
  const jsonAccum = {};    // index -> partial tool-input JSON string
  let text = "";
  let stopReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let evt;
      try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }

      if (evt.type === "content_block_start") {
        blocks[evt.index] = { ...evt.content_block };
        if (evt.content_block.type === "tool_use") jsonAccum[evt.index] = "";
      } else if (evt.type === "content_block_delta") {
        if (evt.delta.type === "text_delta") {
          text += evt.delta.text;
          if (blocks[evt.index]) blocks[evt.index].text = (blocks[evt.index].text || "") + evt.delta.text;
          try { onText(evt.delta.text); } catch { /* client gone */ }
        } else if (evt.delta.type === "input_json_delta") {
          jsonAccum[evt.index] = (jsonAccum[evt.index] || "") + evt.delta.partial_json;
        }
      } else if (evt.type === "content_block_stop") {
        const b = blocks[evt.index];
        if (b && b.type === "tool_use") {
          try { b.input = JSON.parse(jsonAccum[evt.index] || "{}"); } catch { b.input = {}; }
        }
      } else if (evt.type === "message_delta") {
        if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
      }
    }
  }
  return { stopReason, content: blocks.filter(Boolean), text };
}

async function callGuideClaudeStream(anthropicApiKey, systemBlocks, messages, onText) {
  const collectedActions = [];
  let finalText = "";
  let iteration = 0;
  const convo = [...messages];

  while (iteration < 4) {
    iteration++;
    const { stopReason, content, text } = await streamGuideOnce(anthropicApiKey, systemBlocks, convo, onText);
    if (text) finalText = text; // final turn's text is the answer

    if (stopReason !== "tool_use") break;

    convo.push({ role: "assistant", content });
    const toolResults = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      if (GUIDE_TOOL_NAMES.has(block.name) && block.name !== "explainOnly") {
        collectedActions.push({ name: block.name, args: block.input || {} });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: "Queued. It will run in the user's browser.",
      });
    }
    convo.push({ role: "user", content: toolResults });
  }

  return { reply: finalText || "Done.", actions: collectedActions };
}

// Log every turn to Firestore so we can see what proofreaders ask and, crucially,
// which questions produced NO action (hadAction=false) — those are the unmet needs
// that tell us what new tools/actions to build. Fire-and-forget: never blocks or
// fails the response. Query in the Firebase console, e.g. collection `guide_logs`
// filtered by hadAction == false, or grouped by actionNames.
async function writeGuideLog(entry, ref) {
  try {
    const r = ref || db.collection("guide_logs").doc();
    // Firestore rejects `undefined`; every field is coalesced to a concrete value.
    await r.set({ at: admin.firestore.FieldValue.serverTimestamp(), ...entry });
  } catch (e) {
    console.error("[guide] log write failed:", e);
  }
}

// ── Rate limiting ──────────────────────────────────────────────────────
// Protects the public endpoint and the Anthropic key. Hard per-IP caps ALWAYS
// apply; logged-in users (a soft signal from appContext) get a more generous
// tier, but even that tier is safe. One Firestore doc per IP holds a rolling
// 1-minute and 1-day window, so docs don't accumulate.
const RL_TIERS = {
  anon:   { perMin: 8,  perDay: 60 },
  authed: { perMin: 20, perDay: 400 },
};

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Atomically check+increment the per-IP windows. Returns {ok} or {ok:false,scope}.
async function rateLimit(req, loggedIn, prefix = "a") {
  // Browser login flags do not establish identity. Keep the anonymous tier.
  const tier = prefix.startsWith("write:") ? {perMin:60,perDay:5000} : RL_TIERS.anon;
  const id = crypto.createHash("sha256").update(clientIp(req)).digest("hex");
  const refs = [db.collection("guide_ratelimit").doc(prefix+":"+id), db.collection("guide_ratelimit").doc(prefix+":global")];
  try {
    return await db.runTransaction(async tx => {
      const snapshots = await Promise.all(refs.map(ref=>tx.get(ref)));
      const now=Date.now(), next=[];
      for(let i=0;i<refs.length;i++) {
        const d=snapshots[i].exists?snapshots[i].data():{};
        const limits=i ? (prefix.startsWith("write:") ? {perMin:300,perDay:20000} : {perMin:60,perDay:1500}) : tier;
        const minute=now-(d.minStart||0)>=60000, day=now-(d.dayStart||0)>=86400000;
        const minCount=minute?0:(d.minCount||0), dayCount=day?0:(d.dayCount||0);
        if(minCount>=limits.perMin || dayCount>=limits.perDay) return {ok:false,scope:dayCount>=limits.perDay?"day":"minute"};
        next.push({minStart:minute?now:d.minStart,minCount:minCount+1,dayStart:day?now:d.dayStart,dayCount:dayCount+1});
      }
      refs.forEach((ref,i)=>tx.set(ref,next[i]));
      return {ok:true};
    });
  } catch(e) {
    console.error("[rateLimit] unavailable");
    return {ok:false,scope:"unavailable"};
  }
}

// Reflect only trusted origins: the App Engine deploys, GitHub Pages, and localhost dev.
const GUIDE_ALLOWED_ORIGIN_RE =
  /^https:\/\/[a-z0-9-]+-dot-brain-wire-dot-seung-lab\.ue\.r\.appspot\.com$|^https:\/\/amyleesterling\.github\.io$|^http:\/\/(localhost|127\.0\.0\.1):(8080|3000)$/;

exports.guideAssistant = onRequest(
  { region: "us-central1", secrets: [anthropicKey, ewServiceKey], cors: false, invoker: "public", maxInstances: 20 },
  async (req, res) => {
    const origin = req.get("origin") || "";
    const originOk = GUIDE_ALLOWED_ORIGIN_RE.test(origin);
    if (originOk) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    if (!originOk) { res.status(403).json({ error: "origin not allowed" }); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let pilot;
    try {
      pilot=await pilotContext(ewSb(ewServiceKey.value().trim()),await ewVerify(req.body?.token));
      requirePilot(pilot);
    } catch(error) { return res.status(error.status||503).json({error:error.status?error.message:"Please try again shortly.",reply:error.status?error.message:"The Guide is temporarily unavailable."}); }


    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 48000) return res.status(413).json({error:"Input too large"});
    const { message, history, appContext, uiReference } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "missing message" });
      return;
    }

    const rl = await rateLimit(req, !!(appContext && appContext.loggedIn), "ask");
    if (!rl.ok) {
      res.status(429).json({
        error: "rate_limited",
        reply: rl.scope === "day"
          ? "You've reached today's limit for the Guide — please come back tomorrow. 💙"
          : "You're sending messages a little fast. Give me a few seconds and try again.",
      });
      return;
    }

    try {
      // Cached block: stable voice/safety/how-tos + the live UI reference the
      // client generated from the running app (buttons, keybindings, commands).
      // It is authoritative for exact facts, so the hand-written UI prose can
      // never silently drift out of date.
      const cachedText = GUIDE_SYSTEM_PROMPT +
        (uiReference && typeof uiReference === "string"
          ? "\n\nLIVE UI REFERENCE (generated from the running app — trust this over the prose above for exact button names, keyboard shortcuts, and available commands):\n" +
            uiReference.slice(0, 8000)
          : "");
      const systemBlocks = [
        { type: "text", text: cachedText, cache_control: { type: "ephemeral" } },
        { type: "text", text: "APP CONTEXT (current state):\n" + JSON.stringify(appContext || {}, null, 0) },
      ];

      const messages = [];
      if (Array.isArray(history)) {
        for (const m of history.slice(-8)) {
          if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
            messages.push({ role: m.role, content: m.content });
          }
        }
      }
      if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
        messages.push({ role: "user", content: message });
      }

      // ── Streaming path (NDJSON): the dock renders text as it arrives ──
      if (req.body && req.body.stream) {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof res.flushHeaders === "function") res.flushHeaders();
        const send = (obj) => { try { res.write(JSON.stringify(obj) + "\n"); } catch { /* client gone */ } };

        const logRef = db.collection("guide_logs").doc();
        try {
          const result = await callGuideClaudeStream(
            anthropicKey.value(), systemBlocks, messages,
            (delta) => send({ type: "text", delta }),
          );
          send({ type: "done", reply: result.reply, actions: result.actions, logId: logRef.id });
          res.end();

          const ctx = appContext || {};
          const actionNames = (result.actions || []).map((a) => a && a.name).filter(Boolean);
          await writeGuideLog({
            message,
            reply: result.reply || null,
            actions: result.actions || [],
            actionNames,
            hadAction: actionNames.length > 0,
            dataset: ctx.dataset || null,
            loggedIn: ctx.loggedIn ?? null,
            userName: ctx.userName || null,
            toolMode: ctx.toolMode || null,
            openPanels: Array.isArray(ctx.openPanels) ? ctx.openPanels : [],
            lang: ctx.lang || null,
            turnCount: Array.isArray(history) ? history.length + 1 : 1,
            feedback: null,
            correction: null,
            error: null,
            streamed: true,
          }, logRef);
        } catch (err) {
          console.error("guideAssistant stream error:", err);
          send({ type: "error", reply: "The guide had trouble just now. Please try again." });
          res.end();
          await writeGuideLog({
            message, reply: null, actions: [], actionNames: [], hadAction: false,
            error: String((err && err.message) || err), streamed: true,
          });
        }
        return;
      }

      const result = await callGuideClaude(anthropicKey.value(), messages, systemBlocks);

      // Pre-create the log doc ref so we can hand its id to the client; feedback
      // (thumbs / corrections) later merges into this same doc.
      const logRef = db.collection("guide_logs").doc();

      // Respond first (with the log id), then write the log — no user-facing
      // latency, but the write still completes before the instance freezes.
      res.json({ ...result, logId: logRef.id });

      const ctx = appContext || {};
      const actions = Array.isArray(result.actions) ? result.actions : [];
      const actionNames = actions.map((a) => a && a.name).filter(Boolean);
      await writeGuideLog({
        message,
        reply: result.reply || null,
        actions,
        actionNames,             // e.g. ["openPanel"] — easy to group/filter
        hadAction: actionNames.length > 0,  // false == the bot had no tool for it
        dataset: ctx.dataset || null,
        loggedIn: ctx.loggedIn ?? null,
        userName: ctx.userName || null,
        toolMode: ctx.toolMode || null,
        openPanels: Array.isArray(ctx.openPanels) ? ctx.openPanels : [],
        lang: ctx.lang || null,
        turnCount: Array.isArray(history) ? history.length + 1 : 1,
        feedback: null,          // set later by guideFeedback: 'up' | 'down'
        correction: null,        // user-supplied correct answer, when given
        error: null,
      }, logRef);
    } catch (err) {
      console.error("guideAssistant error:", err);
      res.status(500).json({ error: "assistant temporarily unavailable" });
      // Log failed turns too — a question that errors is also a signal.
      await writeGuideLog({
        message,
        reply: null,
        actions: [],
        actionNames: [],
        hadAction: false,
        error: String((err && err.message) || err),
      });
    }
  },
);

// ──────────────────────────────────────────────────────────────────────
// guideFeedback — records a 👍/👎 (and optional correction) for a Guide turn.
// Merges into the guide_logs doc identified by logId, so a downvote and the
// user's correct answer sit right next to the question that produced them —
// that's the eval/correction dataset. Falls back to a standalone doc if the
// client has no logId.
//
// POST body: { logId?: string, verdict: 'up'|'down', correction?: string, reply?: string }
//
// On a downvote it also posts a review card to Slack #citsci_feedback, tagging
// the reviewers, so corrections get eyes (and eventually a ✅ signoff).
// ──────────────────────────────────────────────────────────────────────

// ── Slack correction-review routing ────────────────────────────────────
// If REVIEW_CHANNEL_ID is set (the C… id from the channel's About / URL), it's
// used directly — no channels:read scope or lookup needed, just chat:write and
// the bot being a member. Otherwise we fall back to looking it up by name.
// #citsci_feedback — GENERAL site feedback / issues (submitIssue).
const REVIEW_CHANNEL_ID = "C0BG5CN71C3";
const REVIEW_CHANNEL_NAME = "citsci_feedback";
// #citsci_bot_feedback — AI Guide answer feedback (guideFeedback). No hardcoded
// id yet; resolved by name. Set BOT_FEEDBACK_CHANNEL_ID to the C… id (from the
// channel's About/URL) if name resolution fails (missing channels:read).
const BOT_FEEDBACK_CHANNEL_ID = "C0BGTNRRA75";
const BOT_FEEDBACK_CHANNEL_NAME = "citsci_bot_feedback";
// Hardcoded member IDs (amy, celia, marissa/sorek.m) so @-mentions resolve to
// live pings without the users:read scope. Falls back to name lookup if empty.
const REVIEW_MENTION_IDS = ["U02FH1DRC", "U033NHWDE", "U033TSX9A"];
const REVIEW_MENTION_HANDLES = ["amy", "celia", "sorek.m"];
const _channelIdCache = {};
let _reviewMentionIds = null;

async function resolveChannelByName(token, hardId, name) {
  if (hardId) return hardId;
  if (_channelIdCache[name]) return _channelIdCache[name];
  let cursor;
  for (let i = 0; i < 12; i++) {
    // public_channel only — avoids the groups:read scope requirement.
    const r = await slackPost(token, "conversations.list", {
      types: "public_channel", exclude_archived: true, limit: 1000, cursor,
    });
    if (!r.ok) { console.error("[feedback] conversations.list:", r.error); break; }
    const match = (r.channels || []).find((c) => c.name === name);
    if (match) { _channelIdCache[name] = match.id; return match.id; }
    cursor = r.response_metadata && r.response_metadata.next_cursor;
    if (!cursor) break;
  }
  return null;
}

async function resolveReviewChannel(token) {
  return resolveChannelByName(token, REVIEW_CHANNEL_ID, REVIEW_CHANNEL_NAME);
}
async function resolveBotFeedbackChannel(token) {
  return resolveChannelByName(token, BOT_FEEDBACK_CHANNEL_ID, BOT_FEEDBACK_CHANNEL_NAME);
}

async function resolveReviewMentionIds(token) {
  if (REVIEW_MENTION_IDS.length) return REVIEW_MENTION_IDS;
  if (_reviewMentionIds) return _reviewMentionIds;
  const want = REVIEW_MENTION_HANDLES.map((h) => h.toLowerCase());
  const found = {};
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await slackPost(token, "users.list", { limit: 200, cursor });
    if (!r.ok) { console.error("[guide] users.list:", r.error); break; }
    for (const m of r.members || []) {
      const name = (m.name || "").toLowerCase();
      const disp = ((m.profile && m.profile.display_name) || "").toLowerCase();
      const real = ((m.profile && m.profile.real_name) || "").toLowerCase();
      for (const h of want) {
        if (!found[h] && (name === h || disp === h || real === h)) found[h] = m.id;
      }
    }
    cursor = r.response_metadata && r.response_metadata.next_cursor;
    if (!cursor || Object.keys(found).length === want.length) break;
  }
  _reviewMentionIds = want.map((h) => found[h]).filter(Boolean);
  return _reviewMentionIds;
}

async function postCorrectionReview(token, entry) {
  try {
    const channel = await resolveBotFeedbackChannel(token);
    if (!channel) { console.error("[guide] bot-feedback channel not found"); return; }
    const mentionIds = await resolveReviewMentionIds(token);
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");

    const nonEnglish = entry.lang && !/^en/i.test(entry.lang);
    const lines = [
      `:robot_face: *AI Guide answer flagged as wrong* (dataset: ${entry.dataset || "?"}${nonEnglish ? `, lang: ${entry.lang}` : ""})`,
      `*From:* ${entry.user || "anonymous"}`,
      `*Q:* ${entry.message || "(question not logged)"}`,
      `*Bot said:* ${(entry.reply || "(no reply logged)").slice(0, 700)}`,
      entry.correction ? `*User's correction:* ${entry.correction}` : "_(no correction text supplied)_",
      `${mentions ? mentions + " " : ""}Reply in this thread with the right answer, or react :white_check_mark: if the bot was actually correct.`,
    ].filter(Boolean);
    const text = lines.join("\n");

    let res = await slackPost(token, "chat.postMessage", { channel, text, unfurl_links: false });
    // Public channel the bot hasn't joined yet → join and retry once.
    if (!res.ok && res.error === "not_in_channel") {
      await slackPost(token, "conversations.join", { channel });
      res = await slackPost(token, "chat.postMessage", { channel, text, unfurl_links: false });
    }
    if (!res.ok) { console.error("[guide] slack post failed:", res.error); return; }

    // Map the card's thread ts → this turn, so a reviewer's thread reply becomes
    // a natural-language correction on the right guide_logs doc.
    if (res.ts) {
      try {
        await db.collection("guide_review_threads").doc(res.ts).set({
          logId: entry.logId || null,
          message: entry.message || null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { console.error("[guide] thread map write:", e); }
    }
  } catch (e) {
    console.error("[guide] postCorrectionReview error:", e);
  }
}

// ─── submitIssue — a user-reported site issue / feedback → Slack ──────────────
// General "Submit issue" button anywhere in the app posts here. Reuses the same
// Slack review channel + reviewer mentions as the Guide feedback loop
// (#citsci_feedback) and keeps a durable Firestore record in `site_issues`.
const ISSUE_CATEGORIES = ["Bug", "Idea", "Data problem", "Other"];
const ISSUE_EMOJI = {
  "Bug": ":beetle:", "Idea": ":bulb:", "Data problem": ":warning:", "Other": ":speech_balloon:",
};

async function postIssueToSlack(token, issue) {
  try {
    const channel = await resolveReviewChannel(token);
    if (!channel) { console.error("[issue] review channel not found"); return; }
    const mentionIds = await resolveReviewMentionIds(token);
    const mentions = mentionIds.map((id) => `<@${id}>`).join(" ");
    const emoji = ISSUE_EMOJI[issue.category] || ISSUE_EMOJI.Other;
    const lines = [
      `${emoji} *New site issue submitted* — _${issue.category}_`,
      `*From:* ${issue.user || "anonymous"}${issue.dataset ? ` · dataset: ${issue.dataset}` : ""}`,
      `*Report:* ${issue.message}`,
      issue.url ? `*Page:* ${issue.url}` : null,
      mentions || null,
    ].filter(Boolean);
    const text = lines.join("\n");
    let r = await slackPost(token, "chat.postMessage", { channel, text, unfurl_links: false });
    if (!r.ok && r.error === "not_in_channel") {
      await slackPost(token, "conversations.join", { channel });
      r = await slackPost(token, "chat.postMessage", { channel, text, unfurl_links: false });
    }
    if (!r.ok) console.error("[issue] slack post failed:", r.error);
  } catch (e) {
    console.error("[issue] postIssueToSlack error:", e);
  }
}

exports.submitIssue = onRequest(
  { region: "us-central1", cors: false, invoker: "public", maxInstances: 10, secrets: [slackBotToken, ewServiceKey] },
  async (req, res) => {
    const origin = req.get("origin") || "";
    const originOk = GUIDE_ALLOWED_ORIGIN_RE.test(origin);
    if (originOk) { res.set("Access-Control-Allow-Origin", origin); res.set("Vary", "Origin"); }

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    if (!originOk) { res.status(403).json({ error: "origin not allowed" }); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let pilot;
    try {
      pilot=await pilotContext(ewSb(ewServiceKey.value().trim()),await ewVerify(req.body?.token));
      requirePilot(pilot);
    } catch(error) { return res.status(error.status||503).json({error:error.status?error.message:"Please try again shortly.",reply:error.status?error.message:"The Guide is temporarily unavailable."}); }


    const b = req.body || {};
    const message = typeof b.message === "string" ? b.message.trim().slice(0, 4000) : "";
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    const category = ISSUE_CATEGORIES.includes(b.category) ? b.category : "Other";
    const user = pilot.me.username || pilot.me.display_name || "Player";
    const dataset = typeof b.dataset === "string" ? b.dataset.slice(0, 120) : "";
    const pageUrl = typeof b.url === "string" ? b.url.slice(0, 500) : "";

    const rl = await rateLimit(req, !!user, "issue");
    if (!rl.ok) { res.status(429).json({ error: "rate_limited" }); return; }

    try {
      await db.collection("site_issues").add({
        message, category,
        user: user || null, dataset: dataset || null, url: pageUrl || null,
        origin, at: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ ok: true });
      // Fire-and-forget Slack post (response already sent).
      postIssueToSlack(slackBotToken.value(), { message, category, user, dataset, url: pageUrl });
    } catch (err) {
      console.error("submitIssue error:", err);
      if (!res.headersSent) res.status(500).json({ error: "could not record issue" });
    }
  },
);

exports.guideFeedback = onRequest(
  { region: "us-central1", cors: false, invoker: "public", maxInstances: 10, secrets: [slackBotToken, ewServiceKey] },
  async (req, res) => {
    const origin = req.get("origin") || "";
    const originOk = GUIDE_ALLOWED_ORIGIN_RE.test(origin);
    if (originOk) { res.set("Access-Control-Allow-Origin", origin); res.set("Vary", "Origin"); }

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    if (!originOk) { res.status(403).json({ error: "origin not allowed" }); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let pilot;
    try {
      pilot=await pilotContext(ewSb(ewServiceKey.value().trim()),await ewVerify(req.body?.token));
      requirePilot(pilot);
    } catch(error) { return res.status(error.status||503).json({error:error.status?error.message:"Please try again shortly.",reply:error.status?error.message:"The Guide is temporarily unavailable."}); }


    const { logId, verdict, correction, reply, user } = req.body || {};
    if (verdict !== "up" && verdict !== "down") {
      res.status(400).json({ error: "verdict must be 'up' or 'down'" });
      return;
    }
    const userName = pilot.me.username || pilot.me.display_name || "Player";

    // Light per-IP cap — feedback is cheap, but stop spam.
    const fbRl = await rateLimit(req, true, "fb");
    if (!fbRl.ok) { res.status(429).json({ error: "rate_limited" }); return; }
    const corr = typeof correction === "string" ? correction.trim().slice(0, 2000) : "";

    try {
      const payload = {
        feedback: verdict,
        correction: corr || null,
        feedbackAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      let logData = {};
      if (logId && typeof logId === "string") {
        const ref = db.collection("guide_logs").doc(logId);
        // Read the turn's context (question/dataset/lang) before merging feedback.
        const snap = await ref.get();
        if (snap.exists) logData = snap.data() || {};
        await ref.set(payload, { merge: true });
      } else {
        // No log id (older turn / race) — keep a self-contained record.
        await db.collection("guide_feedback").add({
          ...payload,
          reply: typeof reply === "string" ? reply.slice(0, 4000) : null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      res.json({ ok: true });

      // A downvote → route to Slack #citsci_bot_feedback for reviewer signoff.
      if (verdict === "down") {
        await postCorrectionReview(slackBotToken.value(), {
          logId: (logId && typeof logId === "string") ? logId : null,
          message: logData.message || null,
          reply: (typeof reply === "string" ? reply : null) || logData.reply || null,
          correction: corr || null,
          dataset: logData.dataset || null,
          lang: logData.lang || null,
          user: userName || logData.user || null,
        });
      }
    } catch (err) {
      console.error("guideFeedback error:", err);
      if (!res.headersSent) res.status(500).json({ error: "could not record feedback" });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════
// ewSecureWrite: the only way the EyeWire II app may write notifications,
// feedback_triage rows, or claim chat announcements.
//
// The app talks to Supabase with the PUBLIC anon key and has no database
// sign in, so the database cannot tell users apart. After the 2026-09-26
// lockdown (ng-extend supabase-lockdown-notifications-triage.sql) the anon
// key can only READ notifications, feedback_triage and admins. Writes come
// here instead, with the caller's CAVE sign in token, which is verified with
// CAVE itself (/auth/api/v1/user/me). Admin actions also require the verified
// email to be in the admins table, read with the service key, which the
// browser never sees. Automation (GitHub Actions) keeps using its own
// service key and does not come through here.
// ════════════════════════════════════════════════════════════════════════
const { authorizeData } = require("./community-data");
const EW_SB = "https://javthknksdcrlhiaaptj.supabase.co/rest/v1/";
const EW_ORIGINS = [/^https:\/\/([a-z0-9-]+-dot-)?brain-wire-dot-seung-lab\.ue\.r\.appspot\.com$/, /^http:\/\/localhost(:\d+)?$/];
const ewIdentityCache = new Map(); // token -> { email, caveId, at }

async function ewVerify(token) {
  if (!token || typeof token !== "string" || token.length > 4096) return null;
  const hit = ewIdentityCache.get(token);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit;
  for (const url of ["https://global.daf-apis.com/auth/api/v1/user/me", "https://minnie.microns-daf.com/auth/api/v1/user/me"]) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const me = await r.json();
      if (me && me.email) {
        const v = { email: String(me.email).toLowerCase(), caveId: me.id, at: Date.now() };
        ewIdentityCache.set(token, v);
        if (ewIdentityCache.size > 500) ewIdentityCache.delete(ewIdentityCache.keys().next().value);
        return v;
      }
    } catch (e) { /* try the next */ }
  }
  return null;
}

function ewSb(key) {
  return async (path, init = {}) => {
    const r = await fetch(EW_SB + path, {
      ...init,
      redirect: "error", signal: AbortSignal.timeout(15000),
      // New style secret keys (sb_secret_...) go in the apikey header only;
      // the legacy service_role JWT also needs the Bearer header.
      headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
    });
    const text = await r.text();
    if (!r.ok) {
      let error;try{error=JSON.parse(text);}catch{}
      if(path.startsWith("rpc/pilot_") && ["P0001","42501","55P03"].includes(error?.code)) throw ewErr(error.code==="42501"?403:409,String(error.message).slice(0,300));
      throw new Error(`supabase ${r.status}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

const EW_NOTIF_FIELDS = ["title", "body", "image_url", "thumbnail_url", "target_type", "target_id", "send_at", "expires_at", "post_to_chat", "chat_posted_at"];
const EW_TRIAGE_FIELDS = ["status", "proposed_message", "approver_note", "impl_state", "reviewed_by", "reviewed_at", "result_note", "tested_by", "tested_at", "feedback_log", "approver_slack_id"];
const ewPick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keys.includes(k)));
const EW_SELF_TITLES = ["📊 Your Week in Science", "💙 Thank you, for science!", "Your practice cell is ready"];
const ewErr = (status, msg) => Object.assign(new Error(msg), { status });

exports.ewSecureWrite = onRequest(
  { region: "us-central1", secrets: [ewServiceKey], cors: EW_ORIGINS, invoker: "public", maxInstances: 20 },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 64000) return res.status(413).json({error:"Input too large"});
    const { action, token, ...args } = req.body || {};
    // Health: proves the service key reaches the database. Returns no data.
    if (action === "health") {
      // Also say WHICH kind of key is configured (never any part of it), so a
      // public key stored by mistake is caught before the lockdown relies on it.
      const k = ewServiceKey.value().trim();
      let kind = "other";
      if (k.startsWith("sb_secret_")) kind = "sb_secret";
      else if (k.startsWith("sb_publishable_")) kind = "sb_publishable";
      else if (k.split(".").length === 3) {
        try { kind = "legacy_" + JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role; } catch (e) { kind = "unreadable_jwt"; }
      }
      try { await ewSb(k)("admins?select=id&limit=1"); res.json({ ok: true, db: true, kind }); }
      catch (e) { res.status(500).json({ ok: false, db: false, kind }); }
      return;
    }
    const who = await ewVerify(token);
    if (!who) { res.status(401).json({ error: "Sign in to EyeWire II again, then retry." }); return; }
    if (!(await rateLimit({ip:who.email}, true, "write:secure")).ok) return res.status(429).json({error:"Please wait before sending another change."});
    const sb = ewSb(ewServiceKey.value().trim()); // a pasted key can carry a stray newline
    try {
      const ctx = await pilotContext(sb,who);
      const {me,isAdmin} = ctx;
      if(action === "pilot.status") return res.json({ok:true,data:{invited:!!(isAdmin||ctx.isPilot),admin:isAdmin}});
      requirePilot(ctx);
      const needAdmin = () => { if (!isAdmin) throw ewErr(403, "Admins only"); };
      let out = null;
      switch (action) {
        case "pilot.task":
        case "pilot.practice": {
          const allowed = action === "pilot.task" ? ["claim","claim_cell","release","complete","heartbeat"] : ["claim","heartbeat","begin_reset","check_reset","finish_reset"];
          if(!allowed.includes(args.operation)) throw ewErr(400,"Unknown pilot action");
          const payload={p_user:me.id,p_action:args.operation,p_args:args.args||{}};
          out=await sb("rpc/"+(action === "pilot.task"?"pilot_task_action":"pilot_practice_action"),{method:"POST",body:JSON.stringify(payload)});
          break;
        }
        // ── admins ──
        case "notification.insert": {
          needAdmin();
          const row = { ...ewPick(args.row, EW_NOTIF_FIELDS), created_by: (me && me.id) || null };
          if (!row.title || !row.target_type) throw ewErr(400, "title and target_type required");
          out = (await sb("notifications", { method: "POST", body: JSON.stringify(row) }))[0];
          break;
        }
        case "notification.update": {
          needAdmin();
          out = (await sb(`notifications?id=eq.${Number(args.id)}`, { method: "PATCH", body: JSON.stringify(ewPick(args.fields, EW_NOTIF_FIELDS)) }))[0];
          break;
        }
        case "notification.delete": {
          needAdmin();
          await sb(`notifications?id=eq.${Number(args.id)}`, { method: "DELETE" });
          out = { deleted: Number(args.id) };
          break;
        }
        case "triage.update": {
          needAdmin();
          if (!/^[0-9a-f-]{36}$/i.test(String(args.id))) throw ewErr(400, "bad id");
          out = (await sb(`feedback_triage?id=eq.${args.id}`, { method: "PATCH", body: JSON.stringify(ewPick(args.fields, EW_TRIAGE_FIELDS)) }))[0];
          break;
        }
        // ── any signed in user, fixed shapes only ──
        case "notification.self": {
          if (!me) throw ewErr(403, "no EyeWire II profile");
          const title = String(args.title || "");
          const okTitle = EW_SELF_TITLES.includes(title) || (title.startsWith("🏆 New Achievement: ") && title.length <= 120);
          if (!okTitle) throw ewErr(400, "not an allowed self notification");
          if (title.startsWith("💙") && (me.total_edits || 0) < 3) throw ewErr(400, "not yet");
          const since = new Date(Date.now() - 6 * 864e5).toISOString();
          const dup = await sb(`notifications?target_type=eq.user&target_id=eq.${me.id}&title=eq.${encodeURIComponent(title)}&created_at=gte.${since}&select=id`);
          if (dup.length) { out = dup[0]; break; }
          const row = { title, body: String(args.body || "").slice(0, 500), image_url: args.image_url || null, thumbnail_url: args.thumbnail_url || null,
            target_type: "user", target_id: me.id, send_at: new Date().toISOString(), created_by: me.id };
          out = (await sb("notifications", { method: "POST", body: JSON.stringify(row) }))[0];
          break;
        }
        case "notification.helpReply": {
          if (!me) throw ewErr(403, "no EyeWire II profile");
          const target = String(args.targetUserId || "");
          if (!/^[0-9a-f-]{36}$/i.test(target) || target === me.id) throw ewErr(400, "bad target");
          // Only to someone who has asked for help.
          const asked = await sb(`help_requests?user_id=eq.${target}&select=id&limit=1`);
          if (!asked.length) throw ewErr(400, "that user has no help request");
          const row = { title: "💬 Response to your help request",
            body: `${(me.display_name || "Someone")} responded${args.segId ? ` on ${String(args.segId).slice(0, 40)}` : ""}: ${String(args.note || "").slice(0, 160)}`,
            target_type: "user", target_id: target, send_at: new Date().toISOString(), created_by: me.id };
          out = (await sb("notifications", { method: "POST", body: JSON.stringify(row) }))[0];
          break;
        }
        case "notification.claimChatPost": {
          needAdmin();
          // Exactly one client may post a due announcement to chat: claim it
          // only while chat_posted_at is still empty and it is due.
          const now = new Date().toISOString();
          const rows = await sb(`notifications?id=eq.${Number(args.id)}&chat_posted_at=is.null&post_to_chat=eq.true&send_at=lte.${now}&or=(expires_at.is.null,expires_at.gt.${now})`,
            { method: "PATCH", body: JSON.stringify({ chat_posted_at: now }) });
          out = { claimed: rows.length > 0 };
          break;
        }
        default:
          throw ewErr(400, `unknown action ${action}`);
      }
      res.json({ ok: true, data: out });
    } catch (e) {
      console.warn("[ewSecureWrite]", action, who.email, e.message);
      res.status(e.status || 500).json({ error: e.status ? e.message : "The operation could not be completed." });
    }
  }
);


exports.ewCommunityData = onRequest(
  { region: "us-central1", secrets: [ewServiceKey], cors: EW_ORIGINS, invoker: "public", maxInstances: 20 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({message:"POST only"});
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 256 * 1024) return res.status(413).json({message:"Request too large"});
    try {
      const input = req.body || {};
      const who = input.token ? await ewVerify(input.token) : null;
      if (input.token && !who) return res.status(401).json({message:"Sign in again."});
      const key = ewServiceKey.value().trim(), sb = ewSb(key);
      const ctx=await pilotContext(sb,who), {me,isAdmin}=ctx;
      const groups = me ? (await sb("user_group_members?user_id=eq."+me.id+"&select=group_id")).map(r=>r.group_id) : [];
      const context={...ctx,groups,now:new Date().toISOString()};
      const read=["GET","HEAD"].includes(String(input.method||"GET").toUpperCase());
      if(!read && !(input.table==="users" && input.method==="POST")) requirePilot(context);
      const plan=authorizePilotData(input,context)||authorizeData(input,context);
      if(plan.table==="special_badge_awards" && !isAdmin && plan.body) {
        const rows=Array.isArray(plan.body)?plan.body:[plan.body];
        for(const row of rows) {
          const badges=await sb("special_badges?id=eq."+Number(row.badge_id)+"&select=name,slug&limit=1");
          if(!badges.some(b=>["Citizen Scientist","Advanced Operator","Merge Master","Cut Master"].includes(b.name))) throw ewErr(403,"This award requires an admin.");
        }
      }
      if (plan.method !== "GET" && plan.method !== "HEAD") {
        const quota = await rateLimit({ip:who.email}, true, "write:"+plan.table);
        if (!quota.ok) throw ewErr(429,"Please wait before sending another change.");
      }
      if (plan.table === "chat_messages" && plan.body?.notification_id != null) {
        const notices=await sb("notifications?id=eq."+Number(plan.body.notification_id)+"&target_type=eq.all&select=id&limit=1");
        if(!notices.length) throw ewErr(403,"Only public announcements may be posted to chat.");
      }
      const headers = {apikey:key, ...(key.startsWith("sb_")?{}:{Authorization:"Bearer "+key}), "Content-Type":"application/json"};
      headers.Accept = input.accept === "application/vnd.pgrst.object+json" ? input.accept : "application/json";
      const preferences = ["return=representation"];
      if (String(input.prefer).includes("count=exact")) preferences.push("count=exact");
      if (["notification_reads","user_group_members","chat_presence",...Object.keys(pilotConflicts)].includes(plan.table) && plan.method === "POST" && plan.query.has("on_conflict")) preferences.push("resolution=merge-duplicates");
      headers.Prefer = preferences.join(",");
      if (typeof input.range === "string" && /^\d+-\d+$/.test(input.range)) {
        const [from,to] = input.range.split("-").map(Number);
        if (to < from || to-from > 499 || to > 100000) throw ewErr(400,"Invalid range");
        headers.Range = input.range;
      }
      const upstream = await fetch(EW_SB+plan.table+"?"+plan.query.toString(), {method:plan.method,headers,
        body:plan.body === undefined ? undefined : JSON.stringify(plan.body), redirect:"error", signal:AbortSignal.timeout(15000)});
      let body = await upstream.text();
      if(upstream.ok && plan.table==="tutorial_practice_examples" && ["PATCH","DELETE"].includes(plan.method) && body==="[]") throw ewErr(409,"A learner or reset is using this practice cell. Try again after it is released.");
      // Expected API errors are useful to the SDK; hide database diagnostics.
      if (!upstream.ok) {
        let code; try { code = JSON.parse(body).code; } catch {}
        body = JSON.stringify({code, message:upstream.status===406 ? "Requested row was not found or was not unique." : "The requested operation could not be completed."});
      }
      const responseHeaders = {"Content-Type":"application/json"};
      for (const name of ["content-range","range-unit"]) if (upstream.headers.has(name)) responseHeaders[name]=upstream.headers.get(name);
      return res.json({status:upstream.status,headers:responseHeaders,body});
    } catch (e) {
      console.warn("[ewCommunityData]", e.status || 500);
      return res.status(e.status || 500).json({message:e.status ? e.message : "Data is temporarily unavailable."});
    }
  }
);


exports.ewSecureUpload = onRequest(
 {region:"us-central1",secrets:[ewServiceKey],cors:EW_ORIGINS,invoker:"public",maxInstances:10},
 async(req,res)=>{
  res.set("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  try {
   const input=req.body||{}, who=await ewVerify(input.token);
   if(!who)throw ewErr(401,"Sign in first.");
   const key=ewServiceKey.value().trim(), sb=ewSb(key);
   const isAdmin=(await sb("admins?email=eq."+encodeURIComponent(who.email)+"&select=id&limit=1")).length>0;
   requirePilot(await pilotContext(sb,who));
   const upload=require("./upload-policy").prepareUpload(input,who,isAdmin);
   if(!(await rateLimit({ip:who.email},false,"upload")).ok)throw ewErr(429,"Please wait before uploading another image.");
   const url="https://javthknksdcrlhiaaptj.supabase.co/storage/v1/object/admin-uploads/"+upload.path;
   const r=await fetch(url,{method:"POST",headers:{apikey:key,...(key.startsWith("sb_")?{}:{Authorization:"Bearer "+key}),"Content-Type":upload.contentType,"x-upsert":"false"},body:upload.bytes,redirect:"error",signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw ewErr(502,"Image storage is temporarily unavailable.");
   return res.json({url:url.replace("/object/","/object/public/")});
  }catch(e){return res.status(e.status||500).json({error:e.status?e.message:"Image upload failed."});}
 }
);

exports.ewSheetSync = onRequest(
 {region:"us-central1",serviceAccount:`eyewire-sheet-sync@${process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || "eyewire-ii-e4d52"}.iam.gserviceaccount.com`,secrets:[ewServiceKey],cors:EW_ORIGINS,invoker:"public",maxInstances:1,concurrency:1,timeoutSeconds:90},
 async(req,res)=>{
  res.set("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"POST only"});
  if(Buffer.byteLength(JSON.stringify(req.body||{}))>8192) return res.status(413).json({error:"Input too large"});
  try {
   const input=req.body||{};
   if(input.action==='health') {
    if(!(await rateLimit(req,false,'sheets:health')).ok) throw ewErr(429,'Please wait.');
    const {SOURCES}=require('./sheet-policy'),{sheetsApi}=require('./sheet-sync');
    for(const source of Object.values(SOURCES)) {
     const meta=await sheetsApi(admin.credential.applicationDefault(),source.id+'?fields=sheets(properties,protectedRanges)');
     const sheet=meta.sheets.find(s=>s.properties.sheetId===source.gid);
     if(!sheet) throw Error('Registered sheet tab missing');
     const range="'"+sheet.properties.title.replace(/'/g,"''")+"'!A1:AZ10";
     const grid=await sheetsApi(admin.credential.applicationDefault(),source.id+'/values/'+encodeURIComponent(range));
     const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
     const headerRow=(grid.values||[]).findIndex(row=>row.some(v=>['startseg','segmentid','segment','segid'].some(p=>norm(v).includes(p))));
     if(headerRow<0) throw Error('Registered sheet header missing');
     const columns=grid.values[headerRow].map((v,i)=>({name:norm(v),i})).filter(({name})=>['proofreader','claimedby','completedby','status','datecomplete','completedtime','finalseg','correctedsoma','somacoord'].some(p=>name.includes(p)));
     if(!columns.length) throw Error('Registered sheet write columns missing');
     // Probe only the actual write columns. A whole-sheet probe hits the
     // owner's protected reference columns even when writeback is permitted.
     // Identity replacement cannot change a value, even if the text existed.
     const probe='__eyewire_sync_noop_785ea491a19d4f7bab5b__';
     console.info('[ewSheetSync] write probe',JSON.stringify({sheet:source.gid,columns,protections:(sheet.protectedRanges||[]).map(p=>({range:p.range,canEdit:p.requestingUserCanEdit,warningOnly:p.warningOnly,unprotected:p.unprotectedRanges}))}));
     await sheetsApi(admin.credential.applicationDefault(),source.id+':batchUpdate',{method:'POST',body:JSON.stringify({requests:columns.map(({i})=>({findReplace:{find:probe,replacement:probe,range:{sheetId:source.gid,startRowIndex:headerRow+1,endRowIndex:headerRow+2,startColumnIndex:i,endColumnIndex:i+1},matchCase:true}}))})});
    }
    return res.json({ok:true,sheets:Object.keys(SOURCES),keyless:true,writable:true});
   }
   const who=await ewVerify(input.token);
   if(!who) throw ewErr(401,"Sign in before syncing a cell.");
   require('./sheet-policy').sourceFor(input);
   if(!(await rateLimit({ip:who.email},true,"write:sheets")).ok) throw ewErr(429,"Please wait before syncing another cell.");
   const sb=ewSb(ewServiceKey.value().trim());
   const me=(await sb('users?middleauth_email=eq.'+encodeURIComponent(who.email)+'&select=id,display_name,username&limit=1'))[0];
   requirePilot(await pilotContext(sb,who));
   if(!me) throw ewErr(403,"Create your EyeWire II profile first.");
   const tasks=await sb('proofreading_tasks?dataset=eq.'+encodeURIComponent(input.dataset)+'&segment_id=eq.'+input.segmentId+'&assigned_to=eq.'+me.id+'&select=*&order=updated_at.desc&limit=1');
   return res.json(await require('./sheet-sync').syncSheet(input,me,tasks[0],admin.credential.applicationDefault()));
  } catch(e) {
   console.warn('[ewSheetSync]',e.status||500,e.message);
   return res.status(e.status||503).json({error:e.status?e.message:"Sheet syncing is temporarily unavailable. Your cell is saved; retry syncing shortly."});
  }
 }
);
