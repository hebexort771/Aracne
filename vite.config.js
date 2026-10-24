import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 5000,
    rolldownOptions: {
      input: { lector: r('./lector.html'), overlay: r('./overlay.html') },
    },
  },
  server: { port: 5199, strictPort: true },
});
