export type AstrologyCapability =
  | 'daily-horoscope'
  | 'weekly-horoscope'
  | 'monthly-horoscope'
  | 'yearly-horoscope'
  | 'translator'
  | 'chinese-horoscope'
  | 'numerology-horoscope'
  | 'daily-tarot'
  | 'yes-no-tarot'
  | 'past-present-future-tarot';

export type ProviderCapabilityReason =
  | 'not-configured'
  | 'not-authorized'
  | 'invalid-response'
  | 'provider-unavailable';

export interface ProviderCapabilityState {
  capability: AstrologyCapability;
  available: boolean;
  checkedAt: string;
  reason?: ProviderCapabilityReason;
}

const KNOWN_CAPABILITIES: readonly AstrologyCapability[] = [
  'daily-horoscope',
  'weekly-horoscope',
  'monthly-horoscope',
  'yearly-horoscope',
  'translator',
  'chinese-horoscope',
  'numerology-horoscope',
  'daily-tarot',
  'yes-no-tarot',
  'past-present-future-tarot',
];

const KNOWN_CAPABILITY_SET = new Set<string>(KNOWN_CAPABILITIES);

export class DivineApiContractError extends Error {
  constructor(public readonly reason: ProviderCapabilityReason) {
    super(`DivineAPI ${reason}`);
    this.name = 'DivineApiContractError';
  }
}

export function readConfiguredCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): Set<AstrologyCapability> {
  const configured = env.DIVINE_API_CAPABILITIES?.split(',') ?? [];
  return new Set(
    configured
      .map((value) => value.trim())
      .filter((value): value is AstrologyCapability => KNOWN_CAPABILITY_SET.has(value)),
  );
}

export function assertDivineApiSuccess(
  json: unknown,
  requiredPaths: ReadonlyArray<ReadonlyArray<string>>,
): Record<string, unknown> {
  if (!json || typeof json !== 'object') {
    throw new DivineApiContractError('invalid-response');
  }

  const envelope = json as Record<string, unknown>;
  if (envelope.success !== 1) {
    const message = typeof envelope.msg === 'string' ? envelope.msg : '';
    throw new DivineApiContractError(
      /not authorized|unauthorized|not allowed|access denied/i.test(message)
        ? 'not-authorized'
        : 'invalid-response',
    );
  }

  for (const path of requiredPaths) {
    let value: unknown = envelope;
    for (const key of path) {
      if (!value || typeof value !== 'object' || !(key in value)) {
        throw new DivineApiContractError('invalid-response');
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (value === null || value === undefined) {
      throw new DivineApiContractError('invalid-response');
    }
  }

  const data = envelope.data;
  if (!data || typeof data !== 'object') {
    throw new DivineApiContractError('invalid-response');
  }
  return data as Record<string, unknown>;
}

export function allAstrologyCapabilities(): readonly AstrologyCapability[] {
  return KNOWN_CAPABILITIES;
}
