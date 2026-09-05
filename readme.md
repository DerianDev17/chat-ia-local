# Local · Chat IA en tu navegador

Asistente en español para escribir, resumir y explicar textos. Ejecuta Llama 3.2 1B con WebLLM en un Web Worker. Las conversaciones se guardan en IndexedDB en el dispositivo.

## Ejecutar

Necesitas Node.js 22.12 o superior y npm.

```sh
npm ci
npm run dev
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
- Markdown saneado con DOMPurify. El contenido del modelo no puede insertar scripts, imágenes de seguimiento ni marcos externos.
- Aviso de fallos de almacenamiento y conservación de mensajes en memoria para poder exportarlos.
- Recuperación de respuestas interrumpidas al recargar y guardado periódico durante la generación.

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
npm test
npm run build
npm run preview
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
- `tests/`: pruebas funcionales y de integración con dependencias simuladas.

## Build y alojamiento

`npm run build` produce `dist/`, listo para alojamiento estático con HTTPS. `base: './'` y la URL del Worker relativa al módulo permiten servir la app bajo una subcarpeta. No se necesitan claves API ni backend.

El motor WebLLM se importa solo al cargar el modelo. Vite puede avisar del tamaño de su paquete (incluye el runtime); el chat inicial y el historial no necesitan descargar ese módulo. Los pesos del modelo no se incluyen en `dist/`.

Las dependencias directas están fijadas y `package-lock.json` permite instalaciones reproducibles.
