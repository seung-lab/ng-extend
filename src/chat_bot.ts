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
