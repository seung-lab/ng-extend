'use strict';
// Pinning a chat message (Ames 2026-10-10). An admin picks a message; the
// server writes one chat row saying so, with a rank no browser can set, and
// every chat shows the newest such row as the pinned message until a later
// row unpins it or pins another. The row carries the pinned message's own
// words, so the pin still reads after that message has scrolled out of what
// a chat has loaded, and a browser on an older version shows a sensible line.
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

/** The chat row that pins `message` ({id, name, text} read by the server). */
function pinRow(message) {
  const id = message && message.id;
  if (id == null || !/^[A-Za-z0-9-]{1,64}$/.test(String(id))) fail(400, 'Unknown message.');
  const name = String(message.name || '').trim().slice(0, 60) || 'Player';
  const words = String(message.text || '').replace(/\s+/g, ' ').trim();
  if (!words) fail(400, 'That message has no text to pin.');
  const short = Array.from(words).length > 240 ? Array.from(words).slice(0, 240).join('').trimEnd() + '\u2026' : words;
  return {text: `\u{1F4CC} ${name}: ${short}`, dataset: `pin:${id}`};
}
/** The chat row that takes the pin down. */
const unpinRow = () => ({text: '\u{1F4CC} Unpinned the message', dataset: 'pin:none'});

module.exports = {pinRow, unpinRow};
