// Remembers which auto-proofread job was submitted for a root, so a reload (or a
// bundle import for the same neuron) can pick the job back up without asking the
// API to search.  One localStorage key per root: "autoproof_job_<rootId>" → job id.
// Root ids are strings (they exceed 2^53); never Number() them.

export function autoproofJobKey(rootId: string): string {
  return `autoproof_job_${rootId}`;
}

export function saveAutoproofJob(rootId: string, jobId: string): void {
  try {
    localStorage.setItem(autoproofJobKey(rootId), jobId);
  } catch {
    /* quota exceeded / storage disabled — the store still holds it in memory */
  }
}

export function loadAutoproofJob(rootId: string): string | null {
  try {
    const v = localStorage.getItem(autoproofJobKey(rootId));
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function clearAutoproofJob(rootId: string): void {
  try {
    localStorage.removeItem(autoproofJobKey(rootId));
  } catch {
    /* ignore */
  }
}
