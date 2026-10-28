/**
 * A simple congratulations for long work on one cell (Ames 2026-10-28: "add a
 * simple congrats message for now"), until the Super Quest Achievements and
 * their art are made. Hears onClaimMilestone (claim_time.ts): 10, 25, 50 and
 * 100 hours on a claim, and a finished Super Quest. Drawn on the page itself,
 * so it shows with the Cell Library closed. Click to close; it goes by itself.
 */
import { onClaimMilestone, type ClaimMilestone } from './claim_time';
import nurroCelebrate from '../../static/nurro/nurro-celebrate.png';

function words(m: ClaimMilestone): { title: string; sub: string } {
  const quest = m.kind === 'interneuron';
  if (m.event === 'complete') {
    const h = Math.floor(m.activeSeconds / 3600);
    return { title: 'Super Quest finished!', sub: h ? `${h} hours of your work on one giant cell. Thank you.` : 'One giant cell, done. Thank you.' };
  }
  return { title: `${m.hours} hours on this ${quest ? 'Super Quest' : 'cell'}!`, sub: 'Every branch you follow counts. Keep going.' };
}

let stylesAdded = false;
function addStyles() {
  if (stylesAdded) return;
  stylesAdded = true;
  const css = document.createElement('style');
  css.textContent = `
.nge-congrats { position: fixed; z-index: 100000; left: 50%; top: 84px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px; padding: 14px 20px 14px 14px; max-width: min(460px, calc(100vw - 32px));
  border-radius: 14px; border: 1px solid rgba(196, 140, 255, 0.6); cursor: pointer;
  background: linear-gradient(100deg, rgba(40, 24, 66, 0.97), rgba(18, 26, 44, 0.97)); color: #efe6ff;
  font: 500 14px/1.4 'Inter', 'Segoe UI', sans-serif; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  animation: ngeCongratsIn 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
.nge-congrats img { width: 56px; height: 56px; object-fit: contain; flex-shrink: 0; }
.nge-congrats b { display: block; font-size: 17px; color: #fff; margin-bottom: 2px; }
.nge-congrats--out { animation: ngeCongratsOut 0.4s ease-in both; }
@keyframes ngeCongratsIn { from { opacity: 0; transform: translate(-50%, -10px) scale(0.95); } to { opacity: 1; transform: translateX(-50%); } }
@keyframes ngeCongratsOut { to { opacity: 0; transform: translate(-50%, -8px); } }
@media (prefers-reduced-motion: reduce) { .nge-congrats, .nge-congrats--out { animation: none; } }
body.nge-calm .nge-congrats, body.nge-calm .nge-congrats--out { animation: none; }`;
  document.head.appendChild(css);
}

export function showClaimCongrats(m: ClaimMilestone) {
  try {
    addStyles();
    const { title, sub } = words(m);
    const box = document.createElement('div');
    box.className = 'nge-congrats';
    box.setAttribute('role', 'status');
    const img = document.createElement('img');
    img.src = nurroCelebrate; img.alt = '';
    const text = document.createElement('div');
    const b = document.createElement('b'); b.textContent = title;
    text.append(b, document.createTextNode(sub));
    box.append(img, text);
    let gone = false;
    const close = () => {
      if (gone) return;
      gone = true;
      box.classList.add('nge-congrats--out');
      setTimeout(() => box.remove(), 450);
    };
    box.addEventListener('click', close);
    document.body.appendChild(box);
    setTimeout(close, 9000);
  } catch { /* no page */ }
}

onClaimMilestone(m => {
  // A finished cell other than a Super Quest has its own celebration.
  if (m.event === 'complete' && m.kind !== 'interneuron') return;
  showClaimCongrats(m);
});
