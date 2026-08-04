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
      // The Go API. Proxied so the app talks to a same-origin path in dev and in
      // production alike, and never needs a base-URL branch.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
