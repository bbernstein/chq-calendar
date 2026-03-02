import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
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
      },
    },
  },
  server: {
    port: 3000,
  },
});
