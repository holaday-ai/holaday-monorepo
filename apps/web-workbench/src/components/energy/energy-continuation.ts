import type { EnergyContentTarget } from './energy-content-target';
import type { EnergyCompletionKind } from './energy-progress';
import type { EnergyNeed } from './energy-types';

export interface EnergyContinuationRecommendation {
  target: EnergyContentTarget;
  label: string;
  reason: string;
}

interface RecommendationInput {
  energyNeed: EnergyNeed;
  completedKinds: EnergyCompletionKind[];
  lastCompletedKind: EnergyCompletionKind | null;
  unavailableTypes?: EnergyContentTarget['type'][];
}

const NEED_LABELS: Record<EnergyNeed, string> = {
  focus: '专注',
  relax: '放松',
  confidence: '自信',
  uplift: '好心情',
};

const KIND_ORDER: Record<EnergyNeed, EnergyCompletionKind[]> = {
  focus: ['recharge', 'test', 'game', 'tarot', 'horoscope'],
  relax: ['recharge', 'game', 'test', 'tarot', 'horoscope'],
  confidence: ['recharge', 'tarot', 'test', 'game', 'horoscope'],
  uplift: ['recharge', 'game', 'tarot', 'test', 'horoscope'],
};

export function recommendNextEnergyTarget({
  energyNeed,
  completedKinds,
  lastCompletedKind,
  unavailableTypes = [],
}: RecommendationInput): EnergyContinuationRecommendation | null {
  const completed = new Set(completedKinds);
  const unavailable = new Set(unavailableTypes);
  const nextKind = KIND_ORDER[energyNeed].find(
    (kind) =>
      !completed.has(kind) &&
      kind !== lastCompletedKind &&
      !unavailable.has(targetForKind(kind, energyNeed).type),
  );
  if (!nextKind) return null;

  const recommendation = recommendationForKind(nextKind, energyNeed);
  return {
    ...recommendation,
    reason: `因为你选择了${NEED_LABELS[energyNeed]}，${recommendation.reason}`,
  };
}

function recommendationForKind(
  kind: EnergyCompletionKind,
  need: EnergyNeed,
): EnergyContinuationRecommendation {
  if (kind === 'recharge') {
    const target = targetForKind(kind, need);
    return { target, label: '一分钟轻练习', reason: '下一步先让身体和注意力松开一点。' };
  }
  if (kind === 'test') {
    const target = targetForKind(kind, need);
    return {
      target,
      label: need === 'focus' ? '专注入口轻测试' : '一分钟轻测试',
      reason: '下一步用几个小问题看清现在的入口。',
    };
  }
  if (kind === 'game') {
    const target = targetForKind(kind, need);
    const label =
      target.type === 'game' && target.gameId === 'breath-rhythm'
        ? '呼吸节奏'
        : target.type === 'game' && target.gameId === 'color-memory'
          ? '颜色记忆'
          : '接住能量';
    return { target, label, reason: '下一步换一种短互动，让大脑轻轻转场。' };
  }
  if (kind === 'tarot') {
    return {
      target: targetForKind(kind, need),
      label: '单张能量牌',
      reason: '下一步带走一条可以马上使用的轻提示。',
    };
  }
  return {
    target: { type: 'astrology', period: 'daily' },
    label: '今日星座节奏',
    reason: '下一步看看今天更适合怎样安排节奏。',
  };
}

function targetForKind(kind: EnergyCompletionKind, need: EnergyNeed): EnergyContentTarget {
  if (kind === 'recharge') {
    return {
      type: 'practice',
      practiceId:
        need === 'focus'
          ? 'desk-reset'
          : need === 'relax'
            ? 'breath-window'
            : need === 'confidence'
              ? 'shoulder-release'
              : 'distance-gaze',
    };
  }
  if (kind === 'test') {
    return {
      type: 'test',
      testId:
        need === 'focus'
          ? 'work-focus'
          : need === 'relax'
            ? 'emotion-recovery'
            : need === 'confidence'
              ? 'stress-boundary'
              : 'social-recharge',
    };
  }
  if (kind === 'game') {
    return {
      type: 'game',
      gameId:
        need === 'relax' ? 'breath-rhythm' : need === 'uplift' ? 'color-memory' : 'catch-energy',
    };
  }
  if (kind === 'tarot') {
    return {
      type: 'tarot',
      mode: 'single',
      theme:
        need === 'confidence'
          ? 'confidence'
          : need === 'uplift'
            ? 'uplift'
            : need === 'relax'
              ? 'space'
              : 'work',
    };
  }
  return { type: 'astrology', period: 'daily' };
}
