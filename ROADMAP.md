# Próximas funcionalidades

Entregado: biblioteca local de documentos y notas por proyecto, recuerdos explícitos desde mensajes, edición y borrado, consulta entre chats con referencias, búsqueda por texto y tipo, coincidencias conceptuales locales, indicación de recuerdos consultados y citados, copias completas de la biblioteca con restauración validada y migración del historial. Próximas ampliaciones: embeddings multilingües y propuestas de recuerdos revisables.

Ya están implementadas la consulta de texto y PDF por páginas, la administración de modelos/caché, la importación de conversaciones, la edición de preguntas en versiones independientes y los modos de respuesta configurables.

## Entregado: importar copias de conversaciones

**Valor:** recuperar una conversación exportada o moverla a otro navegador.

**Alcance implementado:** importar JSON de conversación de versión 1, previsualizar el contenido, validar tamaño y esquema, asignar nuevos IDs y confirmar antes de guardar. Cada importación crea una copia independiente. Se conservan documentos y referencias, se reconstruyen fragmentos y se permite reintentar un guardado fallido.

**Límites:** 16 MB por archivo, 2.000 mensajes y 64 KB por mensaje; los documentos conservan sus límites de tamaño y páginas. La biblioteca se restaura por separado. Hay pruebas de JSON malicioso, cancelación, errores de guardado, IDs independientes y referencias de PDF.

## Entregado: editar preguntas y crear versiones

**Valor:** corregir una pregunta y comparar respuestas sin perder lo anterior.

**Alcance implementado:** editar una pregunta crea una versión con los intercambios anteriores y la pregunta corregida, conservando la original. Copia el documento y las preferencias actuales, muestra la configuración utilizada al crear y permite volver al chat de origen. Guarda antes de generar y permite reintentar sin perder la edición.

**Verificación:** cada versión puede exportarse y eliminarse por separado. Las pruebas cubren conservación de la original, recarga, documentos y referencias independientes, errores de guardado, fallos de inferencia y restauración JSON del origen descriptivo.

## Entregadas: modelos y PDF

- Catálogo Llama 3.2 1B/3B, selección persistente, carga explícita, cancelación y liberación de GPU.
- Consulta y eliminación confirmada de caché por modelo, con estimación del almacenamiento del sitio.
- Extracción local en Worker de PDF con texto: 10 MB, 100 páginas, 512 KB extraídos y límite de 30 segundos.
- Vista del texto por página, filtro de consulta y referencias con número de página, conservadas en el historial y exportaciones.
- Pruebas de selección, conservación del historial, borrado de caché, PDF real, páginas vacías, archivos inválidos y límites.

Ampliaciones futuras: OCR, visor de la maquetación original y embeddings multilingües para cubrir paráfrasis fuera del vocabulario local. La compatibilidad de GPU debe seguir validándose en los equipos objetivo, especialmente para el modelo 3B.

## Entregado: evaluación de recuperación y citas

El conjunto determinista de `tests/evaluation-cases.js` cubre preguntas exactas y conceptuales, seguimiento con historial, alcance por página, ausencia de información y citas válidas o inventadas. Ejecuta `pnpm test:evaluation` para obtener el resultado resumido antes de cambiar el recuperador.
