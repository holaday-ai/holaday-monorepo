import { test, expect } from 'playwright/test';
import { allowRequest, decideControl, registerReadOnlyGuard, routePatterns, type Control } from './audit-policy';

const base = 'http://127.0.0.1:4173';
const control: Control = { key: '1', selector: 'button', label: '', tag: 'button', role: '', href: null, type: 'button', expanded: null, disabled: false, hasReason: false };

test('live audit denies mutations, unknown API reads, external requests and unsafe schemes', () => {
  const reads = new Set(['tasks.list', 'auth.me']);
  expect(allowRequest('GET', new URL('/api/trpc/tasks.list,auth.me?batch=1', base), base, reads)).toBe(true);
  for (const [method, endpoint] of [['POST', '/api/trpc/tasks.create'], ['DELETE', '/api/files/x'], ['GET', '/api/trpc/admin.runSelfCheck'], ['GET', '/api/trpc/tasks.list,tasks.create'], ['GET', '/api/auth/logout'], ['GET', 'https://other.example/api/trpc/tasks.list']]) {
    expect(allowRequest(method, new URL(endpoint, base), base, reads)).toBe(false);
  }
  expect(decideControl({ ...control, label: '确认删除', expanded: 'false' })).toBe('final-action');
  expect(decideControl({ ...control, label: '发送通知' })).toBe('final-action');
  expect(decideControl({ ...control, label: '神秘按钮' })).toBe('unreviewed');
  expect(decideControl({ ...control, href: 'javascript:alert(1)' })).toBe('unreviewed');
  expect(decideControl({ ...control, label: '生成设置' })).toBe('safe');
});

test('route inventory includes multiline, aliases and dynamic routes without inventing IDs', () => {
  expect(routePatterns('<Route path="/" element={<Home />} /><Route\n path="/projects/:projectId"\n element={<Project/>} /><Route path="/app" />')).toEqual(['/', '/projects/:projectId', '/app']);
});

test('browser transport guard intercepts unsafe requests before any upstream handler', async ({ context, page }) => {
  let upstreamWrites = 0;
  const blocks: string[] = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.method() !== 'GET') upstreamWrites++;
    return route.fulfill({ contentType: request.url() === `${base}/` ? 'text/html' : 'application/json', body: request.url() === `${base}/` ? '<h1>Guard fixture</h1>' : '{}' });
  });
  await registerReadOnlyGuard(context, base, new Set(['tasks.list']), entry => blocks.push(entry));
  await page.goto(base);
  const statuses = await page.evaluate(async () => {
    const read = await fetch('/api/trpc/tasks.list');
    const write = await fetch('/api/trpc/tasks.create', { method: 'POST' });
    const unknown = await fetch('/api/trpc/admin.runSelfCheck');
    return [read.status, write.status, unknown.status];
  });
  expect(statuses).toEqual([200, 409, 409]);
  expect(upstreamWrites).toBe(0);
  expect(blocks).toEqual(['POST /api/trpc/tasks.create', 'GET /api/trpc/admin.runSelfCheck']);
});
