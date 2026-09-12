# Próximas funcionalidades

Entregado: biblioteca local de documentos y notas por proyecto, recuerdos explícitos desde mensajes, edición y borrado, consulta entre chats con referencias, búsqueda por texto y tipo, copias completas de la biblioteca con restauración validada y migración del historial. Próximas ampliaciones: embeddings multilingües y propuestas de recuerdos revisables.

Ya están implementadas la consulta de texto y PDF por páginas, la administración de modelos/caché y la importación de conversaciones. La siguiente propuesta pendiente es editar preguntas.

## Entregado: importar copias de conversaciones

**Valor:** recuperar una conversación exportada o moverla a otro navegador.

**Alcance implementado:** importar JSON de conversación de versión 1, previsualizar el contenido, validar tamaño y esquema, asignar nuevos IDs y confirmar antes de guardar. Cada importación crea una copia independiente. Se conservan documentos y referencias, se reconstruyen fragmentos y se permite reintentar un guardado fallido.

**Límites:** 16 MB por archivo, 2.000 mensajes y 64 KB por mensaje; los documentos conservan sus límites de tamaño y páginas. La biblioteca se restaura por separado. Hay pruebas de JSON malicioso, cancelación, errores de guardado, IDs independientes y referencias de PDF.

## 2. Editar preguntas y crear versiones — esfuerzo medio

**Valor:** corregir una pregunta y comparar respuestas sin perder lo anterior.

**Alcance:** editar un mensaje del usuario crea una nueva rama de conversación, conservando la original y el documento asociado. Seleccionar una versión muestra qué contexto se utilizó.

**Commits sugeridos:**

1. `feat: add conversation branch model` — parentesco y copia de contexto anterior al mensaje editado.
2. `feat: edit prompts and switch conversation versions` — editor, navegación y generación.
3. `test: preserve original messages across branches` — persistencia, documentos y errores de inferencia.

**Terminado cuando:** editar no destruya la conversación original y cada versión pueda exportarse y eliminarse por separado.

## Entregadas: modelos y PDF

- Catálogo Llama 3.2 1B/3B, selección persistente, carga explícita, cancelación y liberación de GPU.
- Consulta y eliminación confirmada de caché por modelo, con estimación del almacenamiento del sitio.
- Extracción local en Worker de PDF con texto: 10 MB, 100 páginas, 512 KB extraídos y límite de 30 segundos.
- Vista del texto por página, filtro de consulta y referencias con número de página, conservadas en el historial y exportaciones.
- Pruebas de selección, conservación del historial, borrado de caché, PDF real, páginas vacías, archivos inválidos y límites.

Ampliaciones futuras: OCR, visor de la maquetación original y búsqueda semántica. La compatibilidad de GPU debe seguir validándose en los equipos objetivo, especialmente para el modelo 3B.
