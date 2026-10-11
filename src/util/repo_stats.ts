/**
 * How much has been built: commits on the live branch and the number of
 * times it has gone live, read from GitHub's public API (Ames 2026-10-10,
 * for her profile and the triage board). No key: the repository is public,
 * and an unsigned reader gets 60 requests an hour, so the answer is kept in
 * this browser for ten minutes. When GitHub cannot be reached the last known
 * numbers are shown, or nothing at all, never a guess.
 */
const REPO = 'seung-lab/ng-extend';
const BRANCH = 'eyewire-ii-community';
const AUTHOR = 'amyleesterling';
const DEPLOY_WORKFLOW = 'on_dev_branch_push.yml';
const KEY = 'nge_repo_stats_v1';
const FRESH_MS = 10 * 60 * 1000;

export interface RepoStats { commits: number; deploys: number; at: number }

/** The player whose profile shows the counter (Amy R. Sterling's player id). */
export const BUILDER_USER_ID = '146a3fec-ee5c-46f9-b1ac-b1ea57501f81';

function saved(): RepoStats | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && Number.isFinite(s.commits) && Number.isFinite(s.deploys) && Number.isFinite(s.at) ? s : null;
  } catch { return null; }
}

/** GitHub pages a list one item at a time and names the last page, which is the count. */
async function commitCount(): Promise<number> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&author=${AUTHOR}&per_page=1`);
  if (!r.ok) throw new Error(`commits ${r.status}`);
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(r.headers.get('Link') || '');
  if (last) return Number(last[1]);
  return ((await r.json()) as unknown[]).length;
}

async function deployCount(): Promise<number> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${DEPLOY_WORKFLOW}/runs?branch=${BRANCH}&status=success&per_page=1`);
  if (!r.ok) throw new Error(`deploys ${r.status}`);
  const n = Number((await r.json())?.total_count);
  if (!Number.isFinite(n)) throw new Error('deploys: no count');
  return n;
}

let inFlight: Promise<RepoStats | null> | null = null;
export function loadRepoStats(): Promise<RepoStats | null> {
  const have = saved();
  if (have && Date.now() - have.at < FRESH_MS) return Promise.resolve(have);
  if (!inFlight) {
    inFlight = Promise.all([commitCount(), deployCount()])
      .then(([commits, deploys]) => {
        const now: RepoStats = { commits, deploys, at: Date.now() };
        try { localStorage.setItem(KEY, JSON.stringify(now)); } catch { /* not remembered */ }
        return now;
      })
      .catch(() => have)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
