import * as React from 'react';
import type { EnergyGameId } from '../energy-content-target';
import type { ExperiencePhase } from '../energy-types';
import { gameById } from './game-content';
import { BreathRhythmGame } from './games/BreathRhythmGame';
import { CatchEnergyGame } from './games/CatchEnergyGame';
import { ColorMemoryGame } from './games/ColorMemoryGame';

interface GameExperienceProps {
  initialGameId: EnergyGameId;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete: () => void;
}

export function GameExperience({
  initialGameId,
  phase,
  onPhaseChange,
  onComplete,
}: GameExperienceProps): JSX.Element {
  const game = gameById(initialGameId);
  const completedRef = React.useRef(false);

  React.useEffect(() => {
    if (phase === 'active') completedRef.current = false;
  }, [initialGameId, phase]);

  const complete = (): void => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
    onPhaseChange('result');
  };

  if (phase === 'result') {
    return (
      <div className="energy-game-result" aria-live="polite">
        <img src="/energy/mini-game.jpg" alt="" aria-hidden="true" />
        <h3>{game.completionTitle}</h3>
        <p>{game.completionBody}</p>
      </div>
    );
  }

  if (initialGameId === 'breath-rhythm') {
    return <BreathRhythmGame onComplete={complete} reducedMotion={prefersReducedMotion()} />;
  }
  if (initialGameId === 'color-memory') {
    return <ColorMemoryGame onComplete={complete} />;
  }
  return <CatchEnergyGame onComplete={complete} />;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
