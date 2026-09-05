import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Keep PDF fonts and character maps on our origin, including deployments in a subdirectory.
export function pdfAssetsPlugin() {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const assets = new Map();
  for (const folder of ['cmaps', 'standard_fonts']) {
    for (const name of readdirSync(join(root, folder))) {
      assets.set(`pdfjs/${folder}/${name}`, readFileSync(join(root, folder, name)));
    }
  }
  return {
    name: 'local-pdf-resources',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = assets.get((request.url || '').split('?')[0].replace(/^\//, ''));
        if (!source) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(source);
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
