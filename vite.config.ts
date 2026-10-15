import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// mode "harness" builds the Cypress/dev harness into dist-harness/ (never shipped in the extension).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'harness' ? '/' : './',
  publicDir: mode === 'harness' ? false : 'public',
  build: {
    outDir: mode === 'harness' ? 'dist-harness' : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome116',
    modulePreload: false,
    rollupOptions: {
      input: (mode === 'harness'
        ? { harness: resolve(__dirname, 'harness.html') }
        : { popup: resolve(__dirname, 'popup.html'), sidepanel: resolve(__dirname, 'sidepanel.html') }) as Record<string, string>,
    },
  },
}));
