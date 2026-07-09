// assistant/materialization.ts — fetches the latest CAVE materialization
// version + its timestamp so the Guide can answer "why can't I see my edits?"
// with specifics ("the newest materialized snapshot is ~2h old; your edit is
// saved and will appear at the next materialization").
//
// Best-effort and defensive: any failure (no token, CORS, redirect, non-JSON)
// resolves to null and the assistant falls back to its generic explanation.
// Result is cached briefly so it isn't refetched every message.

export interface MaterializationInfo {
  latestVersion: number;
  versionCount: number;
  timestamp?: string;
  ageMinutes?: number;
}

const TTL_MS = 3 * 60 * 1000;
let cache: { at: number; key: string; data: MaterializationInfo | null } | null = null;

// The middleauth access token is stored per login under auth_token_v2_<url>.
function getCaveToken(): string | null {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("auth_token_v2_")) {
        const d = JSON.parse(localStorage.getItem(key) || "{}");
        if (d && d.accessToken) return d.accessToken;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch(url, { headers });
    // A 302 to the auth page (unauthenticated) or any non-JSON body → bail.
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getMaterializationInfo(
  caveServer?: string,
  datastack?: string,
): Promise<MaterializationInfo | null> {
  if (!caveServer || !datastack) return null;
  const key = `${caveServer}|${datastack}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.data;

  const token = getCaveToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const base = `${caveServer.replace(/\/$/, "")}/materialize/api/v3/datastack/${datastack}`;

  let data: MaterializationInfo | null = null;
  const vjson = await fetchJson(`${base}/versions`, headers);
  const versions: number[] = Array.isArray(vjson) ? vjson : (vjson && vjson.versions) || [];
  if (versions.length) {
    const latestVersion = Math.max(...versions);
    data = { latestVersion, versionCount: versions.length };
    const meta = await fetchJson(`${base}/version/${latestVersion}`, headers);
    const ts = meta && (meta.time_stamp || meta.timestamp);
    if (ts) {
      data.timestamp = ts;
      const ageMin = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
      if (Number.isFinite(ageMin) && ageMin >= 0) data.ageMinutes = ageMin;
    }
  }

  cache = { at: Date.now(), key, data };
  return data;
}
