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
  //
  // Codex Round 2 P2-9 — manualChunks splits heavy deps so the
  // entry chunk stays small. Targets:
  //   - markdown: react-markdown + remark + rehype (only loaded on
  //     a task with a streaming/terminal answer)
  //   - calendar: @fullcalendar/* (only loaded on /scheduled-calendar)
  //   - charts: recharts (only loaded on /admin/finance + /admin/learning)
  //   - radix: @radix-ui/* (shared across pages — keep as one chunk
  //     to avoid n^2 split overhead)
  //   - vendor: react + react-dom (long-cache; rarely changes)
  // Pre-existing vnc chunk stays in its dynamic-import wrapper; that's
  // a runtime split, not a build-time one.
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('mdast-') || id.includes('hast-') || id.includes('unist-')) {
            return 'markdown';
          }
          if (id.includes('@fullcalendar')) return 'calendar';
          if (id.includes('recharts') || id.includes('victory')) return 'charts';
          if (id.includes('@radix-ui')) return 'radix';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
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
