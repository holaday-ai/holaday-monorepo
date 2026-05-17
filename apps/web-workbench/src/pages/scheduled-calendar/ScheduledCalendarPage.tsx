/**
 * Phase 26A — FullCalendar-driven /scheduled page.
 *
 * Replaces the old list-view ScheduledPage. Layout:
 *   - PageHeader: title + "新建定时任务" CTA
 *   - <FullCalendar> with Month / Week / Day view switcher
 *   - QuickCreatePopover: opens on date click; minimal fields
 *   - EventDetailPopover: opens on event click; full row metadata
 *     + edit / pause / delete / run-now actions
 *   - ScheduledTaskDialog (existing): the full create modal, opened
 *     by the header CTA
 *   - Empty-state overlay when there are zero rows in the visible
 *     range AND zero rows in storage
 *
 * Data flow:
 *   - `datesSet` callback fires whenever the visible range changes
 *     (view switch, navigation). We call `scheduledTasks.list` with
 *     {rangeStart, rangeEnd} and re-derive events.
 *   - eventDrop / eventResize mutate via `scheduledTasks.update`.
 *   - The full create modal + quick-create both call
 *     `scheduledTasks.create`; on success we refresh.
 *
 * Mobile: detected via window.matchMedia('(max-width: 640px)') —
 * initial view is `listMonth`, and popovers swap to bottom-sheet via
 * `BottomSheet` wrapper (CSS-only fallback if no Sheet component).
 */

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from '@fullcalendar/core';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import { ScheduledTaskDialog } from '@/components/ScheduledTaskDialog';
import {
  rowToEventInput,
  type ScheduledTaskRow,
} from './event-mapping';
import { QuickCreatePopover } from './QuickCreatePopover';
import { EventDetailPopover } from './EventDetailPopover';
import './calendar-styles.css';

const MOBILE_QUERY = '(max-width: 640px)';

interface QuickCreateState {
  /** Anchor position for the popover (viewport coords). */
  anchor: { x: number; y: number };
  /** The date the user clicked — used as the default scheduledAt. */
  date: Date;
}

interface EventDetailState {
  anchor: { x: number; y: number };
  row: ScheduledTaskRow;
}

export function ScheduledCalendarPage(): JSX.Element {
  const toast = useToast();
  const calendarRef = React.useRef<FullCalendar | null>(null);
  const [rows, setRows] = React.useState<ScheduledTaskRow[]>([]);
  // `loading` no longer drives a UI affordance now that the empty-
  // state overlay is gone; kept the call sites for future use (the
  // `_` prefix marks it intentional for the linter).
  const [, setLoading] = React.useState(true);
  const [currentRange, setCurrentRange] = React.useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [quickCreate, setQuickCreate] = React.useState<QuickCreateState | null>(null);
  const [eventDetail, setEventDetail] = React.useState<EventDetailState | null>(
    null,
  );
  /**
   * Cooldown timestamp set whenever a popover closes. The popover's
   * outside-click runs on `mousedown` (closes the popover); the
   * follow-up `click` then dispatches FullCalendar's dateClick /
   * eventClick. Without a cooldown those two phases of the SAME
   * gesture would close-and-reopen. We stamp the ref synchronously
   * inside the close path (NOT via useEffect on state, which fires
   * too late — React 18 may flush effects between mousedown and
   * click) so the click handler sees a fresh timestamp.
   */
  const popoverClosedAtRef = React.useRef<number>(0);
  const closeQuickCreate = React.useCallback(() => {
    popoverClosedAtRef.current = Date.now();
    setQuickCreate(null);
  }, []);
  const closeEventDetail = React.useCallback(() => {
    popoverClosedAtRef.current = Date.now();
    setEventDetail(null);
  }, []);
  const [fullModalOpen, setFullModalOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });
  // Phase 26B polish — custom toolbar (we render the title + view
  // pills + nav arrows ourselves). Mirror the FullCalendar state
  // here so the pills know which view is active.
  //
  // Phase 26B follow-up — default view is WEEK (timeGridWeek). The
  // month view felt too high-level for the daily-cadence tasks most
  // users actually create; week shows enough detail to drop tasks
  // into specific hour slots.
  const [currentView, setCurrentView] = React.useState<
    'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listMonth'
  >(() => (isMobile ? 'listMonth' : 'timeGridWeek'));
  const [toolbarTitle, setToolbarTitle] = React.useState<string>('');
  // Track row externalIds whose CREATED_AT just landed in the last
  // refresh so we can apply the magenta-glow pulse animation once.
  const [recentlyCreatedIds, setRecentlyCreatedIds] = React.useState<Set<string>>(
    new Set(),
  );

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!currentRange) return;
    setLoading(true);
    try {
      const res = await trpc.scheduledTasks.list.query({
        rangeStart: currentRange.start.toISOString(),
        rangeEnd: currentRange.end.toISOString(),
      });
      setRows(res as ScheduledTaskRow[]);
    } catch (err) {
      toast.show(
        `加载失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      setLoading(false);
    }
    // toast is stable; refresh re-runs only when currentRange changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRange]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const events = React.useMemo<EventInput[]>(() => {
    const now = new Date();
    return rows.flatMap((r) => rowToEventInput(r, { now }));
  }, [rows]);

  // ───────────────────────────── handlers ─────────────────────────────

  const handleDatesSet = React.useCallback((arg: DatesSetArg) => {
    setCurrentRange({ start: arg.start, end: arg.end });
    setToolbarTitle(arg.view.title);
    setCurrentView(arg.view.type as typeof currentView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toolbar action helpers — talk to the FullCalendar API ref.
  const callApi = React.useCallback(
    (fn: (api: NonNullable<ReturnType<NonNullable<typeof calendarRef.current>['getApi']>>) => void) => {
      const api = calendarRef.current?.getApi();
      if (api) fn(api);
    },
    [],
  );
  const handlePrev = React.useCallback(() => callApi((api) => api.prev()), [callApi]);
  const handleNext = React.useCallback(() => callApi((api) => api.next()), [callApi]);
  const handleToday = React.useCallback(() => callApi((api) => api.today()), [callApi]);
  const handleViewChange = React.useCallback(
    (view: typeof currentView) => callApi((api) => api.changeView(view)),
    [callApi, currentView],
  );

  /**
   * Force time-grid views (week / day) to anchor at 08:00 on mount
   * + on view change. FC's `scrollTime` prop and the immediate
   * `scrollToTime` API call both no-op when `slotMinTime=00:00:00`
   * and `stickyHeaderDates=true` — FC's own post-layout scroll
   * pass races our call and lands at 0.
   *
   * Strategy: wait long enough for FC's render + scroll pass to
   * settle (500 ms), then snap. Both the API and a DOM-level
   * fallback fire — the fallback queries the actual `.fc-scroller`
   * inside the time-grid view and writes `scrollTop` directly so
   * we don't depend on FC's internal scrollEl bookkeeping. Slot
   * height is measured from a live `.fc-timegrid-slot` so this
   * survives CSS edits to the 32 px default.
   *
   * Month / list views don't have a vertical scroll, so we no-op.
   */
  React.useEffect(() => {
    if (currentView !== 'timeGridWeek' && currentView !== 'timeGridDay') return;
    const id = window.setTimeout(() => {
      calendarRef.current?.getApi()?.scrollToTime('08:00:00');
      const shell = shellRef.current;
      if (!shell) return;
      const scroller = shell.querySelector<HTMLElement>('.fc-timegrid .fc-scroller');
      if (!scroller) return;
      const slotEl = shell.querySelector<HTMLElement>('.fc-timegrid-slot');
      const slotH = slotEl?.getBoundingClientRect().height ?? 32;
      // slotDuration is 30 min → 8 h = 16 slots
      scroller.scrollTop = slotH * 16;
    }, 500);
    return () => window.clearTimeout(id);
  }, [currentView]);

  /**
   * Phase 26B follow-up — wheel + touch nav for prev/next.
   *
   * Wheel: deltaY-driven prev/next when the user scrolls inside the
   * calendar grid. We debounce so a single trackpad swipe doesn't
   * skip three months. Wired only on month + week views; day view
   * still scrolls the time column naturally.
   *
   * Touch: swipe-left → next, swipe-right → prev when |Δx| > 50px.
   * Same view gate (month + week). Mobile users get the same nav
   * affordance the toolbar arrows give on desktop.
   */
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const bandRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * Measure the sticky band's rendered height and feed it to the
   * calendar shell as a CSS custom property. calendar-styles.css
   * reads `--hd-band-h` to offset FullCalendar's column-header sticky
   * (so the header lands directly below the band instead of behind a
   * hard-coded 96px guess). ResizeObserver covers font-loading
   * reflows + responsive padding changes.
   */
  React.useEffect(() => {
    const band = bandRef.current;
    const shell = shellRef.current;
    if (!band || !shell) return;
    const apply = (h: number) => {
      shell.style.setProperty('--hd-band-h', `${Math.ceil(h)}px`);
    };
    apply(band.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      apply(h);
    });
    ro.observe(band);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const navEnabled = currentView === 'dayGridMonth' || currentView === 'timeGridWeek';
    if (!navEnabled) return;

    let wheelCooldownUntil = 0;
    const WHEEL_THRESHOLD = 40;
    const WHEEL_COOLDOWN_MS = 350;
    const onWheel = (e: WheelEvent) => {
      // Only react to vertical wheel motion — ignore horizontal
      // trackpad gestures that the calendar's own scroll handles.
      if (Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
      // Day view (when active) needs vertical scrolling for the
      // time grid — we already gate on currentView above, so this
      // path only runs for month / week.
      const now = Date.now();
      if (now < wheelCooldownUntil) return;
      wheelCooldownUntil = now + WHEEL_COOLDOWN_MS;
      e.preventDefault();
      if (e.deltaY > 0) handleNext();
      else handlePrev();
    };

    let touchStartX: number | null = null;
    let touchStartY: number | null = null;
    const SWIPE_THRESHOLD_PX = 50;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0]?.clientX ?? null;
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchStartX === null || touchStartY === null) return;
      const endX = e.changedTouches[0]?.clientX ?? touchStartX;
      const endY = e.changedTouches[0]?.clientY ?? touchStartY;
      const dx = endX - touchStartX;
      const dy = endY - touchStartY;
      touchStartX = null;
      touchStartY = null;
      // Require horizontal-dominant motion so vertical scrolls
      // (especially in week view's time grid) don't accidentally
      // page the calendar.
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) handleNext();
      else handlePrev();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [currentView, handleNext, handlePrev]);

  const handleDateClick = React.useCallback((arg: DateClickArg) => {
    // The popover's outside-click closed it on mousedown and stamped
    // popoverClosedAtRef. This `click` is the SAME gesture — if it
    // landed inside the cooldown window, drop it instead of opening
    // a new popover. The user must click again to open.
    if (Date.now() - popoverClosedAtRef.current < 250) return;
    // The clicked cell's center as the anchor for the popover. arg.jsEvent
    // gives us the source MouseEvent so we can read clientX/Y directly.
    const x = arg.jsEvent.clientX;
    const y = arg.jsEvent.clientY;
    // If the user clicked a date in the past, default the time to
    // 09:00 of TODAY instead — creating in the past would 400 on the
    // server anyway.
    const clicked = new Date(arg.date);
    const now = new Date();
    if (clicked.getTime() < now.getTime()) {
      clicked.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
      clicked.setHours(9, 0, 0, 0);
    }
    setQuickCreate({ anchor: { x, y }, date: clicked });
  }, []);

  const handleEventClick = React.useCallback(
    (arg: EventClickArg) => {
      arg.jsEvent.preventDefault();
      // Same cooldown rule as handleDateClick — the outside-click on
      // mousedown closed the previous popover; this click is part of
      // the same gesture, so we drop it.
      if (Date.now() - popoverClosedAtRef.current < 250) return;
      const id = arg.event.id;
      const row = rows.find((r) => r.scheduledTaskId === id);
      if (!row) return;
      setEventDetail({
        anchor: { x: arg.jsEvent.clientX, y: arg.jsEvent.clientY },
        row,
      });
    },
    [rows],
  );

  const handleEventDrop = React.useCallback(
    async (arg: EventDropArg) => {
      const id = arg.event.id;
      const newStart = arg.event.start;
      if (!newStart) {
        arg.revert();
        return;
      }
      try {
        await trpc.scheduledTasks.update.mutate({
          scheduledTaskId: id,
          scheduledAt: newStart.toISOString(),
        });
        toast.show('已更新执行时间', 'info');
        await refresh();
      } catch (err) {
        arg.revert();
        toast.show(
          `更新失败：${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [refresh, toast],
  );

  const handleEventResize = React.useCallback(
    async (arg: EventResizeDoneArg) => {
      const id = arg.event.id;
      const start = arg.event.start;
      const end = arg.event.end;
      if (!start || !end) {
        arg.revert();
        return;
      }
      const durationMinutes = Math.max(
        5,
        Math.round((end.getTime() - start.getTime()) / 60_000),
      );
      try {
        await trpc.scheduledTasks.update.mutate({
          scheduledTaskId: id,
          durationMinutes,
        });
        toast.show(`已更新持续时间：${durationMinutes} 分钟`, 'info');
        await refresh();
      } catch (err) {
        arg.revert();
        toast.show(
          `更新失败：${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [refresh, toast],
  );

  /** FullCalendar fires this per-event-mount; we use it to:
   *   1. apply CSS custom properties for the Todoist-style block
   *      (accent + tinted bg, read by calendar-styles.css)
   *   2. set opacity for past-completed / paused rows
   *   3. tag newly-created rows with the magenta-glow pulse class
   */
  /**
   * Event blocks show ONLY the title — the time axis on the left
   * already locates the block, repeating the time in the block was
   * redundant + truncated the title in compact (≤30 min) slots.
   * Falls back to "未命名任务" if the intent is empty (defensive —
   * required at create-time, but a stale row could be empty).
   */
  const renderEventContent = React.useCallback((arg: EventContentArg) => {
    const title = arg.event.title.trim() || '未命名任务';
    return (
      <div className="hd-event-content">
        <span className="hd-event-title">{title}</span>
      </div>
    );
  }, []);

  const handleEventDidMount = React.useCallback(
    (arg: EventMountArg) => {
      const ext = arg.event.extendedProps as
        | {
            opacity?: number;
            accentColor?: string;
            backgroundTint?: string;
            backgroundTintHover?: string;
          }
        | undefined;
      const el = arg.el;
      // CSS variables consumed by .hd-calendar .fc-event-main ::before
      // (accent bar) + base / hover background.
      if (ext?.accentColor) el.style.setProperty('--hd-event-accent', ext.accentColor);
      if (ext?.backgroundTint) el.style.setProperty('--hd-event-bg', ext.backgroundTint);
      if (ext?.backgroundTintHover) {
        el.style.setProperty('--hd-event-bg-hover', ext.backgroundTintHover);
      }
      if (typeof ext?.opacity === 'number' && ext.opacity < 1) {
        el.style.opacity = String(ext.opacity);
      }
      if (recentlyCreatedIds.has(arg.event.id)) {
        el.classList.add('hd-pulse-new');
      }
    },
    [recentlyCreatedIds],
  );

  // ───────────────────────────── mutations ─────────────────────────────

  const handleCreate = React.useCallback(
    async (input: {
      intent: string;
      scheduledAt: Date;
      repeatType: 'once' | 'daily' | 'weekly' | 'monthly';
      rrule?: string;
      description?: string;
      reminderMinutes?: number | null;
    }) => {
      try {
        const res = await trpc.scheduledTasks.create.mutate({
          intent: input.intent,
          repeatType: input.repeatType,
          scheduledAt: input.scheduledAt.toISOString(),
          ...(input.rrule ? { rrule: input.rrule } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.reminderMinutes !== undefined
            ? { reminderMinutes: input.reminderMinutes }
            : {}),
        });
        // #1 — surface roll-forward when the server adjusted the
        // first-fire time (recurring task whose start was already
        // past at submit). Don't block the flow with a confirm; a
        // toast describes what happened.
        if (res.adjusted) {
          const adjusted = new Date(res.nextRunAt);
          toast.show(
            `已创建，首次执行时间调整为 ${formatRollForward(adjusted)}（所选时间已过）`,
            'info',
          );
        } else {
          toast.show('已创建定时任务', 'info');
        }
        setRecentlyCreatedIds((prev) => {
          const next = new Set(prev);
          next.add(res.scheduledTaskId);
          return next;
        });
        // Drop the pulse class after the animation completes (~1.2 s)
        window.setTimeout(() => {
          setRecentlyCreatedIds((prev) => {
            const next = new Set(prev);
            next.delete(res.scheduledTaskId);
            return next;
          });
        }, 1500);
        setQuickCreate(null);
        setFullModalOpen(false);
        await refresh();
      } catch (err) {
        toast.show(
          `创建失败：${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [refresh, toast],
  );

  const handleToggle = React.useCallback(
    async (scheduledTaskId: string) => {
      try {
        await trpc.scheduledTasks.toggle.mutate({ scheduledTaskId });
        await refresh();
      } catch (err) {
        toast.show(
          `操作失败：${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [refresh, toast],
  );

  const handleRunNow = React.useCallback(
    async (scheduledTaskId: string) => {
      try {
        await trpc.scheduledTasks.runNow.mutate({ scheduledTaskId });
        toast.show('已触发立即执行（最多 60 秒生效）', 'info');
        setEventDetail(null);
        await refresh();
      } catch (err) {
        toast.show(
          `操作失败：${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [refresh, toast],
  );

  const handleDelete = React.useCallback(
    async (scheduledTaskId: string) => {
      try {
        await trpc.scheduledTasks.delete.mutate({ scheduledTaskId });
        toast.show('已删除定时任务', 'info');
        setEventDetail(null);
        setConfirmDelete(null);
        await refresh();
      } catch (err) {
        toast.show(
          `删除失败：${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [refresh, toast],
  );

  // ───────────────────────────── render ─────────────────────────────

  return (
    <PageContainer width="wide">
      {/* #3 — page header + custom toolbar + FullCalendar's column
          header (driven by stickyHeaderDates) all stay pinned at the
          top of the scroll container while only the time grid below
          scrolls. The wrapper is sticky; FullCalendar's internal
          .fc-scrollgrid-section-header gets its own top offset
          via calendar-styles.css to land just below this band. */}
      <div ref={bandRef} className="hd-calendar-sticky-band">
        <PageHeader
          title="定时任务"
          action={
            <Button onClick={() => setFullModalOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              新建定时任务
            </Button>
          }
        />
        {/* Custom toolbar — replaces FullCalendar's default. Three
            regions: nav arrows + 今天, centered title, segment-
            control view switcher. Sits inside the sticky band so it
            pins alongside the page header. */}
        <div className="hd-calendar-toolbar">
          <div className="hd-calendar-toolbar__nav">
            <button
              type="button"
              className="hd-calendar-toolbar__arrow"
              onClick={handlePrev}
              aria-label="上一个"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="hd-calendar-toolbar__arrow"
              onClick={handleNext}
              aria-label="下一个"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="hd-calendar-toolbar__today"
              onClick={handleToday}
            >
              今天
            </button>
          </div>
          <div className="hd-calendar-toolbar__title">{toolbarTitle}</div>
          <div className="hd-calendar-toolbar__views">
            {(isMobile
              ? ([
                  { v: 'listMonth', label: '列表' },
                  { v: 'timeGridDay', label: '日' },
                ] as const)
              : ([
                  { v: 'dayGridMonth', label: '月' },
                  { v: 'timeGridWeek', label: '周' },
                  { v: 'timeGridDay', label: '日' },
                ] as const)
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                data-active={currentView === opt.v ? 'true' : 'false'}
                onClick={() => handleViewChange(opt.v)}
                className="hd-calendar-toolbar__view-btn"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={shellRef} className="hd-calendar relative">
        <FullCalendar
          ref={calendarRef}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
            rrulePlugin,
          ]}
          initialView={isMobile ? 'listMonth' : 'timeGridWeek'}
          headerToolbar={false}
          /* Day view title needs the full date — FullCalendar's
             default for timeGridDay is just the weekday. Month view
             swaps the day-of-month cell content to a bare number
             (default zh-cn renders "17日" / "18日"; the suffix is
             visually noisy in a grid of 35 cells). */
          views={{
            timeGridDay: {
              titleFormat: {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              },
            },
            dayGridMonth: {
              dayCellContent: (arg) => String(arg.date.getDate()),
            },
          }}
          locale="zh-cn"
          firstDay={1}
          allDaySlot={false}
          slotDuration="00:30:00"
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          slotLabelFormat={{
            hour: 'numeric',
            minute: '2-digit',
            hour12: false,
            meridiem: false,
          }}
          scrollTime="08:00:00"
          height="auto"
          events={events}
          editable
          eventStartEditable
          eventResizableFromStart={false}
          eventDrop={(arg) => void handleEventDrop(arg)}
          eventResize={(arg) => void handleEventResize(arg)}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          datesSet={handleDatesSet}
          eventDidMount={handleEventDidMount}
          eventContent={renderEventContent}
          nowIndicator
          stickyHeaderDates={true}
        />
        {/* Phase 26B follow-up — the empty-state overlay obstructed
            the date grid more than it helped. The grid itself IS the
            interactive surface; a "first-task" call-out covering it
            felt like an error page. Removed. */}
      </div>

      {quickCreate && (
        <QuickCreatePopover
          anchor={quickCreate.anchor}
          date={quickCreate.date}
          mobile={isMobile}
          onClose={closeQuickCreate}
          onCreate={handleCreate}
        />
      )}
      {eventDetail && (
        <EventDetailPopover
          anchor={eventDetail.anchor}
          row={eventDetail.row}
          mobile={isMobile}
          onClose={closeEventDetail}
          onToggle={handleToggle}
          onRunNow={handleRunNow}
          onDeleteRequest={(id) => setConfirmDelete(id)}
        />
      )}
      <ScheduledTaskDialog
        open={fullModalOpen}
        onClose={() => setFullModalOpen(false)}
        onCreated={() => {
          setFullModalOpen(false);
          void refresh();
        }}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除定时任务？"
        description="删除后该任务的执行计划会被永久移除，已经创建的实际任务不受影响。"
        confirmLabel="删除"
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
        }}
      />
    </PageContainer>
  );
}

/**
 * Format an adjusted next-run time for the roll-forward toast. Uses
 * locale-aware "明天 09:00" / "周一 09:00" / "05-23 09:00" style so
 * the user immediately sees the new fire time without parsing an ISO
 * string. Pure helper — exported for testing if needed.
 */
function formatRollForward(at: Date): string {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  };
  const diffDays = Math.round(
    (startOfDay(at).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  const time = at.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `明天 ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekday = at.toLocaleDateString('zh-CN', { weekday: 'short' });
    return `${weekday} ${time}`;
  }
  return at.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }) + ' ' + time;
}
