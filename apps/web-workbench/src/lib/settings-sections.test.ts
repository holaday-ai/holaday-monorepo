import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SECTIONS,
  normaliseSettingsHash,
  settingsSectionHref,
} from './settings-sections';

describe('settings sections', () => {
  it('keeps stable ids for settings deep links', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      'appearance',
      'roles',
      'api-keys',
      'memory',
      'notifications',
      'account',
    ]);
  });

  it('normalises only known settings hashes', () => {
    expect(normaliseSettingsHash('#api-keys')).toBe('api-keys');
    expect(normaliseSettingsHash('notifications')).toBe('notifications');
    expect(normaliseSettingsHash('#billing')).toBeNull();
  });

  it('builds same-page section hrefs', () => {
    expect(settingsSectionHref('memory')).toBe('/settings#memory');
  });
});
