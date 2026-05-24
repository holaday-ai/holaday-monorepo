export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: '外观' },
  { id: 'roles', label: 'AI 视角' },
  { id: 'api-keys', label: 'API Key' },
  { id: 'memory', label: 'AI 记忆' },
  { id: 'notifications', label: '通知' },
  { id: 'account', label: '账号' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

const IDS = new Set<string>(SETTINGS_SECTIONS.map((section) => section.id));

export function normaliseSettingsHash(hash: string): SettingsSectionId | null {
  const id = hash.replace(/^#/, '');
  return IDS.has(id) ? (id as SettingsSectionId) : null;
}

export function settingsSectionHref(id: SettingsSectionId): string {
  return `/settings#${id}`;
}
