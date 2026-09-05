// Keep this list tied to the pinned model/runtime's download origins.
const modelOrigins = [
  'https://huggingface.co',
  'https://*.huggingface.co',
  'https://*.hf.co',
  'https://raw.githubusercontent.com',
];

export function contentSecurityPolicy({ development = false, meta = false } = {}) {
  const connections = ["'self'", ...modelOrigins];
  if (development) connections.push('ws://127.0.0.1:*', 'ws://localhost:*');
  return [
    "default-src 'self'",
    // WebLLM compiles WebAssembly. Do not allow general JavaScript unsafe-eval.
    "script-src 'self' 'wasm-unsafe-eval'",
    // Vite HMR injects styles, and the composer adjusts its height dynamically.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connections.join(' ')}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    // Browsers only honor frame-ancestors in a response header.
    ...(!meta ? ["frame-ancestors 'none'"] : []),
  ].join('; ');
}

export function securityHeaders(development = false) {
  return {
    'Content-Security-Policy': contentSecurityPolicy({ development }),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
}

export function securityPlugin() {
  return {
    name: 'local-security',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: contentSecurityPolicy({ development: !!context.server, meta: true }),
            },
            injectTo: 'head-prepend',
          },
          {
            tag: 'meta',
            attrs: { name: 'referrer', content: 'no-referrer' },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
    generateBundle() {
      // Cloudflare Pages and Netlify consume this file. Other static servers
      // must set equivalent response headers; the HTML meta CSP is a fallback.
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source:
          '/*\n' +
          Object.entries(securityHeaders())
            .map(([name, value]) => `  ${name}: ${value}\n`)
            .join(''),
      });
    },
  };
}
