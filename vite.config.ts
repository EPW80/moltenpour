import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // The app, and the certificate proof sheet used to verify print geometry.
        index: 'index.html',
        proof: 'proof.html',
      },
    },
  },
  server: {
    proxy: {
      // The Go API. Proxied in dev only. In production nothing proxies: the one
      // image serves the SPA and /api from the same Go process (see the
      // Dockerfile), which is what keeps the app free of a base-URL branch.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
