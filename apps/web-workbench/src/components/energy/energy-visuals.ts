export type EnergyVisualTone = 'peach' | 'lavender' | 'sky' | 'mint' | 'sun';
export type EnergyVisualIcon =
  | 'book'
  | 'brain'
  | 'briefcase'
  | 'clock'
  | 'gamepad'
  | 'heart'
  | 'palette'
  | 'shuffle'
  | 'sparkles'
  | 'user'
  | 'wind';

export interface EnergyVisualDefinition {
  tone: EnergyVisualTone;
  icon: EnergyVisualIcon;
  imageSrc: string;
}

const DIMENSION_VISUALS: Record<string, Omit<EnergyVisualDefinition, 'imageSrc'>> = {
  personal: { tone: 'lavender', icon: 'user' },
  health: { tone: 'mint', icon: 'heart' },
  profession: { tone: 'peach', icon: 'briefcase' },
  emotions: { tone: 'lavender', icon: 'sparkles' },
  travel: { tone: 'sky', icon: 'shuffle' },
  luck: { tone: 'sun', icon: 'sparkles' },
};

export function dimensionVisualFor(
  key: string,
): Omit<EnergyVisualDefinition, 'imageSrc'> {
  return DIMENSION_VISUALS[key] ?? { tone: 'lavender', icon: 'sparkles' };
}
