import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** One policy for streamed Guide text and stored player/notification text. */
export function renderSafeMarkdown(text: string, notification = false): string {
  let html: string;
  try {
    html = marked.parse(text || '', { gfm: true, breaks: true, async: false }) as string;
  } catch {
    html = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // No script/data URLs or remote images. Relative links stay on this origin.
    ALLOWED_URI_REGEXP: /^(?:https:\/\/|\/(?!\/)|#)/i,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const link of Array.from(template.content.querySelectorAll('a'))) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    if (notification) link.className = 'nge-notif-link';
  }
  return template.innerHTML;
}
