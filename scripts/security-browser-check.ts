import { renderSafeMarkdown } from '../src/util/safe_markdown';
const cases = [
  '<img src="invalid:" onerror="document.title=\'FAILED\'">',
  '<svg onload="document.title=\'FAILED\'"></svg>',
  '[bad](javascript:document.title=\'FAILED\')',
  '<a href="data:text/html,test">bad</a>',
  '<iframe srcdoc="<script>parent.document.title=\'FAILED\'</script>"></iframe>',
  '**Science**\n\n[Help](https://connectome.quest/help)',
];
const root = document.getElementById('results')!;
for (const source of cases) {
  const node = document.createElement('section');
  node.innerHTML = renderSafeMarkdown(source);
  if (node.querySelector('img,svg,script,iframe,[onerror],[onload]')) throw new Error('Active content survived');
  for (const link of Array.from(node.querySelectorAll('a[href]'))) {
    if (!/^https:\/\//.test(link.getAttribute('href')!)) throw new Error('Unsafe URL survived');
  }
  root.appendChild(node);
}
document.getElementById('status')!.textContent = 'PASS: six browser rendering checks';
document.title = 'Security rendering checks passed';
