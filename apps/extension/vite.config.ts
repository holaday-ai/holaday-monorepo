import { fileURLToPath } from 'node:url';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.config.js';

// MV3 Service Workers forbid dynamic `import()` at runtime, so the
// crx-adapter has to be statically imported and bundled into the SW.
// That means in a `VITE_BROWSER_DRIVER=mock` build we'd otherwise drag
// in the 3MB playwright-crx bundle we don't need. Swap the package
// subpath for a stub in mock builds so the mock bundle stays lean.
const driverMode = process.env.VITE_BROWSER_DRIVER;
const aliasCrxToStub: Record<string, string> =
  driverMode === 'mock'
    ? {
        '@holaday/browser-driver/crx': fileURLToPath(
          new URL('./src/background/crx-adapter-mock-shim.ts', import.meta.url),
        ),
      }
    : {};

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: aliasCrxToStub,
  },
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
