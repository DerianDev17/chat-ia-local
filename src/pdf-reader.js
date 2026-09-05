export async function extractPdfPages(buffer, getDocument, resources = {}) {
  const task = getDocument({
    ...resources,
    useWasm: false,
    disableFontFace: true,
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
  });
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const pdf = await task.promise;
        if (pdf.numPages > 100) throw new Error('El PDF supera el límite de 100 páginas.');
        const pages = [];
        let length = 0;
        for (let page = 1; page <= pdf.numPages; page++) {
          const proxy = await pdf.getPage(page);
          const content = await proxy.getTextContent();
          const text = content.items
            .map((item) => (item.str ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('')
            .trim();
          length += new TextEncoder().encode(text).length;
          if (length > 512 * 1024)
            throw new Error('El texto del PDF supera los 512 KB. Divide el documento.');
          pages.push({ page, text });
          proxy.cleanup();
        }
        if (!pages.some((page) => page.text))
          throw new Error(
            'El PDF no contiene texto extraíble. Los documentos escaneados necesitan OCR.',
          );
        return pages;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('La lectura del PDF tardó demasiado. Prueba un archivo más pequeño.')),
          30000,
        );
      }),
    ]);
  } catch (error) {
    if (error.name === 'PasswordException')
      throw new Error('El PDF está protegido. Adjunta una copia sin contraseña.');
    if (error.name === 'InvalidPDFException') throw new Error('El PDF está dañado o no es válido.');
    throw error;
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
