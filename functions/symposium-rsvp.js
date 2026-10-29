'use strict';
/**
 * RSVPs for the MEC symposium (Ames 2026-10-29): Wednesday 18 November 2026,
 * 10 am Eastern, 3 pm GMT. The form is connectome.quest/symposium/; each
 * answer becomes a row in Ames's Google Sheet ("Pyr MEC Symposium RSVPs"),
 * written by the same sheet identity the Cell Library uses. The sheet must be
 * shared with that identity as an editor (sheet-sync.js, SHEETS_IDENTITY).
 *
 * Pure checks here, so they are tested without a sheet or a network.
 */
const SYMPOSIUM_SHEET_ID = '1ECFHBYUNtxkU6wAlc6ClpRefl53cHSe4-wTEyD4PygA';
const SYMPOSIUM_TAB = 'RSVPs';
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[A-Za-z]{2,24}$/;

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const oneLine = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// A sheet cell that starts with = + - or @ can run as a formula when someone
// opens the sheet. Rows are written as RAW, and this keeps them plain text
// even if the sheet is later exported or pasted elsewhere.
const plain = (s) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);

/** The row to add, or an error with a status a person can act on. */
function planRsvp(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'That did not go through. Please try again.');
  if (input.website) fail(400, 'That did not go through. Please try again.');          // bot trap
  const name = oneLine(input.name, 120);
  const email = oneLine(input.email, 254).toLowerCase();
  const question = String(input.question ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 2000);
  if (!name) fail(400, 'Please add your name.');
  if (!EMAIL.test(email)) fail(400, 'Please check your email address.');
  return {
    email,
    row: [now.toISOString().replace('T', ' ').slice(0, 19), plain(name), plain(email), plain(question), ''],
  };
}

module.exports = { planRsvp, SYMPOSIUM_SHEET_ID, SYMPOSIUM_TAB };
