import fs from 'node:fs';
import path from 'node:path';
export function canonicalUrl(value) {
  const u = new URL(value);
  return u.pathname + u.search + u.hash;
}
export function scenarioSlug(pattern) {
  if (pattern === '/') return 'home';
  if (pattern === '*') return 'not-found';
  return pattern.replace(/[^a-zA-Z0-9_-]+/g, '_');
}
const tags =
  /^(?:button|a|input|textarea|select|summary|Button|Select|SelectTrigger|DropdownMenuItem|DropdownMenuTrigger|TabsTrigger|Switch|Checkbox|DialogTrigger|PopoverTrigger|Input|Textarea|RadioGroupItem)$/;
export function discoverRoutes(source) {
  return [...source.matchAll(/<Route\b([\s\S]*?)(?:\/>|>)/g)].flatMap((m) => {
    const pattern = m[1].match(/\bpath="([^"]+)"/)?.[1];
    if (!pattern) return [];
    const component = m[1].match(/element=\{(?:lazyElement\()?<([A-Z]\w*)/)?.[1] ?? 'Unknown';
    return [{ pattern, component, line: source.slice(0, m.index).split('\n').length }];
  });
}
export function scanControls(source, file) {
  return [...source.matchAll(/<([A-Za-z][\w.]*)\b([\s\S]*?)(?:\/>|>)/g)].flatMap((m) => {
    if (
      !tags.test(m[1]) &&
      !/\b(?:onClick|onChange|onValueChange|role=["'](?:button|tab|combobox))\b/.test(m[2])
    )
      return [];
    const label =
      m[2].match(/(?:aria-label|title|placeholder)="([^"]+)"/)?.[1] ??
      source
        .slice(m.index + m[0].length)
        .match(/^([^<{\n]{1,100})</)?.[1]
        ?.trim() ??
      '[dynamic label]';
    const line = source.slice(0, m.index).split('\n').length;
    return [
      {
        id: `${file}:${line}:${m[1]}`,
        file,
        line,
        tag: m[1],
        label,
        events: [...m[2].matchAll(/\b(on[A-Z]\w+)=/g)].map((x) => x[1]),
        expected: /^a$/.test(m[1])
          ? 'route or new target URL'
          : /input|textarea|select|Input|Textarea|Switch|Checkbox/.test(m[1])
            ? 'value/state changes; submit persists to local seed'
            : 'visible state, dialog, route or recorded local request',
      },
    ];
  });
}
export function inventory(appDir) {
  const src = path.join(appDir, 'src');
  const app = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8');
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) files.push(p);
    }
  }
  walk(src);
  const controls = files.flatMap((f) =>
    scanControls(fs.readFileSync(f, 'utf8'), path.relative(appDir, f)),
  );
  const byBase = new Map(files.map((f) => [path.basename(f, '.tsx'), f]));
  const routes = discoverRoutes(app).map((r) => ({
    ...r,
    path:
      r.pattern === '/organizations/invitations/accept'
        ? '/organizations/invitations/accept#token=ui-local-invitation'
        : r.pattern === '*'
          ? '/__ui_missing__'
          : r.pattern
              .replace(':userId', 'usr_ui')
              .replace(':projectId', r.pattern.includes('video') ? 'ved_ui' : 'prj_ui')
              .replace(':domain', 'browser')
              .replace(':batchId', 'bat_ui'),
    source: byBase.has(r.component) ? path.relative(appDir, byBase.get(r.component)) : null,
  }));
  const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const closure = (file, seen = new Set()) => {
    if (!file || seen.has(file)) return seen;
    seen.add(file);
    for (const m of (sources.get(file) ?? '').matchAll(
      /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g,
    )) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
      const base = spec.startsWith('@/')
        ? path.join(src, spec.slice(2))
        : path.resolve(path.dirname(file), spec);
      const target = [`${base}.tsx`, path.join(base, 'index.tsx')].find((p) => sources.has(p));
      closure(target, seen);
    }
    return seen;
  };
  for (const route of routes) {
    const reach = closure(route.source ? path.join(appDir, route.source) : null);
    if (
      !['/login', '/register', '/privacy', '/terms', '/500', '/account/closure-recovery'].includes(
        route.pattern,
      )
    )
      closure(byBase.get('AppShell'), reach);
    route.controls = controls.filter((c) => reach.has(path.join(appDir, c.file))).map((c) => c.id);
  }
  return { schemaVersion: 1, routes, controls };
}
export function writeInventory(data, output) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'inventory.json'), `${JSON.stringify(data, null, 2)}\n`);
  const esc = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const manual = fs.readFileSync(new URL('../inventory.manual.md', import.meta.url), 'utf8');
  fs.writeFileSync(
    path.join(output, 'inventory.md'),
    `# UI inventory\n\nGenerated from App.tsx and every non-test TSX component. Static candidates are not runtime pass claims. Runtime report links each discovered control to its observed outcome; missing outcomes remain coverage gaps.\n\n## Pages\n\n| Route | Component | Source | Static controls |\n| --- | --- | --- | --- |\n${data.routes.map((r) => `| ${esc(r.pattern)} | ${r.component} | ${r.source ?? 'redirect / composed route'} | ${r.controls.length} |`).join('\n')}\n\n## Manual scenario requirements\n\nAll routes run in a local admin seed at three widths; public auth/legal routes use a logged-out seed. Each task mode uses executing, completed, failed, awaiting-user and cancelled records. Shared sidebar, notifications, avatar menus, project menus, task actions, forms, uploads, tabs and nested dialogs are traversed from their visible entry points. Runtime outcomes and action paths are in report.json.\n\nDefault-off partner payments, browser-data grants and video rendering remain off. Real identity, payment, external site health and licensed media rendering are not proven by this suite. Disabled controls and deeper unreachable states are recorded, never counted as action passes.\n\n${manual}\n\n## Page × interactive component × expected behavior\n\n${data.routes
      .map(
        (r) =>
          `### ${r.pattern}\n\n${
            r.controls
              .map((id) => {
                const c = data.controls.find((x) => x.id === id);
                return `- ${c.file}:${c.line} — ${esc(c.label)} — ${c.expected}`;
              })
              .join('\n') || 'Redirect / dynamic composition: runtime inventory required.'
          }`,
      )
      .join(
        '\n\n',
      )}\n\n## Interactive component candidates\n\nShared components may appear on multiple pages. Source line identities are stable; runtime inventories supply the page × component × outcome mapping.\n\n| Source | Component | Label | Expected behavior |\n| --- | --- | --- | --- |\n${data.controls.map((c) => `| ${c.file}:${c.line} | ${c.tag} | ${esc(c.label)} | ${c.expected} |`).join('\n')}\n`,
  );
}
