/**
 * Eastern-Time helpers for admin scheduling.
 *
 * Notification send/expiry times are authored by admins and must mean the same
 * wall-clock moment for everyone: "8am" is 8am ET whether the admin is in
 * Princeton, California, or Europe.
 *
 * The problem this solves: an `<input type="datetime-local">` yields a NAIVE
 * string like "2026-07-20T08:00" with no zone, and `new Date(naive)` parses it
 * in the BROWSER's local zone. So a West-Coast admin scheduling 08:00 was
 * really scheduling 08:00 PT (11:00 ET). These helpers pin the interpretation
 * to America/New_York instead, and handle EST/EDT automatically because the
 * offset is computed for the specific date rather than hard-coded.
 */

export const ET_ZONE = 'America/New_York';

/**
 * Offset of `zone` from UTC, in ms, at a given instant.
 * Positive when the zone is ahead of UTC (ET is always negative).
 */
function zoneOffsetMs(zone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
  // `Intl` renders hour 24 for midnight in some engines; normalise to 0.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second));
  return asIfUtc - at.getTime();
}

/**
 * Interpret a naive `datetime-local` string as Eastern Time and return a UTC
 * ISO string suitable for a `timestamptz` column.
 *
 * Two-pass offset correction: the offset depends on the instant, but we don't
 * know the instant until we've applied the offset. The first pass gets us
 * within an hour, the second settles it — which matters on DST boundaries.
 *
 * @param naive e.g. "2026-07-20T08:00" (as produced by <input type="datetime-local">)
 * @returns UTC ISO string, or '' when the input is empty/unparseable.
 */
export function etNaiveToUtcIso(naive: string): string {
  if (!naive) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(naive);
  if (!m) return '';
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);

  let instant = new Date(wallAsUtc - zoneOffsetMs(ET_ZONE, new Date(wallAsUtc)));
  // Second pass: recompute the offset at the candidate instant.
  instant = new Date(wallAsUtc - zoneOffsetMs(ET_ZONE, instant));
  return instant.toISOString();
}

/**
 * Inverse of {@link etNaiveToUtcIso}: render a stored UTC instant as a naive
 * ET string, for pre-filling a `datetime-local` input.
 */
export function utcIsoToEtNaive(iso: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (isNaN(at.getTime())) return '';
  const shifted = new Date(at.getTime() + zoneOffsetMs(ET_ZONE, at));
  return shifted.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

/** Human-readable ET rendering, e.g. "Jul 20, 8:00 AM ET". */
export function formatEt(iso: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(at) + ' ET';
}

/** True when `at` falls in the given hour of the ET day (used by cron jobs). */
export function etHour(at: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE, hour12: false, hour: '2-digit',
  }).format(at);
  return h === '24' ? 0 : Number(h);
}
