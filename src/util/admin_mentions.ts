/**
 * "@Celia" in a triage note: who is meant, as the server reads it
 * (functions/todo-connector.js tagIdsIn: "@" and a whole name, or a first
 * name that is not the start of a longer word). The picker inserts the whole
 * Pyr name, so a picked tag always reaches its person; the nicknames only
 * help find them while typing ("@Mar" finds M Sorek, Ames 2026-10-22).
 */
export interface AdminPerson { id: string; name: string }

const NICKNAMES: [RegExp, string[]][] = [
  [/^(amy|ames)\b|^amy/i, ['Amy', 'Ames']],
  [/^celia/i, ['Celia']],
  [/^(marissa|m sorek|sorek)/i, ['Marissa', 'Sorek']],
];

/** Every name a person can be found by in the picker. */
export function searchNamesOf(p: AdminPerson): string[] {
  const full = String(p.name || '').trim();
  if (!full) return [];
  const out = [full, full.split(/\s+/)[0]];
  for (const [re, nick] of NICKNAMES) if (re.test(full)) out.push(...nick);
  return [...new Set(out)].filter(n => n.length > 1);
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Who the server will tag for this text: the same rule as tagIdsIn. */
export function serverTagged(text: string, people: AdminPerson[]): AdminPerson[] {
  const t = String(text || '').toLowerCase();
  return people.filter(p => {
    const name = String(p.name || '').toLowerCase();
    if (!name) return false;
    const first = '@' + name.split(/\s+/)[0];
    return t.includes('@' + name) || new RegExp(escapeRe(first) + '(?![a-z0-9])').test(t);
  });
}
