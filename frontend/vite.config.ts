import { defineConfig, PluginOption } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { existsSync } from 'fs';

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
  plugins: [devServerMiddleware(), preact()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'out',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        feedback: resolve(__dirname, 'feedback/index.html'),
        'admin-login': resolve(__dirname, 'admin/login/index.html'),
        'admin-feedback': resolve(__dirname, 'admin/feedback/index.html'),
        'admin-publishers': resolve(__dirname, 'admin/publishers/index.html'),
        'admin-publisher-events': resolve(__dirname, 'admin/publisher-events/index.html'),
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
