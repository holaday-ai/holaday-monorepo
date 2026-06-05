import type { UiAwaitingUser } from '@/types/task';

export type AwaitingKind = NonNullable<UiAwaitingUser['awaitingKind']>;

export interface AwaitingUserCopy {
  title: string;
  streamBody: string;
  streamHint: string;
  panelTitle: string;
  panelBody: string;
  toolbarLabel: string;
}

const COPY_BY_KIND: Record<AwaitingKind, AwaitingUserCopy> = {
  login: {
    title: '需要登录',
    streamBody: '请在浏览器画面里完成登录或扫码，完成后任务会继续，不用重新提交。',
    streamHint: '在浏览器画面里完成登录',
    panelTitle: '需要登录',
    panelBody: '交互模式已开启。完成登录或扫码后，HOLA DAY 会继续执行，不用重新提交任务。',
    toolbarLabel: '需要登录',
  },
  captcha: {
    title: '需要验证',
    streamBody: '请在浏览器画面里完成验证码或滑块，完成后任务会继续，不用重新提交。',
    streamHint: '在浏览器画面里通过验证',
    panelTitle: '需要验证',
    panelBody: '交互模式已开启。完成验证码或滑块后，HOLA DAY 会继续执行，不用重新提交任务。',
    toolbarLabel: '需要验证',
  },
  clarification: {
    title: '需要你补充信息',
    streamBody: '需要更多信息才能继续。',
    streamHint: '在下方输入框回答',
    panelTitle: '需要补充信息',
    panelBody: '请回到输入框补充信息，任务会继续。',
    toolbarLabel: '需要你回复',
  },
  permission: {
    title: '需要权限',
    streamBody: '当前页面拒绝访问。请确认账号权限，或换一个公开来源后回复继续。',
    streamHint: '确认权限后回复继续',
    panelTitle: '需要权限',
    panelBody: '当前页面拒绝访问。请确认账号权限，或换一个公开来源后回复继续，不用重新提交任务。',
    toolbarLabel: '需要权限',
  },
  browser_action: {
    title: '需要操作浏览器',
    streamBody: '请按页面提示在浏览器画面里完成下一步操作，完成后任务会继续，不用重新提交。',
    streamHint: '在浏览器画面里完成操作',
    panelTitle: '需要操作浏览器',
    panelBody: '交互模式已开启。按页面提示完成点击或选择后，HOLA DAY 会继续执行，不用重新提交任务。',
    toolbarLabel: '需要操作浏览器',
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
