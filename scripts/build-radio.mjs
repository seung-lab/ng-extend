#!/usr/bin/env node
/**
 * EyeWire Radio: turn the master WAVs into web tracks and a playlist.
 *
 *   node scripts/build-radio.mjs ["C:\Users\amyle\Music\eyewire music"]
 *
 * The folder of WAVs is the source of truth. Every run rebuilds
 * hosting/radio/ from it: one .m4a per song (AAC, 128 kbps, loudness matched
 * so no track jumps out) and playlist.json. Then publish with
 *
 *   firebase deploy --only hosting --project eyewire-ii-e4d52
 *
 * Firebase Hosting, not Supabase: audio is the one thing that would fill the
 * Supabase bucket (Ames 2026-10-05). A hosting deploy REPLACES the whole
 * site with what is in hosting/, so always run this first, from the machine
 * that has the WAVs. The .m4a files are not committed (see .gitignore);
 * playlist.json is, so the track list has a history.
 *
 * A track keeps its file name when its WAV has not changed, so browsers keep
 * their cached copy (the files are served as immutable).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || 'C:\\Users\\amyle\\Music\\eyewire music';
const OUT = path.join(ROOT, 'hosting', 'radio');
fs.mkdirSync(OUT, { recursive: true });

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const wavs = fs.readdirSync(SRC).filter(f => /\.(wav|flac|aiff?)$/i.test(f)).sort();
if (!wavs.length) { console.error(`No WAV files in ${SRC}`); process.exit(1); }

const tracks = [];
const keep = new Set(['playlist.json']);
for (const f of wavs) {
  const src = path.join(SRC, f);
  const title = f.replace(/\.[^.]+$/, '').trim();
  // name carries a short hash of the master, so a re-export gets a new URL
  const hash = createHash('sha1').update(fs.readFileSync(src)).digest('hex').slice(0, 8);
  const file = `${slug(title)}.${hash}.m4a`;
  const out = path.join(OUT, file);
  keep.add(file);
  if (!fs.existsSync(out)) {
    console.log('encoding', title);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',     // one loudness for the whole station
      '-ar', '48000', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',                   // plays while it downloads
      '-metadata', `title=${title}`, '-metadata', 'album=EyeWire Radio',
      out], { stdio: 'inherit' });
  }
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
  tracks.push({ id: slug(title), title, file, duration: Math.round(duration), bytes: fs.statSync(out).size });
}
// The song the station opens with (Ames 2026-10-05: "play Sunlit Garden Puzzle
// first. it is perfect"). The player starts on the first track, then shuffles.
const OPENER = 'sunlit-garden-puzzle';
tracks.sort((a, b) => (b.id === OPENER) - (a.id === OPENER));
// drop tracks whose master is gone
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log('removed', f); }

fs.writeFileSync(path.join(OUT, 'playlist.json'), JSON.stringify({ station: 'EyeWire Radio', tracks }, null, 2) + '\n');
const mb = tracks.reduce((n, t) => n + t.bytes, 0) / 1048576;
console.log(`${tracks.length} tracks, ${mb.toFixed(1)} MB -> ${path.relative(ROOT, OUT)}`);
