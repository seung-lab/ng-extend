/**
 * Which week Your Week in Science shows, in US Eastern time like the Sunday
 * recap notification (scripts/weekly-recap.mjs, Monday 00:00 ET). Opening the
 * recap showed the new week instead, empty on a Monday morning, and on each
 * player's own clock (Nseraf, report 250; Ames 2026-10-25: "it's supposed to
 * be just for the week", "make sure the time zones are consistent, we can use
 * ET"). The notification sets the week from its title; anything else shows
 * the current week.
 */
import { ref } from 'vue';

export interface Ymd { y: number; m: number; d: number; }   // m: 0 = January
/** The Monday of the week to show, as an ET calendar date, or null for this week. */
export const recapWeekStart = ref<Ymd | null>(null);
/** The month to show instead of a week ("My Month in Science"), set by the
 *  monthly recap notification (scripts/monthly-recap.mjs); null shows a week. */
export const recapMonth = ref<{ y: number; m: number } | null>(null);

const TZ = 'America/New_York';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's calendar date and weekday (0 = Sunday) in ET. */
function todayET(): Ymd & { wd: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** The instant ET midnight starts on a calendar date (handles daylight saving). */
export function etMidnight({ y, m, d }: Ymd): Date {
  let t = Date.UTC(y, m, d, 5);   // 05:00 UTC is midnight EST; then correct by the real offset
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    t += Date.UTC(y, m, d) - shown;
  }
  return new Date(t);
}

const addDays = ({ y, m, d }: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(y, m, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};

/** The week shown: ET Monday 00:00 up to the next Monday, and its label. */
export function weekPeriodET(monday: Ymd | null) {
  const today = todayET();
  const mon = monday ?? addDays(today, -((today.wd + 6) % 7));
  const sun = addDays(mon, 6);
  const fmt = (x: Ymd) => `${MONTHS[x.m]} ${x.d}`;
  return { start: etMidnight(mon), end: etMidnight(addDays(mon, 7)), label: `${fmt(mon)} to ${fmt(sun)}, ${sun.y}` };
}

/** The start of the current calendar month in ET. */
export function monthStartET(): Date {
  const t = todayET();
  return etMidnight({ y: t.y, m: t.m, d: 1 });
}

/** "✨ Your Week in Science: Oct 19 to Oct 25, 2026" → { y: 2026, m: 9, d: 19 }. */
export function weekFromRecapTitle(title: string): Ymd | null {
  const m = String(title || '').match(/([A-Z][a-z]{2}) (\d{1,2}) to ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const startMonth = MONTHS.indexOf(m[1]), endMonth = MONTHS.indexOf(m[3]);
  if (startMonth < 0 || endMonth < 0) return null;
  return { y: Number(m[5]) - (startMonth > endMonth ? 1 : 0), m: startMonth, d: Number(m[2]) };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A calendar month in ET: the 1st 00:00 up to the next 1st, like the
 *  monthly recap (scripts/recap-month.mjs), and its label "October 2026". */
export function monthPeriodET({ y, m }: { y: number; m: number }) {
  return { start: etMidnight({ y, m, d: 1 }), end: etMidnight({ y: m === 11 ? y + 1 : y, m: (m + 1) % 12, d: 1 }), label: `${MONTH_NAMES[m]} ${y}` };
}

/** "✨ Your Month in Science: October 2026" → { y: 2026, m: 9 }. */
export function monthFromRecapTitle(title: string): { y: number; m: number } | null {
  const hit = String(title || '').match(/Month in Science:?\s*([A-Z][a-z]+) (\d{4})/);
  if (!hit) return null;
  const m = MONTH_NAMES.indexOf(hit[1]);
  return m < 0 ? null : { y: Number(hit[2]), m };
}

/** The Pyr year to show (scripts/recap-month.mjs yearRange): Year n runs from
 *  Sep 28 00:00 ET, the day the first testers came in 2026, to the next
 *  Sep 28. Set by the Your Year in Science notification; null shows a week. */
export const recapYear = ref<number | null>(null);
const YEAR_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

export function yearPeriodET(n: number) {
  const y = 2026 + n - 1;
  return { start: etMidnight({ y, m: 8, d: 28 }), end: etMidnight({ y: y + 1, m: 8, d: 28 }), label: `Year ${YEAR_WORDS[n] ?? n}` };
}

/** "✨ Your Year in Science: Year One" → 1. */
export function yearFromRecapTitle(title: string): number | null {
  const hit = String(title || '').match(/Year in Science:?\s*Year (\w+)/);
  if (!hit) return null;
  const n = YEAR_WORDS.indexOf(hit[1]);
  return n > 0 ? n : (Number(hit[1]) || null);
}
