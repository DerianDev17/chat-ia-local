import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, retrievalScore } from '../src/search-language.js';
import { buildKnowledgeContext, knowledgeNote, searchKnowledge } from '../src/knowledge.js';

test('local conceptual search recognizes common synonyms and multilingual terms', () => {
  assert.equal(matchesSearch('precio', 'El coste es de veinte euros.'), true);
  assert.equal(matchesSearch('automóvil', 'El coche necesita mantenimiento.'), true);
  assert.equal(matchesSearch('warranty', 'La garantía cubre dos años.'), true);
  assert.ok(retrievalScore('precio', 'precio') > retrievalScore('precio', 'coste'));
  assert.equal(retrievalScore('astronomía', 'La garantía cubre dos años.'), 0);
  assert.equal(matchesSearch('instalaciones', 'Instalar dependencias con pnpm.'), true);
  assert.equal(matchesSearch('duración', 'El contrato tiene un periodo de doce meses.'), true);
  assert.equal(matchesSearch('anular', 'Puedes cancelar la reserva.'), true);
});

test('synonym retrieval keeps the project boundary and returns inspectable memory sources', () => {
  const entry = knowledgeNote({
    title: 'Tarifas',
    text: 'El coste es de veinte euros.',
    project: 'Taller',
  });
  const secret = knowledgeNote({
    title: 'Precio privado',
    text: 'El precio es cien euros.',
    project: 'Otro',
  });
  assert.equal(searchKnowledge([entry], 'precio').length, 1);
  assert.equal(searchKnowledge([entry], 'precio inexistente').length, 0);
  assert.equal(searchKnowledge([entry], 'precio', 'document').length, 0);
  const context = buildKnowledgeContext('¿Cuál es el precio?', [entry, secret], 'Taller');
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].knowledgeId, entry.id);
  assert.equal(context.sources[0].name, 'Tarifas');
  assert.match(context.sources[0].text, /veinte/);
});
