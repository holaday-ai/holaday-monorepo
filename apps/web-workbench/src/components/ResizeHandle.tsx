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
      // 12px hit area — generous enough to grab without precise
      // aim; the visible bar underneath stays slim so it doesn't eat
      // content space. `bg-transparent` on the host div keeps the hit
      // area invisible at rest, only the inner bar shows.
      className={cn(
        'group relative z-20 hidden h-full w-3 shrink-0 cursor-col-resize touch-none select-none lg:block',
        dragging && 'bg-blue-500/10',
        className,
      )}
    >
      {/* 2px bar, thicker and blue on hover / drag */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all',
          dragging
            ? 'w-1 bg-blue-500'
            : 'w-0.5 bg-border group-hover:w-1 group-hover:bg-blue-500/80',
        )}
      />
      {/* Grip dots in the middle — ALWAYS visible so the handle
       *  reads as a handle at first glance, not just at hover. */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1"
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 w-1 rounded-full transition-colors',
              dragging
                ? 'bg-blue-500'
                : 'bg-muted-foreground/60 group-hover:bg-blue-500/80',
            )}
          />
        ))}
      </span>
    </div>
  );
}
