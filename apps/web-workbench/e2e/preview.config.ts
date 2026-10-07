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
    proxy: { '/api': { target: origin, changeOrigin: true } },
  },
}));
