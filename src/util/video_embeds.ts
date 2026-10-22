/**
 * Videos in a notification (Ames 2026-10-22: "can we embed videos into a
 * notification?"). A link to a video in a notification's text plays in place
 * when the notification is open, with the link kept under it. The text itself
 * stays plain markdown: an admin just pastes the link.
 *
 * Recognised, and only these, each by a strict pattern:
 *   YouTube        youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
 *                  (played from youtube-nocookie.com)
 *   Vimeo          vimeo.com/NUMBER
 *   Google Drive   drive.google.com/file/d/ID/... (its own preview player,
 *                  for a file shared with anyone who has the link)
 *   A video file   an https link ending in .mp4 or .webm
 * Players are built element by element from the id alone, never from the
 * link's text, so nothing in a link can become markup.
 */

const YT = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VIMEO = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{4,12})(?:[/?#]|$)/;
const DRIVE = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,80})(?:[/?#]|$)/;
const FILE = /^https:\/\/[^\s"'<>]+\.(?:mp4|webm)(?:[?#][^\s"'<>]*)?$/i;

function playerFor(href: string): HTMLElement | null {
  let src = '';
  let m = YT.exec(href);
  if (m) src = `https://www.youtube-nocookie.com/embed/${m[1]}`;
  else if ((m = VIMEO.exec(href))) src = `https://player.vimeo.com/video/${m[1]}`;
  else if ((m = DRIVE.exec(href))) src = `https://drive.google.com/file/d/${m[1]}/preview`;
  const box = document.createElement('div');
  box.className = 'nge-notif-video';
  if (src) {
    const frame = document.createElement('iframe');
    frame.src = src;
    frame.title = 'Video';
    frame.loading = 'lazy';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    box.appendChild(frame);
    return box;
  }
  if (FILE.test(href)) {
    const video = document.createElement('video');
    video.src = href;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    box.appendChild(video);
    return box;
  }
  return null;
}

/** Already-sanitised notification HTML, with a player before each video link's
 *  paragraph. Safe to run on renderSafeMarkdown's output. */
export function withVideoEmbeds(html: string): string {
  if (!/youtu|vimeo|drive\.google|\.mp4|\.webm/i.test(html)) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  const seen = new Set<string>();
  for (const a of Array.from(t.content.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || '';
    if (seen.has(href)) continue;
    const player = playerFor(href);
    if (!player) continue;
    seen.add(href);
    // Before the link's own line, so the link stays as a way to open it big.
    const block = a.closest('p, li') || a;
    block.parentNode?.insertBefore(player, block);
  }
  return t.innerHTML;
}
