/**
 * nkem_test, back in chat (Ames 2026-09-28).
 *
 * In the original EyeWire, @nkem's chatbot nkem_test lived in chat from 2013
 * on: it answered "!" commands, refereed The Hunt, and shouted "for science"
 * in a pile of languages at ceremonies. This is an homage to that last part:
 * say "for science" in chat and nkem_test answers in another language.
 *
 * The bot runs in each reader's browser and writes nothing to the database,
 * so it can't be spoofed or used to spam. The language is picked from the
 * message id, so everyone sees the same reply, in history as well as live.
 */

export const BOT_NAME = 'nkem_test';

/** "For science!" around the world. Checked translations only. */
export const FOR_SCIENCE: ReadonlyArray<readonly [string, string]> = [
  ['¡Por la ciencia!', 'Spanish'],
  ['Pour la science !', 'French'],
  ['Für die Wissenschaft!', 'German'],
  ['Per la scienza!', 'Italian'],
  ['Pela ciência!', 'Portuguese'],
  ['Per la ciència!', 'Catalan'],
  ['Pola ciencia!', 'Galician'],
  ['Zientziaren alde!', 'Basque'],
  ['Voor de wetenschap!', 'Dutch'],
  ['Vir die wetenskap!', 'Afrikaans'],
  ['För vetenskapen!', 'Swedish'],
  ['For vitenskapen!', 'Norwegian'],
  ['For videnskaben!', 'Danish'],
  ['Fyrir vísindin!', 'Icelandic'],
  ['Tieteen puolesta!', 'Finnish'],
  ['Teaduse nimel!', 'Estonian'],
  ['Dla nauki!', 'Polish'],
  ['Pro vědu!', 'Czech'],
  ['Pre vedu!', 'Slovak'],
  ['Za znanost!', 'Croatian'],
  ['За науку!', 'Russian'],
  ['За науку!', 'Ukrainian'],
  ['За науката!', 'Bulgarian'],
  ['A tudományért!', 'Hungarian'],
  ['Pentru știință!', 'Romanian'],
  ['Για την επιστήμη!', 'Greek'],
  ['Bilim için!', 'Turkish'],
  ['Ar son na heolaíochta!', 'Irish'],
  ['Pro scientia!', 'Latin'],
  ['Por la scienco!', 'Esperanto'],
  ['למען המדע!', 'Hebrew'],
  ['من أجل العلم!', 'Arabic'],
  ['برای علم!', 'Persian'],
  ['विज्ञान के लिए!', 'Hindi'],
  ['বিজ্ঞানের জন্য!', 'Bengali'],
  ['เพื่อวิทยาศาสตร์!', 'Thai'],
  ['Vì khoa học!', 'Vietnamese'],
  ['Demi sains!', 'Indonesian'],
  ['Para sa agham!', 'Filipino'],
  ['Kwa ajili ya sayansi!', 'Swahili'],
  ['科学のために！', 'Japanese'],
  ['为了科学！', 'Chinese'],
  ['과학을 위하여!', 'Korean'],
];

/** "for science", "For Science!!!", "4 science", "for science 🧪" ... */
export function isForScience(text: string): boolean {
  return /\b(for|4)\s+science\b/i.test(text);
}

/** Same message, same language, for every reader. Never English. */
export function forScienceReply(seed: string): { text: string; language: string } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const [text, language] = FOR_SCIENCE[(h >>> 0) % FOR_SCIENCE.length];
  return { text, language };
}

/**
 * Nurro answers "!" commands, like nkem_test did in 2013, for everyone in
 * chat (there are no private messages). nkem_test itself only does science.
 * Keep these true to the app: they name real buttons and keys.
 */
export const NURRO_NAME = 'Nurro';

export const NURRO_ANSWERS: Record<string, string> = {
  about: 'Every cell you proofread becomes part of a real map of brain wiring that scientists use. The AI traces neurons fast but makes mistakes, and you fix them. 🧠',
  faq: 'New here? Take the 🧭 Site Tour in Resources and tutorials (top right). Ask me anything with the AI button (top left). Found a bug? The ! button in the top bar sends it straight to the team.',
  merge: 'A merge joins a branch the AI cut off. Press M, Ctrl+click the branch, Ctrl+click the cell near where it joins, then Submit merge or Enter. Tutorial: Resources and tutorials › Merge.',
  cut: "A cut separates two cells the AI fused. Press C, Ctrl+click 3 or 4 red points on the piece that doesn't belong, press G, add blue points on the cell, then Submit cut or Enter. No undo key: fix a bad cut with a merge. Tutorial: Resources and tutorials › Cut.",
  cells: "Open the Cell Library (the neuron button in the top bar) to claim a cell. My Cells shows what you're working on, and Release gives one back.",
  datasets: 'Switch datasets with the Data button (top left): EyeWire II retina, MEC, MICrONS, and the Sandbox for practice. Cell IDs only exist in their own dataset.',
  stats: "Your edits, merges, cuts, finished cells and streaks are on your profile (the person icon, top right), per dataset. Click anyone's name in chat to see theirs.",
  points: "We don't have a points system... yet! 👀 For now your edits, cells and streaks live on your profile, and the 🏆 Leaderboard crowns the Weekly Champions.",
  share: "Press 📍 next to the chat box to post a link to exactly what you're looking at, with an optional screenshot.",
  tags: 'Found something odd but not sure how to fix it? Press Shift+T for Tag Mode and tag a spot for another player to review.',
};
const ALIASES: Record<string, string> = { commands: 'help', split: 'cut', cell: 'cells', dataset: 'datasets', tag: 'tags', stat: 'stats', point: 'points' };
const HELP = 'Try !about, !faq, !merge, !cut, !cells, !datasets, !stats, !points, !share, !tags, !leaders, !online or !online @username. Or just say "for science!"';

/** "!online celiad" / "!online @celiad": whose status to look up, or null. */
export function onlineTarget(text: string): string | null {
  return text.trim().match(/^!online\s+@?([A-Za-z0-9._-]{2,40})\b/i)?.[1] ?? null;
}

function ago(d: Date, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function when(d: Date): string {
  return `${ago(d)} (${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`;
}

/** Nurro's answer to "!online name", from what the app knows about them. */
export function describeLastSeen(asked: string, info: { name?: string; onlineNow?: boolean; lastChat?: Date | null; lastEdit?: Date | null; exists: boolean }): string {
  const who = info.name || asked;
  if (info.onlineNow) return `${who} is online right now 🟢`;
  if (!info.exists) return `I can't find anyone called ${asked}. Check the spelling?`;
  const { lastChat, lastEdit } = info;
  if (lastChat && lastEdit) return `${who} was last in chat ${when(lastChat)} and last edited ${when(lastEdit)}.`;
  if (lastChat) return `${who} was last in chat ${when(lastChat)}.`;
  if (lastEdit) return `${who} last edited ${when(lastEdit)}. No chat messages yet.`;
  return `${who} hasn't chatted or edited yet.`;
}

export type BotReply = { name: string; text: string; language?: string };

/**
 * The bot's answer to a chat message, or null. `online` is who's here now,
 * or null when replaying history (a stale head count would mislead, so
 * !online only answers live).
 */
export function botReply(seed: string, text: string, online: string[] | null): BotReply | null {
  const cmd = text.trim().match(/^!([a-z]+)\b/i)?.[1]?.toLowerCase();
  if (cmd) {
    const key = ALIASES[cmd] ?? cmd;
    if (key === 'science') return { name: BOT_NAME, ...forScienceReply(seed) };
    if (key === 'help') return { name: NURRO_NAME, text: HELP };
    // The chat store answers these live with the daily leaders card.
    if (key === 'leaders' || key === 'today') return null;
    if (key === 'online') {
      // "!online name" needs a lookup; the chat store answers it live.
      if (!online || onlineTarget(text)) return null;
      return { name: NURRO_NAME, text: online.length
        ? `${online.length} online right now: ${online.join(', ')}`
        : "It's just us right now. Hi! 👋" };
    }
    if (NURRO_ANSWERS[key]) return { name: NURRO_NAME, text: NURRO_ANSWERS[key] };
    return { name: NURRO_NAME, text: `I don't know !${cmd} yet. ${HELP}` };
  }
  if (isForScience(text)) return { name: BOT_NAME, ...forScienceReply(seed) };
  return null;
}
