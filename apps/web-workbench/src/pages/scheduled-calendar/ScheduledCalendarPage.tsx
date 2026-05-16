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
  EventDropArg,
  EventInput,
  EventMountArg,
} from '@fullcalendar/core';

import { Plus } from 'lucide-react';
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
  const [loading, setLoading] = React.useState(true);
  const [currentRange, setCurrentRange] = React.useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [quickCreate, setQuickCreate] = React.useState<QuickCreateState | null>(null);
  const [eventDetail, setEventDetail] = React.useState<EventDetailState | null>(
    null,
  );
  const [fullModalOpen, setFullModalOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });
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
  }, []);

  const handleDateClick = React.useCallback((arg: DateClickArg) => {
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

  /** FullCalendar fires this per-event-mount; we apply the opacity from
   *  the color helper directly to the rendered block so completed-past
   *  events recede visually. */
  const handleEventDidMount = React.useCallback(
    (arg: EventMountArg) => {
      const opacity = (arg.event.extendedProps as { opacity?: number } | undefined)?.opacity;
      if (typeof opacity === 'number' && opacity < 1) {
        arg.el.style.opacity = String(opacity);
      }
      // Pulse animation for newly-created rows
      const id = arg.event.id;
      if (recentlyCreatedIds.has(id)) {
        arg.el.classList.add('hd-pulse-new');
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
    }) => {
      try {
        const res = await trpc.scheduledTasks.create.mutate({
          intent: input.intent,
          repeatType: input.repeatType,
          scheduledAt: input.scheduledAt.toISOString(),
          ...(input.rrule ? { rrule: input.rrule } : {}),
        });
        toast.show('已创建定时任务', 'info');
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

  const showEmpty = !loading && rows.length === 0;

  return (
    <PageContainer width="wide">
      <PageHeader
        title="定时任务"
        description="按日历视图管理你的定时任务，拖拽事件可以调整执行时间或持续时间。"
        action={
          <Button onClick={() => setFullModalOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            新建定时任务
          </Button>
        }
      />
      <div className="hd-calendar-shell relative mt-4 rounded-lg border border-border bg-card">
        <FullCalendar
          ref={calendarRef}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
            rrulePlugin,
          ]}
          initialView={isMobile ? 'listMonth' : 'dayGridMonth'}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: isMobile
              ? 'listMonth,timeGridDay'
              : 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          buttonText={{
            today: '今天',
            month: '月',
            week: '周',
            day: '日',
            list: '列表',
          }}
          locale="zh-cn"
          firstDay={1}
          allDaySlot={false}
          slotDuration="00:30:00"
          slotMinTime="06:00:00"
          slotMaxTime="23:00:00"
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
          nowIndicator
        />
        {showEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto rounded-lg border border-border bg-background/90 px-6 py-4 text-center shadow-lg backdrop-blur">
              <div className="text-sm font-medium text-foreground">
                还没有定时任务
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                点击日历任意日期，或点击右上角按钮创建
              </div>
            </div>
          </div>
        )}
      </div>

      {quickCreate && (
        <QuickCreatePopover
          anchor={quickCreate.anchor}
          date={quickCreate.date}
          mobile={isMobile}
          onClose={() => setQuickCreate(null)}
          onCreate={handleCreate}
        />
      )}
      {eventDetail && (
        <EventDetailPopover
          anchor={eventDetail.anchor}
          row={eventDetail.row}
          mobile={isMobile}
          onClose={() => setEventDetail(null)}
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
