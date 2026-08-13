import * as React from 'react';

export type EnergySectionId =
  | 'energy-recharge'
  | 'energy-play'
  | 'energy-astrology-world'
  | 'energy-today-content';

export interface EnergySectionLink {
  id: EnergySectionId;
  label: '补给' | '玩法' | '星座' | '今日内容';
}

export const ENERGY_SECTION_LINKS: readonly EnergySectionLink[] = [
  { id: 'energy-recharge', label: '补给' },
  { id: 'energy-play', label: '玩法' },
  { id: 'energy-astrology-world', label: '星座' },
  { id: 'energy-today-content', label: '今日内容' },
];

interface EnergySectionNavProps {
  sections: readonly EnergySectionLink[];
  onNavigate?: (sectionId: EnergySectionId) => void;
}

export function EnergySectionNav({
  sections,
  onNavigate = () => undefined,
}: EnergySectionNavProps): JSX.Element {
  const [activeId, setActiveId] = React.useState<EnergySectionId | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
      return;
    }
    const observer = new window.IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const id = visible?.target.id;
        if (isEnergySectionId(id)) setActiveId(id);
      },
      { rootMargin: '-20% 0px -62% 0px', threshold: [0.15, 0.45, 0.75] },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="energy-section-nav" aria-label="今日能量章节">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={activeId === section.id ? 'location' : undefined}
          onClick={() => {
            document.getElementById(section.id)?.scrollIntoView({
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
              block: 'start',
            });
            onNavigate(section.id);
          }}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function isEnergySectionId(value: string | undefined): value is EnergySectionId {
  return ENERGY_SECTION_LINKS.some((section) => section.id === value);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
