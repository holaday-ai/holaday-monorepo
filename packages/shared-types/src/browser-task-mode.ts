/** A page mention alone does not grant control of the person's current tab. */
export type BrowserTaskMode = 'independent' | 'current';
export type BrowserTaskModeChoice = BrowserTaskMode | 'auto';

export function resolveBrowserTaskMode(
  intent: string,
  choice: BrowserTaskModeChoice = 'auto',
): BrowserTaskMode {
  if (choice !== 'auto') return choice;
  const unquoted = intent.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '');
  const clauses = unquoted.split(/[，,。.!！?？;；\n]/);
  const affirmative = clauses.some((clause) => {
    if (/什么意思|什么含义|解释|举例|例子|\b(?:explain|meaning|example|phrase)\b/i.test(clause))
      return false;
    if (
      /不要|不用|无需|不必|禁止|不允许|不需要|别|\b(?:do not|don't|never|without)\b/i.test(clause)
    )
      return false;
    return (
      /(?:处理|操作|使用|分析|填写|检查|读取|整理|总结|修改|更新|提取|继续).{0,8}(?:当前|这个|本)(?:标签页|页面|网页|页)/.test(
        clause,
      ) ||
      /\b(?:use|work on|operate|read|analy[sz]e|fill|inspect)\s+(?:the\s+)?current\s+(?:tab|page)\b/i.test(
        clause,
      )
    );
  });
  return affirmative ? 'current' : 'independent';
}

export interface BrowserTaskLaunchAttempt {
  preparationId: string;
  clientRequestId: string;
}
interface LaunchEntry<T> extends BrowserTaskLaunchAttempt {
  prepared?: { value: T };
  pending?: Promise<T>;
}

/** Keep unknown preparation/creation retries under the original operation IDs. */
export class BrowserTaskLaunches<T> {
  private entries = new Map<string, LaunchEntry<T>>();

  attempt(key: string): BrowserTaskLaunchAttempt {
    let entry = this.entries.get(key);
    if (!entry) {
      // Never evict an unresolved operation and silently create it again.
      if (this.entries.size >= 64) throw new Error('待确认的任务过多，请先查看已有任务。');
      entry = { preparationId: crypto.randomUUID(), clientRequestId: crypto.randomUUID() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  async prepare(key: string, prepare: (id: string) => Promise<T>): Promise<T> {
    const entry = this.attempt(key) as LaunchEntry<T>;
    if (entry.prepared) return entry.prepared.value;
    if (!entry.pending) {
      entry.pending = prepare(entry.preparationId)
        .then((value) => {
          if (this.entries.get(key) !== entry) throw new Error('登录态已切换，请重新发送任务。');
          entry.prepared = { value };
          return value;
        })
        .finally(() => {
          entry.pending = undefined;
        });
    }
    return entry.pending;
  }

  complete(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}
