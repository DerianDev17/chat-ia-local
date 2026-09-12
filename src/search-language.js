// Small, inspectable vocabulary for local conceptual matching. This is synonym
// expansion, not an embedding model or a guarantee of semantic understanding.
export const normalizeSearch = (value) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const stopWords = new Set(
  'el la los las un una unos unas de del al a ante bajo con contra desde durante en entre hacia hasta para por segun sin sobre tras y e o u que cual cuales como cuando donde cuanto cuanta cuantos cuantas es son se su sus me mi mis tu tus lo le les este esta esto ese esa eso documento texto archivo dime explica explicar dice decir tiene the a an of to is are in on and what how document'.split(
    ' ',
  ),
);
const groups = [
  ['precio', 'precios', 'costo', 'costos', 'coste', 'importe', 'tarifa', 'price', 'cost', 'fee'],
  ['vence', 'vencimiento', 'caduca', 'caducidad', 'expira', 'deadline', 'expiry'],
  ['garantia', 'garantias', 'warranty', 'guarantee'],
  ['automovil', 'automoviles', 'coche', 'coches', 'auto', 'autos', 'car'],
  ['empleado', 'empleados', 'trabajador', 'trabajadores', 'personal', 'staff', 'employee'],
  ['comprar', 'compra', 'compras', 'adquirir', 'purchase', 'buy'],
  ['instalar', 'instalacion', 'installation', 'install'],
  ['correo', 'email', 'mail'],
  ['entrega', 'entregas', 'delivery'],
  ['reunion', 'reuniones', 'meeting'],
  ['vacacion', 'vacaciones', 'vacation', 'holiday'],
  ['contrasena', 'password'],
  ['contrato', 'contratos', 'contract'],
];
const concepts = new Map(groups.flatMap((group, index) => group.map((word) => [word, index])));
export function searchTerms(text) {
  return [...new Set(normalizeSearch(text).match(/[\p{L}\p{N}]{2,}/gu) || [])].filter(
    (word) => !stopWords.has(word),
  );
}
function matches(word, words) {
  return (
    words.has(word) ||
    (concepts.has(word) &&
      [...words].some((candidate) => concepts.get(candidate) === concepts.get(word)))
  );
}
export function matchesSearch(query, text) {
  const words = new Set(searchTerms(text));
  const terms = searchTerms(query);
  return terms.length
    ? terms.every((word) => matches(word, words))
    : normalizeSearch(text).includes(normalizeSearch(query).trim());
}
export function retrievalScore(query, text) {
  const words = new Set(searchTerms(text));
  return (
    searchTerms(query).reduce(
      (score, word) => score + (words.has(word) ? 1 : matches(word, words) ? 0.65 : 0),
      0,
    ) / Math.sqrt(words.size || 1)
  );
}
