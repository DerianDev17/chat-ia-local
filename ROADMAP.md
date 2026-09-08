# Próximas funcionalidades

Entregado: biblioteca local de documentos y notas por proyecto, recuerdos explícitos desde mensajes, edición y borrado, consulta entre chats con referencias, búsqueda por texto y tipo, copias completas de la biblioteca con restauración validada y migración del historial. Próximas ampliaciones: embeddings multilingües y propuestas de recuerdos revisables.

Ya están implementadas la consulta de texto y PDF por páginas y la administración de modelos/caché. Las siguientes propuestas pendientes son importar copias de conversaciones y editar preguntas.

## 1. Importar copias de seguridad — esfuerzo bajo/medio

**Valor:** recuperar una conversación exportada o moverla a otro navegador.

**Alcance:** importar el JSON exportado por Local, previsualizar el contenido, validar tamaño y esquema, asignar nuevos IDs y pedir confirmación antes de guardar. No sobrescribir conversaciones existentes por defecto.

**Commits sugeridos:**

1. `feat: validate versioned conversation backups` — validación de esquema, límites y migraciones.
2. `feat: preview and import local backups` — selector, vista previa, guardado con IDs nuevos.
3. `test: cover malformed backups and document round trips` — JSON malicioso, duplicados y documentos con referencias.

**Terminado cuando:** un JSON exportado se restaure conservando mensajes, documento y referencias; un archivo inválido no modifique el historial.

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
