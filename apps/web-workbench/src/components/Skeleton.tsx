/**
 * First-paint loading placeholder. Rendered by AppShell while we wait
 * for the initial auth.me + tasks.list round-trip. Matches the
 * composer-first empty home: sidebar + centered composer column —
 * no right-side BrowserPanel skeleton, since that pane only mounts
 * for an in-flight browser task and starting state never has one.
 */
export function AppSkeleton(): JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <aside
        className="flex h-full w-[260px] shrink-0 flex-col border-r border-border px-3 py-5"
        style={{ backgroundColor: 'rgba(255,255,255,0.5)' }}
      >
        <div className="hola-skel h-5 w-32" />
        <div className="hola-skel mt-4 h-9 w-full" />
        <div className="mt-6 space-y-3">
          <div className="hola-skel h-3 w-16" />
          <div className="hola-skel h-6 w-full" />
          <div className="hola-skel h-6 w-full" />
          <div className="hola-skel h-6 w-4/5" />
          <div className="hola-skel h-6 w-3/4" />
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
      <main className="flex h-full flex-1 flex-col bg-background">
        <div className="mx-auto w-full max-w-[720px] px-4 pt-[18vh] sm:px-6">
          <div className="hola-skel mx-auto mb-6 h-7 w-56" />
          <div className="hola-skel h-[120px] w-full rounded-[20px]" />
          <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
            <div className="hola-skel h-7 w-16 rounded-full" />
            <div className="hola-skel h-7 w-14 rounded-full" />
            <div className="hola-skel h-7 w-18 rounded-full" />
            <div className="hola-skel h-7 w-16 rounded-full" />
            <div className="hola-skel h-7 w-14 rounded-full" />
            <div className="hola-skel h-7 w-20 rounded-full" />
          </div>
        </div>
      </main>
    </div>
  );
}
