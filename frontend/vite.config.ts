import { defineConfig, PluginOption } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { buildSitemapXml, PUBLIC_PATHS } from './src/lib/sitemap';

// In MPA mode, Vite doesn't resolve bare paths like /feedback to /feedback/index.html.
// This plugin adds that behavior so dev matches production (S3/CloudFront).
// Also mocks POST /api/feedback so CAPTCHA isn't required in local dev.
function devServerMiddleware(): PluginOption {
  return {
    name: 'dev-server-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Mock feedback endpoint — skip CAPTCHA in local dev
        if (req.url === '/api/feedback' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const { feedback } = JSON.parse(body);
              if (!feedback?.trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Feedback is required' }));
                return;
              }
              console.log('[dev] Feedback received:', feedback.substring(0, 80));
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Feedback submitted (dev mode)' }));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
          });
          return;
        }

        // Rewrite bare paths to their index.html (e.g. /feedback → /feedback/)
        if (req.url) {
          const urlPath = req.url.split('?')[0];
          if (!urlPath.endsWith('/') && !urlPath.includes('.')) {
            const indexPath = resolve(__dirname, urlPath.slice(1), 'index.html');
            if (existsSync(indexPath)) {
              req.url = urlPath + '/' + req.url.slice(urlPath.length);
            }
          }
        }
        next();
      });
    },
  };
}

// Build version stamp: short git SHA of the deployed commit, or a timestamp
// fallback for environments without git. Baked into the bundle via `define`
// and emitted as version.json so the client can detect new deploys.
function resolveAppVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

// Emits out/version.json at build time with the same value baked into the bundle.
function emitVersionJson(version: string): PluginOption {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      });
    },
  };
}

// Emits out/sitemap.xml at build time from the canonical public route list.
function emitSitemapXml(): PluginOption {
  return {
    name: 'emit-sitemap-xml',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(PUBLIC_PATHS),
      });
    },
  };
}

const APP_VERSION = resolveAppVersion();

// Proxy config shared between dev server and preview server.
// Routes API/auth requests to the local backend (port 3001) and
// cache requests to the production CDN.
// NOTE: In dev mode, POST /api/feedback is intercepted by devServerMiddleware
// (CAPTCHA-free mock) and never reaches the proxy. The backend route is only
// proxied in preview mode or when using VITE_API_URL for direct access.
const backendProxy = {
  '/auth': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/admin/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/cache': {
    target: 'https://www.chqcal.org',
    changeOrigin: true,
  },
};

export default defineConfig({
  appType: 'mpa',
  plugins: [devServerMiddleware(), preact(), emitVersionJson(APP_VERSION), emitSitemapXml()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: 'out',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        feedback: resolve(__dirname, 'feedback/index.html'),
        privacy: resolve(__dirname, 'privacy/index.html'),
        support: resolve(__dirname, 'support/index.html'),
        'admin-login': resolve(__dirname, 'admin/login/index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
        'admin-feedback': resolve(__dirname, 'admin/feedback/index.html'),
        'admin-publishers': resolve(__dirname, 'admin/publishers/index.html'),
        'admin-publisher-events': resolve(__dirname, 'admin/publisher-events/index.html'),
        publish: resolve(__dirname, 'publish/index.html'),
        'publish-test': resolve(__dirname, 'publish/test/index.html'),
        'publish-apply': resolve(__dirname, 'publish/apply/index.html'),
        'publish-docs': resolve(__dirname, 'publish/docs/index.html'),
        'publish-verify': resolve(__dirname, 'publish/verify/index.html'),
        'publish-login': resolve(__dirname, 'publish/login/index.html'),
        'publish-status': resolve(__dirname, 'publish/status/index.html'),
        'publish-email-change-verify': resolve(__dirname, 'publish/email-change/verify/index.html'),
        'publish-email-change-cancel': resolve(__dirname, 'publish/email-change/cancel/index.html'),
      },
    },
  },
  server: {
    port: 3000,
    watch: {
      usePolling: true,
    },
    proxy: backendProxy,
  },
  preview: {
    port: 3000,
    proxy: backendProxy,
  },
});
