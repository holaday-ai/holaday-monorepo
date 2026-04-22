/**
 * First-paint loading placeholder. Rendered while we wait for the
 * initial auth.me + tasks.list round-trip. Mirrors the three-column
 * shell so there's no layout flash when the real content lands.
 */
export function AppSkeleton(): JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <aside
        className="flex h-full w-60 shrink-0 flex-col border-r border-border px-3 py-5"
        style={{ backgroundColor: 'rgba(255,255,255,0.5)' }}
      >
        <div className="hola-skel h-5 w-32" />
        <div className="hola-skel mt-4 h-8 w-full" />
        <div className="mt-6 space-y-3">
          <div className="hola-skel h-3 w-16" />
          <div className="hola-skel h-8 w-full" />
          <div className="hola-skel h-8 w-full" />
          <div className="hola-skel h-8 w-4/5" />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="hola-skel h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1">
            <div className="hola-skel h-3 w-24" />
            <div className="hola-skel h-2 w-16" />
          </div>
        </div>
      </aside>
      <main className="flex h-full flex-1 flex-col bg-background px-6 pt-16">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <div className="hola-skel mx-auto h-10 w-10 rounded-full" />
          <div className="hola-skel mx-auto h-6 w-40" />
          <div className="hola-skel mx-auto h-3 w-64" />
          <div className="mt-6 grid grid-cols-2 gap-2">
            <div className="hola-skel h-12" />
            <div className="hola-skel h-12" />
            <div className="hola-skel h-12" />
            <div className="hola-skel h-12" />
          </div>
        </div>
        <div className="flex-1" />
        <div className="mx-auto mb-6 w-full max-w-3xl">
          <div className="hola-skel h-16 w-full" />
        </div>
      </main>
      <aside
        className="hidden h-full w-[400px] shrink-0 flex-col border-l border-border px-3 py-3 lg:flex"
        style={{ backgroundColor: 'rgba(255,255,255,0.5)' }}
      >
        <div className="hola-skel h-6 w-full" />
        <div className="hola-skel mt-3 flex-1" />
        <div className="hola-skel mt-3 h-3 w-1/3" />
      </aside>
    </div>
  );
}
