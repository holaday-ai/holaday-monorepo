import type { EnergyGameId } from '../energy-content-target';

export interface EnergyGameDefinition {
  id: EnergyGameId;
  title: string;
  description: string;
  estimatedSeconds: number;
  completionTitle: string;
  completionBody: string;
}

export const ENERGY_GAMES: readonly EnergyGameDefinition[] = [
  {
    id: 'catch-energy',
    title: '接住能量',
    description: '用十二次轻点把注意力带回当下',
    estimatedSeconds: 45,
    completionTitle: '能量收集完成',
    completionBody: '你刚刚完成了一次短暂的注意力切换。带着这点轻盈，再回到今天。',
  },
  {
    id: 'breath-rhythm',
    title: '呼吸节奏',
    description: '按自己的速度完成四轮吸气与呼气',
    estimatedSeconds: 60,
    completionTitle: '四轮呼吸完成',
    completionBody: '不必改变所有感受，只要让下一次呼吸比刚才更有空间。',
  },
  {
    id: 'color-memory',
    title: '颜色记忆',
    description: '观察颜色与形状，再按顺序轻轻点回去',
    estimatedSeconds: 60,
    completionTitle: '颜色记忆完成',
    completionBody: '你用三轮短记忆把注意力从等待里带了回来，现在可以轻松转场。',
  },
] as const;

export function gameById(id: EnergyGameId): EnergyGameDefinition {
  const game = ENERGY_GAMES.find((item) => item.id === id);
  if (!game) throw new Error(`Unknown energy game: ${id}`);
  return game;
}
