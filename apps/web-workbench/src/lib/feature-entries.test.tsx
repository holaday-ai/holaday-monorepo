// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { HiddenEntryGate } from '../App';
import {
  isAshareEntryEnabled,
  isDailyEnergyEntryEnabled,
  withoutHiddenEntrySkills,
} from './feature-entries';
import { filterSidebarFeatureNavItems } from './sidebar-feature-nav';

afterEach(() => cleanup());

/** Source-text checks must survive formatter line wrapping. */
const compact = (text: string) => text.replace(/\s+/g, '');
const source = (path: string) => compact(readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('HIDE-1: 「A 股」「今日能量」 entries hidden by default', () => {
  it('both flags are off unless the build sets them to "true"', () => {
    expect(isAshareEntryEnabled({})).toBe(false);
    expect(isAshareEntryEnabled({ VITE_FEATURE_ASHARE_ENTRY: 'false' })).toBe(false);
    expect(isAshareEntryEnabled({ VITE_FEATURE_ASHARE_ENTRY: 'true' })).toBe(true);
    expect(isDailyEnergyEntryEnabled({})).toBe(false);
    expect(isDailyEnergyEntryEnabled({ VITE_FEATURE_DAILY_ENERGY_ENTRY: 'true' })).toBe(true);
    // The test build sets neither.
    expect(isAshareEntryEnabled()).toBe(false);
    expect(isDailyEnergyEntryEnabled()).toBe(false);
  });

  it('the sidebar drops 股市任务 and 今日能量; the other entries stay', () => {
    const items = [
      { label: '技能', href: '/skills' },
      { label: '股市任务', href: '/stocks' },
      { label: '今日能量', href: '/cosmic' },
      { label: '视频任务', href: '/video' },
    ];
    expect(
      filterSidebarFeatureNavItems(items, { cosmicEnabled: false, ashareEnabled: false }).map(
        (item) => item.href,
      ),
    ).toEqual(['/skills', '/video']);
    expect(
      filterSidebarFeatureNavItems(items, { cosmicEnabled: true, ashareEnabled: true }).map(
        (item) => item.href,
      ),
    ).toEqual(['/skills', '/stocks', '/cosmic', '/video']);
    // The sidebar reads the HIDE-1 flags (not the old cosmic flag alone).
    const sidebar = source('../components/Sidebar.tsx');
    expect(sidebar).toContain('cosmicEnabled:isDailyEnergyEntryEnabled()');
    expect(sidebar).toContain('ashareEnabled:isAshareEntryEnabled()');
  });

  it('a deep link to a hidden entry goes back to the home page, without loading it', () => {
    const at = (path: string, enabled: boolean) =>
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<p>home</p>} />
            <Route
              path="/stocks"
              element={
                <HiddenEntryGate enabled={enabled}>
                  <p>stocks page</p>
                </HiddenEntryGate>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    const hidden = at('/stocks', false);
    expect(hidden.getByText('home')).toBeTruthy();
    expect(hidden.queryByText('stocks page')).toBeNull();
    cleanup();
    expect(at('/stocks', true).getByText('stocks page')).toBeTruthy();
    // Every hidden route is gated: /stocks, /stocks/discovery, /cosmic, /cosmic-preview.
    const app = source('../App.tsx');
    for (const [path, flag] of [
      ['/stocks', 'isAshareEntryEnabled'],
      ['/stocks/discovery', 'isAshareEntryEnabled'],
      ['/cosmic', 'isDailyEnergyEntryEnabled'],
      ['/cosmic-preview', 'isDailyEnergyEntryEnabled'],
    ])
      expect(app).toContain(`path="${path}"element={<HiddenEntryGateenabled={${flag}()}>`);
  });

  it('the A-share skill card is hidden from the skills page and the composer; others stay', () => {
    const skills = [{ id: 'a-share-market-briefing' }, { id: 'contract-risk-review' }];
    expect(withoutHiddenEntrySkills(skills, false).map((skill) => skill.id)).toEqual([
      'contract-risk-review',
    ]);
    expect(withoutHiddenEntrySkills(skills, true)).toHaveLength(2);
    expect(source('../pages/SkillsPage.tsx')).toContain(
      'withoutHiddenEntrySkills(normalizeSkillRows(awaittrpc.skills.list.query()))',
    );
    expect(source('../components/InputArea.tsx')).toContain(
      'withoutHiddenEntrySkills(normalizeSkillRows(rows))',
    );
  });

  it('the daily A-share briefing setting is not shown or read while hidden', () => {
    const settings = source('../components/notifications/NotificationsSection.tsx');
    expect(settings).toContain('constshowBriefing=isAshareEntryEnabled();');
    expect(settings).toContain('{showBriefing&&(<Rowlabel="每日A股简报"');
    expect(settings).toContain('if(isAshareEntryEnabled())void(async()=>{');
  });
});
