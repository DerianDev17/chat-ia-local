import { defineConfig } from 'vite';
import { securityHeaders, securityPlugin } from './security.config.js';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  plugins: [securityPlugin()],
  server: { host: '127.0.0.1', headers: securityHeaders(true) },
  preview: { host: '127.0.0.1', headers: securityHeaders() },
});
