import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server config for the Web Workbench.
// Port 5173 is Vite's default; keeping it so README / muscle memory stays
// consistent. /api and /ws are proxied to the orchestrator so the frontend
// can talk to it with same-origin URLs — no CORS wrangling, no env var
// plumbing for localhost.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // @novnc/novnc ships CJS with a top-level await in lib/util/browser.js
  // (WebCodecs H.264 capability detection). Rollup's CJS resolver
  // rejects that at static-import time, so VncViewport loads noVNC via
  // a dynamic `import()`. Keeping build.target at esnext + pre-
  // bundling via esbuild ensures the TLA survives the pipeline.
  build: {
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['@novnc/novnc/lib/rfb'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // tRPC + REST land. `/api/...` → `http://127.0.0.1:3001/...`
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (pathname) => pathname.replace(/^\/api/, ''),
      },
      // WS upgrade. `ws://.../ws` → `ws://127.0.0.1:3002`.
      '/ws': {
        target: 'ws://127.0.0.1:3002',
        ws: true,
        rewriteWsOrigin: true,
        changeOrigin: true,
        rewrite: (pathname) => pathname.replace(/^\/ws/, ''),
      },
    },
  },
});
