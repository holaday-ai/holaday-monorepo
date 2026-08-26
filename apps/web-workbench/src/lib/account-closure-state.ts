import { clearAllEnergyProgressForCurrentDevice } from '@/components/energy/energy-progress';
import { clearAllAstroProfilesForCurrentDevice } from '@/lib/astrology';
import { clearAccessToken, clearMfaChallenge } from '@/lib/auth';
import { disconnect } from '@/lib/ws';
import { useTaskStore } from '@/stores/task-store';

export type ClosureRequestStatus = 'pending_grace' | 'processing' | 'needs_attention' | 'completed';

export interface ClosureStatusSnapshot {
  requestStatus: ClosureRequestStatus;
  requestedAt: string;
  graceEndsAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  canCancel: boolean;
  plan: { name: string; expiresAt: string | null };
  mfaRequired: boolean;
}

export type ClosureRecoveryView =
  | { kind: 'grace'; graceEndsAt: string; receiptNumber: string; canCancel: true }
  | { kind: 'processing'; receiptNumber: string; canCancel: false }
  | { kind: 'attention'; receiptNumber: string; canCancel: false }
  | { kind: 'completed'; receiptNumber: string; canCancel: false };

const CLOSURE_CATEGORY_LABELS: Record<string, string> = {
  account_security: '账号与安全',
  task_execution: '任务与执行记录',
  cross_task_memory: '跨任务记忆',
  energy_astrology_profile: '今日能量与星座资料',
  stock_preference_profile: '股票偏好',
  feedback_support: '反馈与支持记录',
  external_notifications: '外部通知',
  extension_site_stats: '扩展站点统计',
  extension_login_cookies: '扩展登录数据',
  payments_entitlements: '支付、退款与必要账务',
  partner_kyc_ledger: '合作方 KYC 与账本',
  media_assets: '媒体与必要授权证明',
  analytics_logs: '必要安全审计',
};

export function closureCategoryLabel(categoryId: string): string {
  return CLOSURE_CATEGORY_LABELS[categoryId] ?? '其他受治理数据';
}

export function toClosureRecoveryView(
  status: ClosureStatusSnapshot,
  receiptNumber: string,
): ClosureRecoveryView {
  if (status.requestStatus === 'pending_grace' && status.canCancel) {
    return {
      kind: 'grace',
      graceEndsAt: status.graceEndsAt,
      receiptNumber,
      canCancel: true,
    };
  }
  const kind =
    status.requestStatus === 'needs_attention'
      ? 'attention'
      : status.requestStatus === 'completed'
        ? 'completed'
        : 'processing';
  return { kind, receiptNumber, canCancel: false };
}

export function closureCountdownLabel(graceEndsAt: string, now = new Date()): string {
  const remainingMs = new Date(graceEndsAt).getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '已进入处理阶段';
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [days > 0 ? `${days}天` : '', hours > 0 ? `${hours}小时` : '', `${minutes}分`];
  return parts.filter(Boolean).join(' ');
}

export function clearCurrentDeviceClosureData(): void {
  clearAccessToken();
  clearMfaChallenge();
  disconnect();
  useTaskStore.getState().reset();
  clearAllAstroProfilesForCurrentDevice();
  clearAllEnergyProgressForCurrentDevice();
  removeSessionDataExceptRecovery();
}

function removeSessionDataExceptRecovery(): void {
  if (typeof window === 'undefined') return;
  const recoveryKey = 'holaday.closure_recovery';
  const keys: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key && key !== recoveryKey) keys.push(key);
  }
  for (const key of keys) window.sessionStorage.removeItem(key);
}
