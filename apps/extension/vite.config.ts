import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.config.js';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // Disable Vite's modulePreload helper. It's useless for an extension
    // (chunks load from chrome-extension:// local disk, zero preload win)
    // and actively harmful in a Service Worker context: the helper's
    // `__vitePreload` wrapper around dynamic imports touches `document`
    // and `window.dispatchEvent`, neither of which exists in an MV3 SW.
    // With it on, the real error from any dynamic import rejection is
    // masked by a synthetic `ReferenceError: window is not defined`.
    modulePreload: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 },
  },
});
