import type { UiAwaitingUser } from '@/types/task';

export type AwaitingKind = NonNullable<UiAwaitingUser['awaitingKind']>;

export interface AwaitingUserCopy {
  title: string;
  streamBody: string;
  streamHint: string;
  panelTitle: string;
  panelBody: string;
  toolbarLabel: string;
  composerPlaceholder: string;
}

export interface AwaitingUserStreamMessage {
  body: string;
  followUp: string | null;
}

const COPY_BY_KIND: Record<AwaitingKind, AwaitingUserCopy> = {
  login: {
    title: '需要登录',
    streamBody: '请打开浏览器完成登录或扫码，完成后任务会继续，不用重新提交。',
    streamHint: '打开浏览器完成登录',
    panelTitle: '需要登录',
    panelBody: '交互模式已开启。完成登录或扫码后，HOLA DAY 会继续执行，不用重新提交任务。',
    toolbarLabel: '需要登录',
    composerPlaceholder: '登录完成后可在这里补充说明...',
  },
  captcha: {
    title: '需要验证',
    streamBody: '请打开浏览器完成验证码或滑块，完成后任务会继续，不用重新提交。',
    streamHint: '打开浏览器通过验证',
    panelTitle: '需要验证',
    panelBody: '交互模式已开启。完成验证码或滑块后，HOLA DAY 会继续执行，不用重新提交任务。',
    toolbarLabel: '需要验证',
    composerPlaceholder: '验证完成后可在这里补充说明...',
  },
  clarification: {
    title: '需要你补充信息',
    streamBody: '需要更多信息才能继续。',
    streamHint: '在下方输入框回答',
    panelTitle: '需要补充信息',
    panelBody: '请回到输入框补充信息，任务会继续，不用重新提交任务。',
    toolbarLabel: '需要你回复',
    composerPlaceholder: '回答 HOLA DAY 的问题...',
  },
  permission: {
    title: '需要权限',
    streamBody: '当前页面拒绝访问。请确认账号权限，或在下方输入框提供公开来源后继续。',
    streamHint: '授权或提供替代来源',
    panelTitle: '需要权限',
    panelBody: '当前页面拒绝访问。请确认账号权限，或换一个公开来源后回复继续，不用重新提交任务。',
    toolbarLabel: '需要权限',
    composerPlaceholder: '说明已授权，或提供可访问的替代来源...',
  },
  browser_action: {
    title: '等待你确认',
    streamBody: '请打开浏览器检查当前页面。确认无误后在下方回复继续；涉及提交、支付、发送、删除或退订时，HOLA DAY 不会替你点最终确认。',
    streamHint: '打开浏览器确认下一步',
    panelTitle: '等待你确认',
    panelBody: '交互模式已开启。请检查当前页面并回复继续；涉及提交、支付、发送、删除或退订时，最终确认由你手动完成。',
    toolbarLabel: '需要确认',
    composerPlaceholder: '确认无误后回复继续，或说明要调整的地方...',
  },
};

export function normalizeAwaitingKind(
  kind: UiAwaitingUser['awaitingKind'] | undefined,
): AwaitingKind {
  return kind ?? 'clarification';
}

export function awaitingUserCopy(
  kind: UiAwaitingUser['awaitingKind'] | undefined,
): AwaitingUserCopy {
  return COPY_BY_KIND[normalizeAwaitingKind(kind)];
}

export function awaitingUserStreamMessage(
  kind: UiAwaitingUser['awaitingKind'] | undefined,
  question: string | null | undefined,
): AwaitingUserStreamMessage {
  const normalized = normalizeAwaitingKind(kind);
  const copy = awaitingUserCopy(normalized);
  const trimmedQuestion = question?.trim();
  if (normalized === 'clarification' && trimmedQuestion) {
    return {
      body: trimmedQuestion,
      followUp: '在下方输入框回答，任务会继续，不用重新提交。',
    };
  }
  if (normalized === 'browser_action' && trimmedQuestion) {
    return {
      body: trimmedQuestion,
      followUp: '确认无误后在下方回复继续；最终提交、支付、发送、删除或退订由你手动完成。',
    };
  }
  return {
    body: copy.streamBody,
    followUp: null,
  };
}
