# Semilla Digital · Ideas que echan raíz

Asistente en español para escribir, resumir y explicar textos. Ejecuta Llama 3.2 1B o 3B con WebLLM en un Web Worker. Las conversaciones se guardan en IndexedDB en el dispositivo.

La identidad visual, los colores y los archivos de marca están en [BRAND.md](BRAND.md).

## Ejecutar

Necesitas Node.js 22.12 o superior y pnpm 9.10.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abre la dirección que imprime Vite. Pulsa **Cargar modelo** para iniciar la descarga y, al terminar, envía tu mensaje. También puedes preparar el texto mientras carga.

No abras `index.html` directamente con `file://`: los módulos, el Worker y WebGPU necesitan un servidor local o HTTPS.

## Funcionalidades

- Interfaz adaptable a escritorio y móvil, navegación por teclado y menú lateral plegable.
- Editor multilínea: Enter envía, Shift + Enter añade una línea; Alt + N abre una conversación.
- Detección de WebGPU antes de la descarga, progreso, cancelación y reintento de carga.
- Respuestas en streaming, detener, volver a generar y recuperación tras errores.
- Historial local persistente: buscar por título o contenido, abrir, renombrar y eliminar con confirmación.
- Copia de respuestas y exportación de conversaciones a Markdown o JSON.
- Importación de conversaciones JSON con vista previa, validación y guardado como copias independientes.
- Modos de respuesta por conversación: equilibrada, breve, detallada y paso a paso.
- Biblioteca y memoria entre chats con coincidencias exactas, familias de palabras y equivalencias conceptuales locales.
- Referencias que distinguen los recuerdos consultados de los recuerdos citados por cada respuesta.
- Markdown saneado con DOMPurify. El contenido del modelo no puede insertar scripts, imágenes de seguimiento ni marcos externos.
- Aviso de fallos de almacenamiento y conservación de mensajes en memoria para poder exportarlos.
- Recuperación de respuestas interrumpidas al recargar y guardado periódico durante la generación.

## Consultar un documento local

1. Pulsa **＋ Documento** y selecciona un `.txt` o `.md` de hasta 100 KB, codificado en UTF-8, o un `.pdf` de hasta 10 MB y 100 páginas.
2. Revisa la vista previa y pulsa **Usar documento**. Se guarda junto a la conversación, incluso si todavía no hay mensajes.
3. Con el modelo cargado, haz una pregunta concreta. La búsqueda selecciona hasta tres fragmentos por coincidencia exacta, familia de palabras o equivalencia conceptual local, sin enviar el archivo a un servidor.
4. Pulsa una referencia como `[1]` o un botón de **Fragmentos consultados** para ver el texto original. Una referencia que el modelo invente no se convierte en botón.
5. Desmarca **Responder con este documento** para volver al chat general. **Retirar** borra el documento y sus fragmentos guardados tras una confirmación; los mensajes ya escritos pueden contener citas y se conservan. Elimina la conversación para borrarlos también.

Si no hay coincidencias, la aplicación lo indica sin ejecutar inferencia. La búsqueda reconoce un vocabulario pequeño de equivalencias y familias frecuentes; no usa embeddings ni pretende comprender cualquier paráfrasis. Las preguntas de seguimiento como «¿y eso?» aprovechan los turnos recientes cuando hay una consulta previa clara. Los resúmenes de documentos grandes son parciales y la interfaz lo advierte. Las referencias identifican material consultado, no certifican que la respuesta sea correcta.

La exportación JSON incluye el texto extraído y sus páginas mientras el documento esté adjunto. No se conserva ni exporta el PDF binario, sus imágenes o su maquetación. Markdown incluye los fragmentos consultados en cada respuesta. Ambos archivos pueden contener información privada.

## Biblioteca y memoria entre chats

1. Abre **Biblioteca y memoria** en el menú lateral. Escribe un proyecto (por defecto **General**) y añade una nota o importa un archivo `.txt`, `.md` o `.pdf`. Revisa el texto antes de guardarlo.
2. En un chat, pulsa **Recordar esto** bajo un mensaje. Revisa o corrige su contenido, elige el proyecto y pulsa **Guardar recuerdo**. Las respuestas del asistente no se guardan automáticamente como hechos.
3. En otra conversación, selecciona el mismo **Proyecto** y activa **Usar biblioteca y memoria**. La búsqueda selecciona hasta tres fragmentos relevantes por coincidencia exacta, familia de palabras o equivalencia conceptual y muestra referencias con su título y página, o el chat de origen del recuerdo. Sobre la respuesta se indica qué recuerdos se citaron y cuántos fragmentos se consultaron. Los turnos recientes completos se incluyen cuando caben en el contexto.
4. Usa **Ver / editar** para corregir notas o recuerdos, y **Olvidar** para eliminarlos tras confirmar. Los documentos permiten revisar el texto y cambiar su título o proyecto. Para reemplazar su contenido, elimina la entrada e importa la nueva versión.

Los proyectos se identifican por nombre, ignorando mayúsculas y espacios de los extremos. No se consulta la biblioteca de otros proyectos. Un documento adjunto con **Responder con este documento** activo tiene prioridad sobre la biblioteca. Si no hay coincidencias, la app lo indica sin ejecutar el modelo; puedes reformular o desactivar la consulta.

En la barra inferior puedes elegir el modo de respuesta: **Equilibrada**, **Breve**, **Detallada** o **Paso a paso**. La selección se guarda con cada conversación y se aplica también a consultas de documentos y biblioteca. El modo orienta la extensión y la estructura; no garantiza una longitud exacta ni sustituye revisar la respuesta.

Se conservan los límites de archivos existentes y se admiten hasta 100 entradas en la biblioteca. Los datos permanecen en IndexedDB, con migración del historial anterior. Borrar un chat elimina sus recuerdos derivados; borrar todo el historial conserva las notas y documentos independientes. Las respuestas y exportaciones anteriores pueden conservar citas del contenido eliminado. Las exportaciones de conversación incluyen los fragmentos consultados, no una copia completa de la biblioteca.

Esta versión recuerda información explícita y busca con reglas locales de coincidencia: no reentrena el modelo, no genera recuerdos automáticamente y no incluye embeddings. Borrar los datos del navegador elimina también la biblioteca.

### Medir la calidad de la recuperación

Ejecuta `pnpm test:evaluation` para comprobar un conjunto determinista de preguntas sobre documentos y recuerdos. Incluye coincidencias exactas y conceptuales, preguntas de seguimiento, límites por página, preguntas sin respuesta y validación de citas. La salida muestra los casos aprobados; `pnpm test` también incluye estas comprobaciones.

### Buscar y respaldar la biblioteca

En **Contenido del proyecto**, busca por título o texto y filtra por documentos, notas o recuerdos. La búsqueda ignora mayúsculas y tildes y muestra el número de coincidencias dentro del proyecto seleccionado.

**Exportar biblioteca** descarga `semilla-biblioteca.json` con todos los proyectos, incluso si hay un filtro activo. Incluye el texto de los documentos, las páginas extraídas de PDF, las notas y los recuerdos; no incluye los chats completos ni el PDF binario. La copia puede contener información privada y no está cifrada.

Para restaurarla en otro navegador, usa **Importar copia JSON**, revisa las entradas y pulsa **Confirmar importación**. Se valida el archivo (hasta 64 MB), se reconstruyen los fragmentos y se asignan IDs nuevos. Se omiten entradas del mismo tipo, proyecto y contenido (con las mismas páginas en PDF), sin sobrescribir las existentes. Si falla el guardado o se superan las 100 entradas, no se importa ninguna.

Los recuerdos importados conservan el título y el rol de su origen como referencia, pero son independientes de los chats locales. Para eliminarlos usa **Olvidar** en la biblioteca. Un JSON exportado desde las opciones de una conversación tiene otro formato y no se importa desde este panel.

## Importar una conversación

Pulsa **Importar conversación** en el menú lateral y elige un JSON exportado desde las opciones de un chat (versión 1). Revisa el título, el documento y la vista previa de mensajes; pulsa **Guardar copia** para restaurarlo. Cancelar o seleccionar un archivo inválido no modifica el historial. No hace falta cargar el modelo.

Se admiten archivos UTF-8 de hasta 16 MB, 2.000 mensajes y 64 KB por mensaje, con los límites habituales para documentos. Se conservan mensajes, estados, proyecto, texto del documento, páginas de PDF y referencias. Los fragmentos se reconstruyen a partir del texto validado y las respuestas que estaban generándose quedan interrumpidas. Cada importación crea IDs nuevos y puede repetirse sin sobrescribir conversaciones. Si el guardado falla, la vista previa permanece abierta para reintentarlo.

Los fragmentos de biblioteca conservan su texto y el título del origen como referencias históricas; no restauran la biblioteca ni se vinculan a los recuerdos locales existentes. Para recuperar las entradas completas usa la importación de **Biblioteca y memoria**.

## Duplicar una conversación

Abre **Opciones de conversación (•••)** y pulsa **Duplicar conversación** para continuar en una copia independiente. Conserva los mensajes, el modelo registrado, el documento, la página seleccionada y las referencias. La original permanece en el historial; cada copia puede renombrarse, exportarse y eliminarse por separado. El borrador sin enviar permanece en la original.

La copia se abre después de guardarse en el navegador. No requiere cargar el modelo y no está disponible mientras se genera una respuesta o se adjunta un documento.

## Editar preguntas y crear versiones

Pulsa **Editar en una versión** bajo cualquier pregunta, corrige el texto y pulsa **Crear versión**. Se conserva la conversación original y se guarda una copia con los intercambios anteriores a esa pregunta y la nueva pregunta. Las respuestas y preguntas posteriores permanecen en la original.

La versión copia el documento adjunto y usa la configuración actual de documento, página o biblioteca indicada en el editor. Si el modelo está cargado, genera la respuesta después de guardar; si no, puedes usar **Reintentar** más tarde. Un error de almacenamiento mantiene abierta la edición; un error de inferencia conserva la versión para reintentarlo.

Cada versión muestra su origen y la configuración al crearla. **Ver conversación original** vuelve al chat de origen mientras exista; el historial permite cambiar entre versiones. Puedes exportar o eliminar cada una por separado. Exportar a JSON y restaurar conserva la descripción del origen, sin enlazarla a chats locales existentes.

## PDF por páginas

La vista previa permite recorrer el texto de cada página. En el documento adjunto, **Consultar** permite elegir todas las páginas o una concreta; la selección se conserva al recargar. Las fuentes muestran su página original y permiten desplegar el texto completo de esa página. Las páginas sin texto conservan su número.

Se limita la extracción a 30 segundos y 512 KB de texto. Los PDF protegidos, dañados o sin texto extraíble muestran un error. Los escaneados necesitan OCR externo; esta versión no incluye OCR, imágenes ni visor de la maquetación original. Tablas y documentos con columnas pueden perder su orden visual. Revisa siempre el texto extraído.

## Administrar modelos y caché

Pulsa el nombre del modelo junto al botón de enviar para abrir **Modelos y caché**. Puedes elegir Llama 3.2 1B (GPU estimada: 1,2 GB) o 3B (3 GB), liberar la memoria de la GPU y borrar las descargas del modelo seleccionado tras confirmar. Cambiar el modelo libera el anterior y requiere pulsar **Cargar modelo**. Se conserva el historial y cada nueva respuesta registra el identificador del modelo usado.

El panel informa de la caché detectada y, si el navegador lo permite, el espacio usado por todo el sitio. Esas cifras incluyen documentos e historial: no son el tamaño de descarga ni la memoria GPU. La caché detectada no garantiza que todos los archivos estén completos; la carga los comprueba. La eliminación se limita a las APIs de caché del modelo de WebLLM.

Referencias técnicas: [PDF.js](https://mozilla.github.io/pdf.js/api/draft/api.js.html) y [caché de WebLLM](https://webllm.mlc.ai/docs/user/advanced_usage.html).

## Modelo, privacidad y límites

- Modelo predeterminado: `Llama-3.2-1B-Instruct-q4f32_1-MLC`, fijado en `src/conversations.js`. Se ha elegido un modelo menor que el 8B original para reducir los requisitos. La calidad y velocidad dependen del modelo y del equipo.
- Hace falta WebGPU, aceleración de hardware y memoria suficiente. El catálogo de WebLLM estima unos 1.1 GB de VRAM para este modelo; esa estimación no garantiza compatibilidad ni representa el tamaño de descarga.
- El modelo se descarga desde Hugging Face y su biblioteca desde la infraestructura de MLC. WebLLM reutiliza la caché del navegador. La aplicación no envía el texto del chat a un servidor de inferencia.
- Las conversaciones no se sincronizan ni están cifradas por la aplicación. Se guardan por origen y perfil del navegador. Borrar los datos del sitio elimina el historial. Exporta los datos que quieras conservar.
- La app no es todavía una PWA y no garantiza funcionamiento totalmente sin conexión.
- Contexto de 4096 tokens, con respuestas de hasta 512 tokens. Se limita la entrada mediante un presupuesto conservador de bytes UTF-8 y se incluyen pares completos de turnos recientes. Las respuestas fallidas o parciales se excluyen del contexto, pero se conservan en el historial visible.
- Si el modelo deja de responder se libera el Worker para poder recargar. Detener intenta conservar el modelo cargado; si no responde en cinco segundos, se termina el Worker.
- Las conversaciones se restauran empezando por la modificada más recientemente. Durante una generación se bloquea el cambio de conversación para evitar mezclar mensajes.
- El guardado no coordina ediciones simultáneas de la misma conversación en varias pestañas; utiliza una pestaña por conversación.

## Comprobaciones

```sh
pnpm test
pnpm build
pnpm preview
```

Las pruebas usan `node:test`, JSDOM e IndexedDB simulado. Cubren persistencia, recarga, validación, contexto, errores, reintentos, cancelación de respuesta, borrado confirmado y saneamiento de Markdown. El motor se sustituye por un doble controlado en las pruebas de interfaz: no descargan pesos ni certifican inferencia real en una GPU.

Antes de publicar para otros usuarios, comprueba la carga y una respuesta real en los equipos objetivo, el diseño a diferentes tamaños y el comportamiento con memoria o conexión limitadas.

## Estructura

- `index.html` / `style.css`: interfaz, diseño adaptable y diálogos accesibles.
- `script.js`: arranque.
- `src/app.js`: interacciones y estados de la interfaz.
- `src/engine.js` / `worker.js`: carga, inferencia, interrupción y recuperación del motor.
- `src/storage.js`: transacciones de IndexedDB y cola de escrituras.
- `src/conversations.js`: mensajes, contexto y exportación Markdown.
- `src/markdown.js`: renderizado y saneamiento.
- `src/documents.js`: lectura de texto, fragmentación, búsqueda local y selección de referencias.
- `tests/`: pruebas funcionales y de integración con dependencias simuladas.

## Build y alojamiento

`pnpm build` produce `dist/`, listo para alojamiento estático con HTTPS. `base: './'` y la URL del Worker relativa al módulo permiten servir la app bajo una subcarpeta. No se necesitan claves API ni backend.

El motor WebLLM se importa solo al cargar el modelo. Vite puede avisar del tamaño de su paquete (incluye el runtime); el chat inicial y el historial no necesitan descargar ese módulo. Los pesos del modelo no se incluyen en `dist/`.

Las dependencias directas están fijadas y `pnpm-lock.yaml` permite instalaciones reproducibles.

Las próximas funcionalidades propuestas y su división en commits están en [ROADMAP.md](ROADMAP.md).
