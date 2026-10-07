import {
  BookOpenText,
  Brain,
  BriefcaseBusiness,
  Clock3,
  Gamepad2,
  HeartHandshake,
  Palette,
  Shuffle,
  Sparkles,
  UserRound,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';
import { periodSections } from './astrology-content';
import { DIMENSION_MAGAZINE_ART } from './energy-magazine-visuals';
import { type EnergyVisualIcon, dimensionVisualFor } from './energy-visuals';
import type { EnergyPeriodReading } from './useEnergyAstrology';

interface AstrologyDimensionGridProps {
  reading: EnergyPeriodReading;
}

const ICON_COMPONENTS: Record<EnergyVisualIcon, LucideIcon> = {
  book: BookOpenText,
  brain: Brain,
  briefcase: BriefcaseBusiness,
  clock: Clock3,
  gamepad: Gamepad2,
  heart: HeartHandshake,
  palette: Palette,
  shuffle: Shuffle,
  sparkles: Sparkles,
  user: UserRound,
  wind: Wind,
};

export function AstrologyDimensionGrid({ reading }: AstrologyDimensionGridProps): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const [openDimensionKey, setOpenDimensionKey] = React.useState<string | null>(null);
  const sections = periodSections(reading);
  const [revealed, setRevealed] = React.useState(false);

  const renderDimension = (dimension: (typeof sections)[number]) => {
          const visual = dimensionVisualFor(dimension.key);
          const Icon = ICON_COMPONENTS[visual.icon];
          return (
            <article key={dimension.key} data-dimension={dimension.key} data-tone={visual.tone}>
              <div className="energy-astrology-dimension__art">
                <img
                  data-dimension-art
                  src={DIMENSION_MAGAZINE_ART[dimension.key]}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              </div>
              <header>
                <span
                  className="energy-astrology-dimension__icon"
                  data-icon={visual.icon}
                  aria-hidden="true"
                >
                  <Icon />
                </span>
                <h4>{dimension.label}</h4>
                {dimension.score === null ? null : <span>{dimension.score}%</span>}
              </header>
              <DimensionText open={openDimensionKey === dimension.key} body={dimension.body} />
              <button
                type="button"
                aria-label={`${openDimensionKey === dimension.key ? '收起' : '展开'}${dimension.label}完整提示`}
                title={`${openDimensionKey === dimension.key ? '收起' : '展开'}${dimension.label}完整提示`}
                onClick={() =>
                  setOpenDimensionKey((current) =>
                    current === dimension.key ? null : dimension.key,
                  )
                }
              >
                {openDimensionKey === dimension.key ? '收起完整提示' : '展开完整提示'}
              </button>
            </article>
          );
        };
  return (
    <section className="energy-astrology-dimensions" aria-label="六维星座提示">
      <div className="energy-astrology-dimensions__grid">{sections.slice(0, 3).map(renderDimension)}</div>
      <div className="energy-dimensions-fold" data-open={expanded} aria-hidden={!expanded} {...(!expanded ? { inert: '' } : {})}>
        <div><div className="energy-astrology-dimensions__grid">{revealed && sections.slice(3).map(renderDimension)}</div></div>
      </div>
      {sections.length > 3 ? (
        <button type="button" aria-expanded={expanded} onClick={() => { setRevealed(true); setExpanded((value) => !value); }}>
          {expanded ? '收起六项提示' : '展开全部六项'}
        </button>
      ) : null}
    </section>
  );
}

/** A single text node, measured at its actual width, prevents duplicated summaries. */
function DimensionText({ open, body }: { open: boolean; body: string }): JSX.Element {
  const text = React.useRef<HTMLParagraphElement>(null);
  const [height, setHeight] = React.useState<number>();
  React.useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 23.4;
      setHeight(open ? element.scrollHeight : Math.min(element.scrollHeight, lineHeight * 2));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [open, body]);
  return <div className="energy-dimension-text" data-open={open} style={{ height }}>
    <p ref={text} data-dimension-body={open ? true : undefined}>{body}</p>
  </div>;
}
