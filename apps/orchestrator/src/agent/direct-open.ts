import type { ActionResult, ScreenshotResult } from './vision-loop/playwright-executor.js';
import {
  type BrowserNetworkPolicy,
  defaultBrowserNetworkPolicy,
  staticBrowserUrlSafetyMessage,
} from './browser-network-policy.js';

const DIRECT_OPEN_INTENT =
  /^(?:打开|访问|前往|进入|open|visit|go\s+to)\s+(https?:\/\/\S+)$/i;

export function extractDirectOpenUrl(intent: string): string | null {
  const normalized = intent.trim().replace(/。+$/u, '');
  const match = normalized.match(DIRECT_OPEN_INTENT);
  const rawUrl = match?.[1];
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function extractRunnableDirectOpenUrl(
  intent: string,
  mode: 'auto' | 'plan' | undefined,
): string | null {
  if (mode === 'plan') return null;
  return extractDirectOpenUrl(intent);
}

export function directOpenUrlSafetyMessage(rawUrl: string): string | null {
  return staticBrowserUrlSafetyMessage(rawUrl);
}

export async function verifyDirectOpenUrlSafety(
  rawUrl: string,
  policy: Pick<BrowserNetworkPolicy, 'check'> = defaultBrowserNetworkPolicy,
): Promise<string | null> {
  const decision = await policy.check(rawUrl);
  return decision.allowed ? null : decision.message;
}

export function offlineBrowserUnavailableMessage(hasModelController: boolean): string | null {
  if (hasModelController) return null;
  return '当前模型执行器未配置，未创建任务。明确网址可直接打开；其余任务请在模型服务就绪后重试。';
}

export interface DirectOpenExecutor<TPage> {
  resetPageForTask(): Promise<void>;
  getPage(): Promise<TPage>;
  navigate(page: TPage, url: string): Promise<ActionResult>;
  screenshot(page: TPage): Promise<ScreenshotResult>;
}

export interface DirectOpenResult {
  finalUrl: string;
  finalScreenshot: string;
  finalViewport?: { width: number; height: number };
}

export async function runDirectOpen<TPage extends { url(): string }>(
  executor: DirectOpenExecutor<TPage>,
  url: string,
): Promise<DirectOpenResult> {
  await executor.resetPageForTask();
  const initialPage = await executor.getPage();
  const navigation = await executor.navigate(initialPage, url);
  if (!navigation.ok) {
    throw new Error(navigation.message ?? '浏览器未能打开目标网址');
  }

  // navigate() may heal a stuck about:blank tab by replacing it, so
  // resolve the active page again before collecting terminal evidence.
  const finalPage = await executor.getPage();
  const screenshot = await executor.screenshot(finalPage);
  if (!screenshot.base64) {
    throw new Error(screenshot.error ?? '页面已打开，但最终截图保存失败');
  }

  const finalViewport =
    screenshot.viewportWidth && screenshot.viewportHeight
      ? {
          width: screenshot.viewportWidth,
          height: screenshot.viewportHeight,
        }
      : undefined;

  return {
    finalUrl: finalPage.url(),
    finalScreenshot: screenshot.base64,
    ...(finalViewport ? { finalViewport } : {}),
  };
}
