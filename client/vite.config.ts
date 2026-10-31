import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../dist', import.meta.url));

export default defineConfig({
  root,
  // общий протокол лежит вне client/, Vite по умолчанию туда не пускает
  server: {
    host: true,
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8090', ws: true },
      '/api': { target: 'http://127.0.0.1:8090', changeOrigin: true },
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
