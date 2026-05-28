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
        className="hidden h-full w-[260px] shrink-0 flex-col border-r border-[#DCDDDD]/70 bg-white/70 px-3 py-4 md:flex"
      >
        <div className="flex items-center gap-2 px-1">
          <div className="h-5 w-8 rounded-[6px] bg-[#EA1F59]/90" />
          <div className="hola-skel h-3.5 w-20 bg-[#DCDDDD]/80" />
        </div>
        <div className="mt-5 h-9 rounded-[8px] bg-[#EA1F59]/90 shadow-[0_8px_20px_rgba(234,31,89,0.16)]" />
        <div className="mt-3 hola-skel h-8 w-full bg-[#EFEFEF]/80" />
        <div className="mt-6 space-y-3">
          <div className="hola-skel h-3 w-16 bg-[#DCDDDD]/80" />
          <div className="hola-skel h-7 w-full bg-[#EFEFEF]/85" />
          <div className="hola-skel h-7 w-full bg-[#EFEFEF]/85" />
          <div className="hola-skel h-7 w-4/5 bg-[#EFEFEF]/85" />
          <div className="hola-skel h-7 w-3/4 bg-[#EFEFEF]/85" />
        </div>
        <div className="flex-1" />
        <div className="mb-3 rounded-[8px] border border-[#DCDDDD]/70 bg-white/70 p-2.5">
          <div className="hola-skel h-2 w-full bg-[#EFEFEF]" />
          <div className="mt-2 hola-skel h-1.5 w-24 bg-[#42C0EF]/60" />
        </div>
        <div className="flex items-center gap-2 rounded-[8px] border border-[#DCDDDD]/70 bg-white/70 p-2">
          <div className="h-8 w-8 rounded-[8px] bg-[#EA1F59]/90" />
          <div className="flex-1 space-y-1">
            <div className="hola-skel h-3 w-24 bg-[#DCDDDD]/80" />
            <div className="hola-skel h-2 w-16 bg-[#EFEFEF]" />
          </div>
        </div>
      </aside>
      <main className="flex h-full flex-1 flex-col bg-background">
        <div className="flex h-11 items-center border-b border-[#DCDDDD]/70 bg-white/70 px-3 md:hidden">
          <div className="hola-skel h-4 w-4 bg-[#DCDDDD]/80" />
          <div className="ml-3 h-3.5 w-20 rounded-[4px] bg-[#595757]/85" />
          <div className="ml-auto hola-skel h-8 w-8 bg-[#EFEFEF]/85" />
        </div>
        <div className="mx-auto w-full max-w-[720px] px-4 pt-[19vh] sm:px-6 md:pt-[18vh]">
          <div className="hola-skel mx-auto mb-6 h-8 w-56 bg-[#DCDDDD]/80" />
          <div className="rounded-[8px] border border-[#DCDDDD]/75 bg-white/70 p-4 shadow-[0_8px_24px_rgba(89,87,87,0.06)]">
            <div className="hola-skel h-4 w-56 bg-[#DCDDDD]/75" />
            <div className="mt-10 hola-skel h-5 w-5 bg-[#DCDDDD]/75" />
            <div className="mt-4 flex items-center justify-between">
              <div className="hola-skel h-4 w-8 bg-[#DCDDDD]/75" />
              <div className="h-8 w-8 rounded-full bg-[#EA1F59]/55" />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
            <div className="hola-skel h-8 w-20 rounded-[8px] bg-white/75" />
            <div className="hola-skel h-8 w-[72px] rounded-[8px] bg-white/75" />
            <div className="hola-skel h-8 w-[88px] rounded-[8px] bg-white/75" />
            <div className="hola-skel h-8 w-20 rounded-[8px] bg-white/75" />
            <div className="hola-skel h-8 w-[72px] rounded-[8px] bg-white/75" />
            <div className="hola-skel h-8 w-24 rounded-[8px] bg-white/75" />
          </div>
        </div>
      </main>
    </div>
  );
}
