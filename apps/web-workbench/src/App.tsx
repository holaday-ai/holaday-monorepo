/**
 * Step 1 placeholder — Vite + Tailwind + shadcn tokens verified here.
 *
 * The real three-column layout (sidebar / task stream / browser panel)
 * lands in Step 2. This file intentionally stays terse so it's obvious
 * when Step 2 replaces it.
 */
export function App() {
  return (
    <div className="flex h-full items-center justify-center bg-background text-foreground">
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">HOLA DAY Workbench</h1>
        <p className="text-sm text-muted-foreground">
          Step 1 scaffold. Three-column UI lands in Step 2.
        </p>
        <p className="text-xs text-muted-foreground">
          Dev proxy: <code className="font-mono">/api</code> → :3001 ·{' '}
          <code className="font-mono">/ws</code> → :3002
        </p>
      </div>
    </div>
  );
}
