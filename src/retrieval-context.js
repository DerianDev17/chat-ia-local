const normalized = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function isFollowUp(question) {
  const text = normalized(question)
    .replace(/[¿?¡!.,]/g, '')
    .trim();
  return (
    /\b(eso|esa|ese|estos|estas|ellos|ellas|lo anterior)\b/.test(text) ||
    /^(y\s+)?(cuando (vence|termina|empieza)|cuanto (cuesta|dura)|cual es (el plazo|la fecha)|como (funciona|se hace))$/.test(
      text,
    ) ||
    /^y\s+(cuando|cuanto|donde|como)\b/.test(text)
  );
}

export function retrievalContext(question, history, isCurrentSource) {
  if (!isFollowUp(question)) return { topic: question, followUp: false, clarification: false };
  const answer = history.at(-1);
  const previous = history.at(-2);
  const valid =
    previous?.role === 'user' &&
    answer?.role === 'assistant' &&
    answer.status === 'complete' &&
    answer.content &&
    answer.sources?.length &&
    answer.sources.every(isCurrentSource);
  const topic = valid ? answer.retrievalTopic || previous.content : '';
  // Keep previous user input as bounded data, never as system instructions.
  const bounded = [...topic].slice(0, 160).join('');
  if (!bounded || isFollowUp(bounded)) return { topic: '', followUp: true, clarification: true };
  return { topic: bounded, followUp: true, clarification: false };
}
