/**
 * Top bar staging, the plain data and rules (no app state, so
 * scripts/topbar-staging.test.mjs can load it on its own). The app side is
 * src/util/toolbar_staging.ts.
 */

// ── What arrives when ───────────────────────────────────────────────────────

export interface StageMoment {
  key: string;
  /** Shown in the test panel. */
  label: string;
  icons: string[];
  /** Nurro's line when this moment brings icons no tutorial box introduces. */
  nurro?: string;
  /** A button on Nurro's card that opens Profile > Settings. */
  settingsButton?: boolean;
}

/** Never brought in on their own; Settings turns them on. Dataset Stats: the
 *  weekly notification leads there. Batch: the Seg panel's folders do its job
 *  for a new player now (Ames 2026-10-21). */
export const NEVER_AUTO = ['datasetStats', 'batch'];

export const STAGE_MOMENTS: StageMoment[] = [
  { key: 'start', label: 'First visit', icons: ['notif'] },
  // Undelete comes early too (Ames 2026-10-20): it rescues a cell taken out of view by mistake.
  { key: 'getStarted', label: 'Finish Get Started', icons: ['leaderboard', 'layers', 'undelete', 'chat'],
    nurro: 'You know your way around now. Four things just landed in your top bar: the Leaderboard, the Layer panel, Undelete (it brings back a cell you took out of view) and Chat. Come say hi!' },
  { key: 'merge', label: 'Merge tutorial: How to Merge', icons: ['merge'] },
  { key: 'cut', label: 'Cut tutorial: How to Cut', icons: ['split'] },
  // Ames 2026-10-20: the Cell Library waits until a player can merge and cut.
  { key: 'basics', label: 'Finish the Merge and Cut tutorials', icons: ['cells'],
    // Ames 2026-10-20: they cannot edit real cells until they pass the
    // Proofreading Test; say where help is.
    nurro: 'You can merge and you can cut! The Cell Library is in your top bar now, where you can explore real cells. Editing them opens up once you pass the Proofreading Test. Need help? Ask in Chat, or send a help request from the Cell Library.' },
  { key: 'ai-findPath', label: 'Advanced Interface: Find Path', icons: ['findPath'] },
  { key: 'ai-tags', label: 'Advanced Interface: Tag a merger', icons: ['tags'] },
  { key: 'ai-highlight', label: 'Advanced Interface: Highlight', icons: ['highlight'] },
  { key: 'ai-lantern', label: 'Advanced Interface: Lantern', icons: ['lantern'] },
  { key: 'ownEdit', label: 'First edit on your own', icons: ['help', 'tags'],
    nurro: 'Your first edit on your own! Not sure about a spot? Ask for a Second Opinion with the magnifier in your top bar.' },
  // A player who skips the tutorials is not left with a bare bar: coming back
  // brings whatever the earlier moments would have, tutorial or not.
  { key: 'day2', label: 'Come back on day 2', icons: ['help', 'tags', 'leaderboard', 'layers', 'undelete', 'chat', 'merge', 'split', 'cells'],
    nurro: 'Welcome back! Your top bar has a few more tools now. Not sure about a spot? Ask for a Second Opinion with the magnifier.' },
  { key: 'day3', label: 'Come back on day 3', icons: ['screenshot', 'findPath', 'highlight', 'lantern'],
    nurro: 'Day three! Your top bar has the rest of the everyday tools now. Found something beautiful? The camera saves a picture of it.' },
  // Ames 2026-10-20: Your Week in Science after a week, and a way to the
  // Settings where the top bar is chosen.
  { key: 'week1', label: 'One week after signing up', icons: ['recap'], settingsButton: true,
    nurro: 'One week of science! Your Week in Science is in your top bar now. You can choose which icons your top bar shows in Profile Settings.' },
  // Brings anything still on its way (runMoment); Batch stays off.
  { key: 'production', label: 'Get production access', icons: [],
    nurro: 'You have production access! Every tool you had not met yet is in your top bar now.' },
];

/** Every icon a staged player can be given automatically. */
export const ALL_AUTO = [...new Set(STAGE_MOMENTS.flatMap(m => m.icons))];

/**
 * The tutorial steps that bring an icon in. If a tutorial is rewritten and the
 * step goes, a new player would never be shown that icon by its tutorial:
 * the test on every push and the Staging test panel's check both fail then.
 */
export const TUTORIAL_REVEALS: { tutorial: number; name: string; icon: string }[] = [
  { tutorial: 3, name: 'Merge', icon: 'merge' },
  { tutorial: 5, name: 'Cut', icon: 'split' },
  { tutorial: 2, name: 'Advanced Interface', icon: 'findPath' },
  { tutorial: 2, name: 'Advanced Interface', icon: 'tags' },
  { tutorial: 2, name: 'Advanced Interface', icon: 'highlight' },
  { tutorial: 2, name: 'Advanced Interface', icon: 'lantern' },
  { tutorial: 9, name: 'Merger Sandbox', icon: 'split' },
  { tutorial: 9, name: 'Merger Sandbox', icon: 'findPath' },
  { tutorial: 9, name: 'Merger Sandbox', icon: 'highlight' },
  { tutorial: 11, name: 'Proofreading Test', icon: 'highlight' },
];

/** The icons a tutorial step brings in: its own `reveals`, plus the icon its
 *  box points at (`[data-icon-id="..."]`). */
export function tutorialStepReveals(step: { reveals?: string[]; position?: any } | undefined): string[] {
  if (!step) return [];
  const out = [...(step.reveals || [])];
  const el = typeof step.position?.element === 'string' ? step.position.element : '';
  const m = el.match(/data-icon-id="([a-zA-Z]+)"/);
  if (m) out.push(m[1]);
  return out;
}

/** Which TUTORIAL_REVEALS are still wired: the step number (from 1) that
 *  brings each icon, or 0 when no step of that tutorial does. */
export function checkTutorialWiring(stepsOf: (tutorial: number) => any[] | undefined): { tutorial: number; name: string; icon: string; step: number }[] {
  return TUTORIAL_REVEALS.map(r => {
    const steps = stepsOf(r.tutorial) || [];
    const i = steps.findIndex(s => tutorialStepReveals(s).includes(r.icon));
    return { ...r, step: i + 1 };
  });
}

/*
 * Saving the top bar while icons are held back. The saved order keeps every
 * icon, shown or not, and only the change the player made is applied to it,
 * so nothing still on its way is dropped or moved (and a test on a real
 * account leaves that account's own top bar order exactly as it was).
 */

/** A drag of `src` onto `target`, applied to the full saved order. */
export function dragInFull(full: string[], src: string, target: string, movedRight: boolean): string[] {
  const out = full.filter(id => id !== src);
  const at = out.indexOf(target);
  if (at < 0) return [...out, src];
  out.splice(movedRight ? at + 1 : at, 0, src);
  return out;
}

/** The Settings grid's on and off switches, applied to the full saved order:
 *  icons switched off leave it, icons switched on join the end. */
export function togglesInFull(full: string[], shownBefore: string[], shownNow: string[]): string[] {
  const out = full.filter(id => !(shownBefore.includes(id) && !shownNow.includes(id)));
  for (const id of shownNow) if (!out.includes(id)) out.push(id);
  return out;
}
