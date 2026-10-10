import fs from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import applicationConfig from '../vite.config';

const origin = process.env.HOLADAY_AUDIT_API_ORIGIN ?? 'https://holaday.ai';
if (!['https://holaday.ai', 'https://hd-app.orangebench.tech'].includes(origin)) {
  throw new Error('Audit API origin must be one of the two Holaday production sites.');
}

export default mergeConfig(applicationConfig, defineConfig({
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    // The public edge already expects /api. Do not inherit the dev proxy's rewrite.
    proxy: { '/api': {
      target: origin, changeOrigin: true,
      configure(proxy) {
        const file = process.env.HOLADAY_AUDIT_PROXY_DIAGNOSTICS;
        if (!file?.startsWith('/private/tmp/holaday-tasks/')) return;
        const started = new WeakMap<object, number>();
        let serial = 0;
        const record = (request: { url?: string }, phase: string, extra: Record<string, unknown> = {}) => {
          const route = (request.url ?? '').split('?')[0];
          fs.appendFileSync(file, JSON.stringify({ path: route, phase, elapsed: Date.now() - (started.get(request) ?? Date.now()), ...extra }) + '\n', { mode: 0o600 });
        };
        proxy.on('proxyReq', (outgoing, request) => {
          started.set(request, Date.now()); record(request, 'start', { id: ++serial });
          outgoing.on('socket', socket => {
            record(request, 'socket', { connecting: socket.connecting, reused: outgoing.reusedSocket });
            socket.once('lookup', error => record(request, 'lookup', { failed: Boolean(error) }));
            socket.once('connect', () => record(request, 'connect'));
            socket.once('secureConnect', () => record(request, 'tls'));
          });
          request.once('aborted', () => record(request, 'client-aborted'));
        });
        proxy.on('proxyRes', (response, request) => {
          record(request, 'headers', { status: response.statusCode });
          response.once('end', () => record(request, 'end', { complete: response.complete }));
        });
        proxy.on('error', (_error, request) => record(request, 'transport-error'));
      },
    } },
  },
}));
