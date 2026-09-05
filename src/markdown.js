import { marked } from 'marked';
import DOMPurify from 'dompurify';

const OPTIONS = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    's',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'a',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'start'],
  ALLOW_DATA_ATTR: false,
  // Model-generated links are references, not commands for external apps.
  // Relative URLs and protocol handlers (mailto, tel, sms, etc.) are excluded.
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
};

export function renderMarkdown(text, purifier = DOMPurify) {
  // Images and embedded media are intentionally excluded: model output must
  // not initiate requests to arbitrary tracking endpoints.
  return purifier.sanitize(marked.parse(text, { breaks: true, gfm: true }), OPTIONS);
}
