import { Zap } from 'lucide-react';
import * as React from 'react';

interface CatchEnergyGameProps {
  onComplete: () => void;
}

const TOTAL_ROUNDS = 12;
const ROUND_MARKERS = Array.from({ length: TOTAL_ROUNDS }, (_, index) => ({
  id: `energy-round-${index + 1}`,
  index,
}));

export function CatchEnergyGame({ onComplete }: CatchEnergyGameProps): JSX.Element {
  const [hits, setHits] = React.useState(0);
  const round = hits + 1;
  const lane = (hits * 5 + 2) % 6;

  return (
    <div className="energy-game-flow">
      <div className="energy-game-heading">
        <div>
          <p className="energy-kicker">接住能量</p>
          <h3>跟着光点换换注意力</h3>
        </div>
        <strong aria-live="polite">{hits} / {TOTAL_ROUNDS}</strong>
      </div>
      <p>点击光点，或聚焦后按 Enter / Space。没有倒计时，也没有排名。</p>
      <div className="energy-game-board" data-lane={lane}>
        <button
          key={round}
          type="button"
          className="energy-game-target"
          aria-label={`接住第 ${round} 个能量光点`}
          title={`接住第 ${round} 个能量光点`}
          data-lane={lane}
          onClick={() => {
            const nextHits = Math.min(TOTAL_ROUNDS, hits + 1);
            setHits(nextHits);
            if (nextHits === TOTAL_ROUNDS) onComplete();
          }}
        >
          <Zap aria-hidden="true" />
        </button>
      </div>
      <div className="energy-game-dots" aria-hidden="true">
        {ROUND_MARKERS.map((marker) => (
          <span key={marker.id} data-lit={marker.index < hits ? 'true' : 'false'} />
        ))}
      </div>
    </div>
  );
}
