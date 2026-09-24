import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// SURAKSHA dev server config.
// host: true            -> binds 0.0.0.0 so the sandbox live-preview proxy can reach it
// allowedHosts: true     -> the preview is served from a proxied *.e2b.app host
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
});
