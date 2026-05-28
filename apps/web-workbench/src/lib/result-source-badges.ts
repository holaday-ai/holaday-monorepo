export type ResultSourceMarker =
  | '[用户提供]'
  | '[系统计算]'
  | '[模型假设]'
  | '[外部来源]';

export interface ResultSourceBadgeMeta {
  readonly label: string;
  readonly tone: string;
}

export const RESULT_SOURCE_BADGES: Record<ResultSourceMarker, ResultSourceBadgeMeta> = {
  '[用户提供]': {
    label: '用户提供',
    tone: 'border-[#42C0EF]/55 bg-[#42C0EF]/10 text-[#595757] dark:border-[#42C0EF]/40 dark:bg-[#42C0EF]/10 dark:text-foreground',
  },
  '[系统计算]': {
    label: '系统计算',
    tone: 'border-[#57479C]/40 bg-[#57479C]/10 text-[#57479C] dark:border-[#57479C]/45 dark:bg-[#57479C]/15 dark:text-foreground',
  },
  '[模型假设]': {
    label: '模型假设',
    tone: 'border-[#FFC910]/60 bg-[#FFC910]/10 text-[#595757] dark:border-[#FFC910]/40 dark:bg-[#FFC910]/10 dark:text-foreground',
  },
  '[外部来源]': {
    label: '外部基准',
    tone: 'border-[#EA1F59]/35 bg-[#EA1F59]/5 text-[#EA1F59] dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10',
  },
};

const LEGACY_SOURCE_BADGES: readonly {
  readonly marker: string;
  readonly replacement: ResultSourceMarker;
}[] = [
  { marker: '\u{1F7E2}', replacement: '[用户提供]' },
  { marker: '\u{1F535}', replacement: '[系统计算]' },
  { marker: '\u{1F7E1}', replacement: '[模型假设]' },
  { marker: '\u{1F534}', replacement: '[外部来源]' },
];

export function matchResultSourceBadgePrefix(
  text: string,
): { marker: ResultSourceMarker; rest: string } | null {
  for (const marker of Object.keys(RESULT_SOURCE_BADGES) as ResultSourceMarker[]) {
    if (text.startsWith(marker)) {
      return { marker, rest: text.slice(marker.length).replace(/^\s+/, '') };
    }
  }
  for (const legacy of LEGACY_SOURCE_BADGES) {
    if (text.startsWith(legacy.marker)) {
      return {
        marker: legacy.replacement,
        rest: text.slice(legacy.marker.length).replace(/^\s+/, ''),
      };
    }
  }
  return null;
}
