import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds one self-contained HTML file with no external requests, for hosts that
 * can only serve a single document (and for opening straight off a USB stick on
 * a locked-down machine). Dynamic imports are inlined so there are no sibling
 * chunks to fetch.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-single',
    target: 'esnext',
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
