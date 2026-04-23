import * as React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Called on drag. `deltaX` is cumulative from the pointer-down
   *  origin (NOT per-event delta). Positive = dragged right. */
  onDrag: (deltaX: number) => void;
  /** Called once when the user releases. Lets the parent snapshot
   *  the final split into localStorage. */
  onDragEnd?: () => void;
  className?: string;
}

/**
 * Vertical drag handle — 4px hit area, visual 1px line at idle,
 * thickens to a blue bar on hover/drag so the affordance is
 * obvious. Uses pointer capture so the drag survives the cursor
 * leaving the thin track at speed.
 *
 * Pure event plumbing — parent owns the actual width state and
 * clamping logic. We only report `deltaX` from pointer-down origin,
 * which keeps the component trivially testable.
 */
export function ResizeHandle({ onDrag, onDragEnd, className }: Props): JSX.Element {
  const [dragging, setDragging] = React.useState(false);
  const originRef = React.useRef<number | null>(null);

  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    originRef.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = originRef.current;
      if (origin === null) return;
      onDrag(e.clientX - origin);
    },
    [onDrag],
  );

  const stopDrag = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (originRef.current === null) return;
      originRef.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture throws if the pointer already left —
        // safe to ignore, we've already reset state.
      }
      onDragEnd?.();
    },
    [onDragEnd],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: drag handle has no click activation
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖拽调整面板宽度"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      // 8px hit area — the visible bar underneath is smaller but the
      // drag target stays wide enough to hit reliably.
      className={cn(
        'group relative z-20 hidden h-full w-2 shrink-0 cursor-col-resize touch-none select-none lg:block',
        className,
      )}
    >
      {/* 2px bar at rest, 4px blue bar on hover / drag */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all',
          dragging
            ? 'w-[3px] bg-blue-500/80'
            : 'w-px bg-border group-hover:w-[3px] group-hover:bg-blue-400/80',
        )}
      />
      {/* Grip dots in the middle — visual cue that this is grabbable */}
      <span
        aria-hidden
        className={cn(
          'absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-0.5 transition-opacity',
          dragging ? 'opacity-100' : 'opacity-40 group-hover:opacity-100',
        )}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'h-0.5 w-0.5 rounded-full',
              dragging || 'bg-muted-foreground/70',
              dragging && 'bg-blue-500',
            )}
          />
        ))}
      </span>
    </div>
  );
}
