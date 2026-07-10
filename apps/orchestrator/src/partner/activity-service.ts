const ACTIVITY_BASE_FACTOR_BPS = 10_000;
const ACTIVITY_MAX_FACTOR_BPS = 11_000;

function normalizeActivityCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

export function calculateActivityFactorBps(input: {
  loginDays: number;
  completedTasks: number;
  validInvites: number;
}): number {
  const loginDays = normalizeActivityCount(input.loginDays);
  const completedTasks = normalizeActivityCount(input.completedTasks);
  const validInvites = normalizeActivityCount(input.validInvites);
  const loginBoost = Math.min(300, loginDays * 100);
  const taskBoost = Math.min(400, completedTasks * 100);
  const inviteBoost = Math.min(300, validInvites * 300);
  return Math.min(ACTIVITY_MAX_FACTOR_BPS, ACTIVITY_BASE_FACTOR_BPS + loginBoost + taskBoost + inviteBoost);
}

export class PartnerActivityService {
  async getActivityFactorBps(_userId: number, _at: Date): Promise<number> {
    return ACTIVITY_BASE_FACTOR_BPS;
  }
}
