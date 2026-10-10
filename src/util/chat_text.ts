/**
 * Chat text: bold and underline, and search (Krzysztof 2026-10-09, #83, #79).
 *
 * BOLD AND UNDERLINE are typed, there is no toolbar: *bold* and _underline_.
 * A mark only counts at the edges of a word or phrase: it must open after a
 * space (or at the start, or after an opening bracket) and close before a
 * space, the end, or punctuation. So a name like m_sorek, a snake_case word,
 * 2*3*4 and a lone * are left exactly as typed. No italic: thin italic on a
 * dark background is hard to read here.
 *
 * SEARCH is words, in any order, all of which must be in the message or the
 * sender's name. "quoted words" must appear together. -word leaves out the
 * messages that have it. from:name keeps one player's messages.
 */

export interface RichPiece { text: string; bold?: boolean; underline?: boolean; }

const MARK = /(^|[\s([{"'])([*_])(?=\S)([^\n]*?\S)\2(?=$|[\s)\]}.,!?;:"'])/g;

/** Split a run of plain chat text into pieces, the marked ones flagged. */
export function richPieces(text: string): RichPiece[] {
  const out: RichPiece[] = [];
  let last = 0;
  MARK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARK.exec(text))) {
    const [, lead, mark, inner] = m;
    // the same mark inside would be a second phrase, not one long one
    if (inner.includes(mark)) { MARK.lastIndex = m.index + lead.length + 1; continue; }
    const start = m.index + lead.length;
    if (start > last) out.push({ text: text.slice(last, start) });
    // Both at once, one inside the other (Ctrl+B then Ctrl+U gives *_this_*).
    const other = mark === '*' ? '_' : '*';
    if (inner.length > 2 && inner.startsWith(other) && inner.endsWith(other) && !inner.slice(1, -1).includes(other) && /^\S/.test(inner.slice(1)) && /\S$/.test(inner.slice(0, -1))) {
      out.push({ text: inner.slice(1, -1), bold: true, underline: true });
    } else {
      out.push(mark === '*' ? { text: inner, bold: true } : { text: inner, underline: true });
    }
    last = start + inner.length + 2;
    MARK.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** The same text with the marks taken out (for a reply's quoted line). */
export const plainChatText = (text: string): string => richPieces(text).map(p => p.text).join('');

/** Put a mark round the selection, or take it off if it is already there.
 *  Returns the new text and where the selection should sit. */
export function toggleMark(text: string, start: number, end: number, mark: '*' | '_'): { text: string; start: number; end: number } {
  const sel = text.slice(start, end);
  if (sel.length >= 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    return { text: text.slice(0, start) + sel.slice(1, -1) + text.slice(end), start, end: end - 2 };
  }
  if (text[start - 1] === mark && text[end] === mark) {
    return { text: text.slice(0, start - 1) + sel + text.slice(end + 1), start: start - 1, end: end - 1 };
  }
  return { text: text.slice(0, start) + mark + sel + mark + text.slice(end), start: start + 1, end: end + 1 };
}

export interface ChatQuery { must: string[]; not: string[]; from: string[]; }

/** Read what was typed in the search line. Null when there is nothing to search for. */
export function parseChatQuery(raw: string): ChatQuery | null {
  const q: ChatQuery = { must: [], not: [], from: [] };
  const re = /(-?)(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const neg = m[1] === '-';
    let word = (m[2] ?? m[3] ?? '').toLowerCase().trim();
    if (!word) continue;
    if (!neg && m[2] === undefined && word.startsWith('from:')) {
      word = word.slice(5).replace(/^@/, '');
      if (word) q.from.push(word);
      continue;
    }
    (neg ? q.not : q.must).push(word);
  }
  return q.must.length || q.not.length || q.from.length ? q : null;
}

/** Does a message (its sender and its text) answer the query? */
export function matchesChatQuery(q: ChatQuery, name: string, text: string): boolean {
  const who = name.toLowerCase();
  const hay = `${who} ${plainChatText(text).toLowerCase()}`;
  if (q.from.length && !q.from.some(f => who.includes(f))) return false;
  if (q.not.some(w => hay.includes(w))) return false;
  return q.must.every(w => hay.includes(w));
}
