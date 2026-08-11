import * as React from 'react';
import { periodSections } from './astrology-content';
import type { EnergyPeriodReading } from './useEnergyAstrology';

interface AstrologyDimensionGridProps {
  reading: EnergyPeriodReading;
}

export function AstrologyDimensionGrid({ reading }: AstrologyDimensionGridProps): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const sections = periodSections(reading);
  const visibleSections = expanded ? sections : sections.slice(0, 3);

  return (
    <section className="energy-astrology-dimensions" aria-label="六维星座提示">
      <div className="energy-astrology-dimensions__grid">
        {visibleSections.map((dimension) => (
          <article key={dimension.key}>
            <header>
              <h4>{dimension.label}</h4>
              {dimension.score === null ? null : <span>{dimension.score}%</span>}
            </header>
            <p>{dimension.body}</p>
          </article>
        ))}
      </div>
      {sections.length > 3 ? (
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起六项提示' : '展开全部六项'}
        </button>
      ) : null}
    </section>
  );
}
