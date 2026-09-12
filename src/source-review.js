import { marked } from 'marked';

function prose(tokens) {
  return tokens
    .flatMap((token) => {
      if (['code', 'codespan', 'link', 'image', 'html'].includes(token.type)) return [];
      if (token.tokens) return prose(token.tokens);
      if (token.items) return prose(token.items);
      if (token.type === 'table') return prose([...token.header, ...token.rows.flat()]);
      return token.type === 'text' || token.type === 'escape' ? [token.text] : [];
    })
    .join('\n');
}

export function reviewSources(message) {
  if (!message.documentMode || !message.sources?.length || !message.content) return null;
  const text = prose(marked.lexer(message.content));
  const ids = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))];
  const available = new Set(message.sources.map((source) => source.id));
  const missing = ids.filter((id) => !available.has(id));
  const cited = ids.filter((id) => available.has(id));
  return { missing, cited, uncited: !ids.length };
}

export function sourceReviewText(review) {
  if (!review) return '';
  if (review.missing.length)
    return `Referencias no disponibles: ${review.missing.map((id) => `[${id}]`).join(', ')}. Contrasta la respuesta con los fragmentos consultados.`;
  if (review.uncited)
    return 'La respuesta no incluye citas verificables. Revisa los fragmentos consultados antes de utilizarla.';
  return `${review.cited.length} referencias disponibles. Puedes abrirlas para contrastar la respuesta; su presencia no verifica las afirmaciones.`;
}
