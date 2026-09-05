import { MODEL_ID } from './conversations.js';

export const MODELS = [
  {
    id: MODEL_ID,
    name: 'Llama 3.2 · 1B',
    detail: 'Ágil para tareas cortas · GPU estimada: 1,2 GB',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
    name: 'Llama 3.2 · 3B',
    detail: 'Mayor capacidad · GPU estimada: 3 GB',
  },
];
export function getModel(id) {
  const model = MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error('Modelo no permitido.');
  return model;
}
export const modelCache = {
  async status(id) {
    getModel(id);
    const api = await import('@mlc-ai/web-llm');
    return api.hasModelInCache(id);
  },
  async remove(id) {
    getModel(id);
    const api = await import('@mlc-ai/web-llm');
    await api.deleteModelAllInfoInCache(id);
  },
};
