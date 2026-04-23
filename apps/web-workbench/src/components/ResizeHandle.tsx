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
      className={cn(
        'group relative hidden h-full w-1 shrink-0 cursor-col-resize touch-none select-none lg:block',
        dragging && 'bg-blue-500/60',
        className,
      )}
    >
      {/* 1px visual divider at rest, full-width blue band on hover */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors',
          dragging
            ? 'w-1 bg-blue-500/80'
            : 'w-px bg-border group-hover:w-1 group-hover:bg-blue-400/60',
        )}
      />
    </div>
  );
}
