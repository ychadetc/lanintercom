
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const certPath = (filename: string) =>
  fileURLToPath(new URL(`../certs/${filename}`, import.meta.url));

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',

    https: {
      key: readFileSync(certPath('lan-voice-key.pem')),
      cert: readFileSync(certPath('lan-voice.pem')),
    },

    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },

      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
