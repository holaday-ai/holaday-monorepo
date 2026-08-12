import type {
  EnergyContentTarget,
  EnergyExperienceLaunchTarget,
} from './energy-content-target';
import type { EnergyAstrologyPeriod, EnergyExperienceId } from './energy-types';

export type EnergyTargetCommand =
  | {
      type: 'experience';
      experienceId: EnergyExperienceId;
      launchTarget: EnergyExperienceLaunchTarget;
    }
  | { type: 'astrology'; period: EnergyAstrologyPeriod }
  | { type: 'astrology-signs' };

export function resolveEnergyContentTarget(target: EnergyContentTarget): EnergyTargetCommand {
  switch (target.type) {
    case 'practice':
      return { type: 'experience', experienceId: 'practice', launchTarget: target };
    case 'poll':
      return { type: 'experience', experienceId: 'poll', launchTarget: target };
    case 'test':
      return { type: 'experience', experienceId: 'light-test', launchTarget: target };
    case 'tarot':
      return { type: 'experience', experienceId: 'tarot', launchTarget: target };
    case 'game':
      return { type: 'experience', experienceId: 'games', launchTarget: target };
    case 'astrology':
      return { type: 'astrology', period: target.period };
    case 'astrology-signs':
      return { type: 'astrology-signs' };
    default:
      return assertNever(target);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported energy target: ${JSON.stringify(value)}`);
}
