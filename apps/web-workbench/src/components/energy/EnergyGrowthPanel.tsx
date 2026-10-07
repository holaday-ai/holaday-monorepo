import { Flame, FlaskConical, Gamepad2, MoonStar, Star, Zap } from 'lucide-react';
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
        {NODES.map((node, index) => {
          const collected = progress.collectedKinds.includes(node.kind);
          return (
            <span key={node.kind} data-collected={collected ? 'true' : 'false'}>
              <span className="energy-approved-bottle" style={{ backgroundPosition: `${25 - [148, 278, 405, 536, 665][index] / 2}px -91px` }} aria-hidden="true" />
              {node.label}
            </span>
          );
        })}
      </div>
      <p>每完成一种体验，就点亮一枚能量。情绪、测试答案和问题正文都不会进入记录。</p>
    </section>
  );
}
