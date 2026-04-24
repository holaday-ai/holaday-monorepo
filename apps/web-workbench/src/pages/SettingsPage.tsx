import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { PageShell, Row, Section } from '@/pages/PageShell';

type Lang = 'zh' | 'en';
const LANG_KEY = 'holaday.lang';
const NOTIF_KEY = 'holaday.notifications';
const INTERACT_KEY = 'holaday.browser.interactiveDefault';

/**
 * Settings page — language preference, notification toggles, browser
 * defaults, and the account deletion entry point. All settings are
 * local-storage-only for now (no backend settings API yet) so each
 * toggle persists across reloads but doesn't sync to the server.
 */
export function SettingsPage(): JSX.Element {
  const toast = useToast();
  const [lang, setLang] = useLocalPref<Lang>(LANG_KEY, 'zh');
  const [notif, setNotif] = useLocalPref<{
    taskComplete: boolean;
    taskFailed: boolean;
    captcha: boolean;
    product: boolean;
  }>(NOTIF_KEY, {
    taskComplete: true,
    taskFailed: true,
    captcha: true,
    product: false,
  });
  const [interactive, setInteractive] = useLocalPref<boolean>(INTERACT_KEY, true);

  function confirmDelete(): void {
    const answer = window.prompt(
      '确认删除账号？此操作不可恢复。输入 DELETE 继续：',
    );
    if (answer === 'DELETE') {
      toast.show('账号删除请求已记录，客服会在 24 小时内联系你', 'error');
    }
  }

  return (
    <PageShell title="设置" subtitle="语言、通知与浏览器偏好" width="3xl">
      <div className="space-y-6">
        <Section title="语言偏好">
          <Row label="界面语言">
            <div className="inline-flex gap-1 rounded-md bg-muted p-0.5 text-xs">
              <SegmentButton active={lang === 'zh'} onClick={() => setLang('zh')}>
                中文
              </SegmentButton>
              <SegmentButton active={lang === 'en'} onClick={() => setLang('en')}>
                English
              </SegmentButton>
            </div>
          </Row>
        </Section>

        <Section title="通知">
          <Row label="任务完成" description="任务执行完成时弹出通知">
            <Toggle
              checked={notif.taskComplete}
              onChange={(v) => setNotif({ ...notif, taskComplete: v })}
            />
          </Row>
          <Row label="任务失败" description="任务异常或被反爬拦截时提醒">
            <Toggle
              checked={notif.taskFailed}
              onChange={(v) => setNotif({ ...notif, taskFailed: v })}
            />
          </Row>
          <Row label="验证码等待" description="浏览器遇到验证码需要你接管时提醒">
            <Toggle
              checked={notif.captcha}
              onChange={(v) => setNotif({ ...notif, captcha: v })}
            />
          </Row>
          <Row label="产品更新" description="接收新功能上线和产品动态邮件">
            <Toggle
              checked={notif.product}
              onChange={(v) => setNotif({ ...notif, product: v })}
            />
          </Row>
        </Section>

        <Section title="浏览器行为">
          <Row
            label="默认交互模式"
            description="新任务创建时是否默认允许你直接点击远程浏览器"
          >
            <Toggle checked={interactive} onChange={setInteractive} />
          </Row>
        </Section>

        <Section title="账号">
          <Row
            label="删除账号"
            description="删除后所有任务记录、浏览器数据、订阅都会清除"
          >
            <Button variant="outline" size="sm" onClick={confirmDelete} className="text-red-600 hover:text-red-700">
              删除账号
            </Button>
          </Row>
        </Section>
      </div>
    </PageShell>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange(v: boolean): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function useLocalPref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = React.useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });
  const set = React.useCallback(
    (next: T) => {
      setVal(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* quota or private mode — silently fail */
      }
    },
    [key],
  );
  return [val, set];
}
