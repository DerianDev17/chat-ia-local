# Seguridad

## Alcance de las comprobaciones

La revisión local combina `pnpm security:audit`, pruebas de entradas maliciosas y comprobaciones de las políticas del navegador. Una auditoría sin avisos significa que el registro no reporta vulnerabilidades conocidas en el árbol instalado; no certifica que la aplicación esté libre de fallos.

## Controles aplicados

- DOMPurify sanea las respuestas con una lista reducida de elementos y atributos. Se excluyen scripts, formularios, imágenes, SVG y contenido embebido.
- Los enlaces del modelo solo admiten URLs absolutas HTTP/HTTPS. Se bloquean esquemas de aplicaciones externas y rutas relativas. Un enlace permitido aún puede apuntar a un sitio engañoso: su contenido no está verificado.
- Las páginas y Workers reciben una Content Security Policy en los servidores de desarrollo y vista previa. Permite scripts y Workers del mismo origen, compilación WebAssembly y conexiones a los orígenes de descarga del modelo. No habilita JavaScript `unsafe-eval` ni scripts inline.
- La producción incluye una CSP en HTML como respaldo y un archivo `dist/_headers` para servidores que lo interpretan, como Cloudflare Pages o Netlify. En otro alojamiento hay que configurar las cabeceras equivalentes de `security.config.js`, también para las respuestas del Worker.
- `frame-ancestors`, `X-Frame-Options` y `nosniff` requieren cabeceras HTTP: la etiqueta meta por sí sola no ofrece esas protecciones. La política también desactiva el envío de Referer y permisos innecesarios de cámara, micrófono, ubicación, pago y USB.
- El servidor de desarrollo escucha en `127.0.0.1`. No se debe exponer Vite como servidor de producción.

## Límites pendientes de validación

Los documentos locales se limitan a `.txt` y `.md` UTF-8, hasta 100 KB. Se rechazan archivos binarios y codificaciones inválidas, y las vistas previas y fuentes se muestran como texto, sin renderizar HTML. El modelo recibe fragmentos como datos separados de las instrucciones del sistema. Esto reduce la confusión entre contenido e instrucciones, pero no garantiza resistencia a prompt injection: un modelo puede seguir instrucciones maliciosas del documento o interpretar mal una fuente. No dispone de herramientas para ejecutar acciones.

Solo se generan controles de referencia para identificadores de fragmentos realmente suministrados. Retirar un documento borra el archivo y las copias de fragmentos guardadas en los mensajes; las respuestas existentes pueden contener citas del texto. Las exportaciones JSON incluyen el archivo adjunto completo y las exportaciones Markdown incluyen fragmentos consultados.

Las pruebas automatizadas de interfaz utilizan un motor simulado. La descarga completa y la inferencia WebGPU con la CSP deben verificarse en los navegadores objetivo. Si un proveedor cambia los dominios de descarga, revisa el bloqueo concreto antes de ampliar `connect-src`; no sustituyas la lista por un comodín general.

El almacenamiento local no tiene cifrado propio ni aislamiento frente a extensiones con permisos sobre la página o scripts del mismo origen. Los archivos de modelo y runtime externos siguen dependiendo de sus proveedores. Hay avisos de cambios entre pestañas del mismo origen mediante BroadcastChannel; no hay sincronización entre dispositivos ni backend de cuentas.

La búsqueda de biblioteca usa únicamente normalización, familias de palabras y un vocabulario fijo de equivalencias en el navegador. No envía consultas a servicios externos ni genera vectores remotos. Las puntuaciones ayudan a ordenar fragmentos, pero no demuestran que una respuesta sea correcta; la evaluación determinista de `tests/evaluation-cases.js` comprueba recuperación, ausencia de información y referencias conocidas.

La importación de conversaciones admite únicamente el esquema JSON de versión 1, UTF-8 y hasta 16 MB, con un máximo de 2.000 mensajes y 64 KB por mensaje. Reconstruye una lista explícita de campos, rechaza roles ajenos a usuario/asistente y no reutiliza IDs importados. Los fragmentos de documentos se recalculan desde texto validado; las vistas previas usan texto inerte y las respuestas mantienen el saneamiento de Markdown. Los fragmentos de biblioteca importados no apuntan a entradas locales existentes.

El modo de respuesta solo añade una instrucción de estilo al mensaje de sistema local. No cambia los límites de entrada, no concede herramientas al modelo y no convierte una respuesta detallada en una garantía de exactitud.

El borrado conserva marcadores mínimos (ID, tipo y fecha), sin mensajes, documentos ni títulos, para impedir que una generación tardía en otra pestaña restaure datos eliminados. Vaciar el historial también conserva estos marcadores. No se ofrece resolución completa de ediciones simultáneas; utiliza una pestaña por conversación.

## Comprobar después de un cambio

```sh
pnpm install --frozen-lockfile
pnpm security:audit
pnpm test
pnpm build
pnpm format:check
```

Revisa las cabeceras del documento y del Worker en el alojamiento real. El resultado de la auditoría depende de los avisos disponibles en ese momento.

## PDF y modelos

PDF.js se carga bajo demanda con un Worker del mismo origen. Los mapas de caracteres y fuentes se sirven localmente. Se desactivan evaluación dinámica, XFA, fuentes DOM y WebAssembly del parser; no se ejecutan acciones, anotaciones ni enlaces del PDF. Solo se guarda texto y se muestra con `textContent`. Se limitan archivo, páginas, texto y duración; esos límites no equivalen a una cuota estricta de memoria del proceso del navegador.

El selector usa una lista cerrada de identificadores. El borrado llama a `deleteModelAllInfoInCache` para un solo modelo y no elimina IndexedDB ni limpia globalmente todas las cachés. Los controles evitan cambiar el modelo durante carga, extracción, generación o mantenimiento de caché.
