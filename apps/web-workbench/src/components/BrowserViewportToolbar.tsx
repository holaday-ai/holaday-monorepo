import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BrowserViewportRenderMode } from '@/lib/browser-workspace-viewport';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronDown,
  LockKeyhole,
  Maximize2,
  Minus,
  Monitor,
  Move,
  ZoomIn,
} from 'lucide-react';

interface Props {
  mode: 'contain' | 'original';
  zoom: number;
  displayScale: number;
  onFit: () => void;
  onOriginal: () => void;
  onZoom: () => void;
  onZoomOut: () => void;
  onPan: (x: number, y: number) => void;
  renderMode?: BrowserViewportRenderMode;
  onRenderMode?: (mode: BrowserViewportRenderMode) => void;
  readOnly?: boolean;
  readOnlyLabel?: string;
}

/** A real layout row: controls never cover pixels or change the remote scroll. */
export function BrowserViewportToolbar({
  mode,
  zoom,
  displayScale,
  onFit,
  onOriginal,
  onZoom,
  onZoomOut,
  onPan,
  renderMode,
  onRenderMode,
  readOnly,
  readOnlyLabel = '仅支持查看',
}: Props): JSX.Element {
  const selected = mode === 'contain' ? 'fit' : zoom === 1 ? 'original' : 'zoom';
  const segment = (active: boolean) =>
    cn(
      'h-7 gap-1 rounded-md px-2 text-[11px] shadow-none',
      active
        ? 'bg-[#FF0061] text-white hover:bg-[#FF0061]/90'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    );
  const iconButton = 'h-7 w-7 shrink-0 rounded-md p-0 text-muted-foreground';
  return (
    <div
      role="toolbar"
      aria-label="画面工具栏"
      className="flex h-10 min-w-0 shrink-0 items-center justify-between gap-1 border-b border-border/60 bg-white px-1.5 dark:bg-background"
    >
      <div className="inline-flex shrink-0 items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
        <Button
          type="button"
          variant="ghost"
          title="适应画面"
          aria-pressed={selected === 'fit'}
          className={segment(selected === 'fit')}
          onClick={onFit}
        >
          <Maximize2 className="!size-3" />
          适应
        </Button>
        <Button
          type="button"
          variant="ghost"
          title="按原尺寸显示"
          aria-pressed={selected === 'original'}
          className={segment(selected === 'original')}
          onClick={onOriginal}
        >
          100%
        </Button>
        <Button
          type="button"
          variant="ghost"
          title="放大画面"
          aria-pressed={selected === 'zoom'}
          className={segment(selected === 'zoom')}
          onClick={onZoom}
        >
          <ZoomIn className="!size-3" />
          放大
        </Button>
      </div>
      <output
        aria-label="画面缩放比例"
        className="min-w-8 shrink-0 text-center font-mono text-[10px] tabular-nums text-muted-foreground"
      >
        {Math.round(displayScale * 100)}%
      </output>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          aria-label="缩小画面"
          title="缩小画面"
          className={iconButton}
          disabled={mode === 'contain' || zoom <= 0.25}
          onClick={onZoomOut}
        >
          <Minus className="!size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label="平移画面"
              title="平移画面（本地显示）"
              className={iconButton}
              disabled={mode === 'contain'}
            >
              <Move className="!size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            {(
              [
                ['左', 80, 0],
                ['右', -80, 0],
                ['上', 0, 80],
                ['下', 0, -80],
              ] as const
            ).map(([label, x, y]) => (
              <DropdownMenuItem key={label} onSelect={() => onPan(x, y)}>
                平移画面{label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {onRenderMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="网页显示模式"
                title="网页显示模式"
                className="h-7 w-9 shrink-0 gap-0 rounded-md p-0 text-muted-foreground"
              >
                <Monitor className="!size-3.5" />
                <ChevronDown className="!size-2.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {(
                [
                  ['auto', '跟随面板比例'],
                  ['desktop', '桌面宽度 1280'],
                  ['panel', '按面板宽度渲染'],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenuItem key={value} onSelect={() => onRenderMode(value)}>
                  <Check className={cn('mr-2 size-3.5', renderMode !== value && 'invisible')} />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {readOnly && (
          <span
            role="img"
            aria-label={readOnlyLabel}
            title={readOnlyLabel}
            className="flex w-5 shrink-0 items-center justify-center text-muted-foreground"
          >
            <LockKeyhole className="size-3" />
          </span>
        )}
      </div>
    </div>
  );
}
