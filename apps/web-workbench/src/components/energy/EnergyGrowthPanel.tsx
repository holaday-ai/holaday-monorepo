import { Flame, FlaskConical, Gamepad2, MoonStar, Sparkles, Star, Zap } from 'lucide-react';
import { type EnergyCompletionKind, type EnergyProgress, energyStreak } from './energy-progress';

interface EnergyGrowthPanelProps {
  progress: EnergyProgress;
}

const NODES: Array<{
  kind: EnergyCompletionKind;
  label: string;
  icon: typeof Zap;
}> = [
  { kind: 'recharge', label: '补给', icon: Zap },
  { kind: 'tarot', label: '抽卡', icon: MoonStar },
  { kind: 'game', label: '游戏', icon: Gamepad2 },
  { kind: 'test', label: '测试', icon: FlaskConical },
  { kind: 'horoscope', label: '星座', icon: Star },
];

export function EnergyGrowthPanel({ progress }: EnergyGrowthPanelProps): JSX.Element {
  const streak = energyStreak(progress);
  return (
    <section className="energy-growth-panel" aria-label="今日能量成长">
      <img src="/energy/energy-capsules.jpg" alt="" aria-hidden="true" />
      <div className="energy-growth-panel__heading">
        <div>
          <p className="energy-kicker">只记录完成，不记录答案</p>
          <h2>今日能量成长</h2>
        </div>
        <span>
          <Flame aria-hidden="true" />
          连续 {streak} 天
        </span>
      </div>
      <div className="energy-growth-panel__score">
        <strong>{progress.collectedKinds.length}</strong>
        <span>/ {NODES.length} 枚今日能量</span>
      </div>
      <div className="energy-growth-nodes">
        {NODES.map((node) => {
          const Icon = node.icon;
          const collected = progress.collectedKinds.includes(node.kind);
          return (
            <span key={node.kind} data-collected={collected ? 'true' : 'false'}>
              <span className="energy-growth-node__icon" aria-hidden="true">
                {collected ? <Sparkles /> : <Icon />}
              </span>
              {node.label}
            </span>
          );
        })}
      </div>
      <p>每完成一种体验，就点亮一枚能量。情绪、测试答案和问题正文都不会进入记录。</p>
    </section>
  );
}
