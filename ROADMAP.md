# Próximas funcionalidades

La primera consulta de documentos `.txt`/`.md` ya está implementada. Estas son propuestas para siguientes entregas; no forman parte de la implementación actual.

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

## 3. Administrar modelos y almacenamiento — esfuerzo medio

**Valor:** elegir entre velocidad y calidad, y controlar el espacio que ocupa la IA.

**Alcance:** catálogo pequeño de modelos compatibles con la versión fijada de WebLLM, requisitos orientativos, descarga explícita, cambio de modelo y eliminación de su caché. Cambiar el modelo no debe borrar conversaciones.

**Commits sugeridos:**

1. `feat: define supported model catalog and requirements` — identificadores, límites y persistencia del modelo elegido.
2. `feat: manage model downloads and cache` — progreso, cancelación, selección y eliminación confirmada.
3. `test: validate model switching and cache recovery` — fallos de memoria, descarga e interrupción.

**Terminado cuando:** dos modelos se puedan alternar en equipos compatibles sin mezclar operaciones ni perder historial. Requiere pruebas reales de GPU.

## 4. Consultar PDF con referencias a páginas — esfuerzo medio/alto

**Valor:** trabajar con manuales y documentos de uso cotidiano.

**Alcance:** extraer texto de PDF local en un Worker, conservar números de página y abrir las fuentes en la página correspondiente. Empezar por PDF con texto seleccionable; detectar y explicar cuándo un archivo escaneado necesita OCR.

**Commits sugeridos:**

1. `feat: extract bounded PDF text in a worker` — parser actualizado, límites de páginas, memoria y tiempo.
2. `feat: cite PDF pages in document answers` — fragmentos con página y visor de referencias.
3. `test: cover malformed encrypted and scanned PDFs` — errores controlados y regresiones de seguridad.

**Terminado cuando:** las referencias lleven a páginas correctas y los archivos incompatibles fallen sin bloquear la interfaz.

## Orden recomendado

Importar copias de seguridad → editar preguntas → administrar modelos → PDF. Antes de ampliar el alcance, validar la inferencia real, la CSP y la interfaz en navegadores y equipos objetivo.
