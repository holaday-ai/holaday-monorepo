import {
  type AstroDay,
  type AstroProfile,
  type AstroReading,
  zodiacOptions,
} from '@/lib/astrology';

export interface NatalSnapshot {
  title: string;
  body: string;
  items: Array<{ label: string; value: string; body: string }>;
  longTermAdvice: string;
}

export interface TransitSnapshot {
  title: string;
  body: string;
  strongest: AstroDay[];
  weekly: AstroDay[];
}

export function buildNatalSnapshot(profile: AstroProfile, reading: AstroReading): NatalSnapshot {
  const seed = localSeed(`${profile.birthday}-${profile.birthTime}-${profile.birthPlace}`);
  const signs = zodiacOptions();
  const moon = signs[(seed + 3) % signs.length] ?? signs[0];
  const rising = profile.birthTime
    ? (signs[(seed + Number(profile.birthTime.replace(':', ''))) % signs.length] ?? signs[0])
    : null;
  const element = pickLocal(seed, ['火象行动力', '土象稳定感', '风象连接力', '水象感受力']);
  const mode = pickLocal(seed + 7, ['启动型', '固定型', '变动型']);
  return {
    title: `${reading.zodiacLabel} 的任务档案：${reading.focusMode}`,
    body: `你的长期节奏适合先抓「${reading.mood}」这条主线。今天可以用 ${reading.luckyColor} 或 ${reading.luckyWindow} 作为进入状态的小锚点。`,
    items: [
      {
        label: '太阳星座',
        value: reading.zodiacLabel,
        body: `外在行动主题是「${reading.mood}」，适合用明确目标推进任务。`,
      },
      {
        label: '月亮倾向',
        value: moon?.label ?? reading.zodiacLabel,
        body: '代表情绪恢复方式；等待任务时更适合先照顾状态，再处理判断。',
      },
      {
        label: '上升倾向',
        value: rising?.label ?? '待补充出生时间',
        body: rising ? '代表你进入新任务时给人的第一印象。' : '补充出生时间后，这项会更准确。',
      },
      {
        label: '元素 / 模式',
        value: `${element} · ${mode}`,
        body: `适合把任务拆成「${reading.focusMode}」的小节奏，减少临场消耗。`,
      },
    ],
    longTermAdvice: `长期不必追求一直高能量。用「${reading.focusMode}」作为开始方式，给任务留出调整和恢复的空格。`,
  };
}

export function buildTransitSnapshot(reading: AstroReading): TransitSnapshot {
  const weekly = reading.weekly.map((day) => ({ ...day }));
  const strongest = [...weekly].sort((first, second) => second.energy - first.energy).slice(0, 3);
  return {
    title: '这一周，哪里更适合用力',
    body: `今天先按「${reading.focusMode}」推进，重要动作适合放在 ${reading.luckyWindow} 前后。`,
    strongest,
    weekly,
  };
}

function localSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickLocal<T>(seed: number, values: readonly [T, ...T[]]): T {
  return values[seed % values.length] ?? values[0];
}
