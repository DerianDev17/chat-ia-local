import { buildDocumentContext, documentFromPages } from '../src/documents.js';
import { buildKnowledgeContext, knowledgeNote } from '../src/knowledge.js';

const contract = documentFromPages({ name: 'contrato.pdf', size: 1000 }, [
  { page: 1, text: 'La garantía cubre reparaciones durante dos años.' },
  { page: 2, text: 'El contrato vence el 30 de junio y se entrega en formato digital.' },
  { page: 3, text: 'Las solicitudes se envían por correo electrónico.' },
]);
const notes = [
  knowledgeNote({
    title: 'Tarifas',
    text: 'El coste de instalación es de veinte euros.',
    project: 'Taller',
  }),
  knowledgeNote({ title: 'Horario', text: 'La reunión empieza a las nueve.', project: 'Taller' }),
  knowledgeNote({ title: 'Privado', text: 'El precio interno es confidencial.', project: 'Otro' }),
];

export const EVALUATION_CASES = [
  {
    id: 'document-exact',
    question: '¿Qué cubre la garantía?',
    run: () => buildDocumentContext('¿Qué cubre la garantía?', contract),
    expect: (context) => context.sources.some((source) => /dos años/.test(source.text)),
  },
  {
    id: 'document-synonym',
    question: '¿Cuál es el plazo?',
    run: () => buildDocumentContext('¿Cuál es el plazo?', contract),
    expect: (context) => context.sources.some((source) => source.page === 2),
  },
  {
    id: 'document-page-scope',
    question: '¿Por dónde se envían las solicitudes?',
    run: () => buildDocumentContext('¿Por dónde se envían las solicitudes?', contract, 1),
    expect: (context) => context.sources.length === 0,
  },
  {
    id: 'document-follow-up',
    question: '¿Y cuándo vence?',
    run: () => {
      const first = buildDocumentContext('Resume el contrato', contract);
      return buildDocumentContext('¿Y cuándo vence?', contract, null, {
        history: [
          { role: 'user', content: 'Resume el contrato' },
          {
            role: 'assistant',
            status: 'complete',
            content: 'Resumen [2]',
            sources: first.sources,
            retrievalTopic: first.topic,
          },
        ],
      });
    },
    expect: (context) =>
      context.followUp &&
      !context.clarification &&
      context.sources.some((source) => source.page === 2),
  },
  {
    id: 'knowledge-synonym-and-project',
    question: '¿Cuál es el precio de instalación?',
    run: () => buildKnowledgeContext('¿Cuál es el precio de instalación?', notes, 'Taller'),
    expect: (context) => context.sources.length === 1 && context.sources[0].name === 'Tarifas',
  },
  {
    id: 'knowledge-absent',
    question: '¿Cuál es la población de Marte?',
    run: () => buildKnowledgeContext('¿Cuál es la población de Marte?', notes, 'Taller'),
    expect: (context) => context.sources.length === 0,
  },
];

export function runEvaluationCases(cases = EVALUATION_CASES) {
  const results = cases.map((entry) => {
    const context = entry.run();
    return {
      id: entry.id,
      question: entry.question,
      passed: Boolean(entry.expect(context)),
      context,
    };
  });
  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    results,
  };
}
