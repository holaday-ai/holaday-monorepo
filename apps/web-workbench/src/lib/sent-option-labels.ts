/**
 * FIX-57 复审 #7: a failure option sends a full instruction (「请使用云端浏览器，亚马逊新加坡站
 * USB C 线价格」) but the person clicked 「打开亚马逊新加坡站帮你实时查」 — their bubble shows
 * what they clicked. What is sent is unchanged. Kept per viewer (memory + localStorage); when
 * it is not there (another device, cleared storage) the bubble shows the instruction itself.
 */
const KEY = 'holaday.sentOptionLabels.v1';
const MAX = 40;

let memory: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]');
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string')
          memory.set(entry[0], entry[1]);
      }
    }
  } catch {
    // Private window or blocked storage: memory only.
  }
  return memory;
}

export function rememberOptionLabel(prompt: string, label: string): void {
  const key = prompt.trim();
  if (!key || !label.trim()) return;
  const map = load();
  map.delete(key);
  map.set(key, label.trim());
  while (map.size > MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...map]));
  } catch {
    // Not saved across reloads; this session still shows the label.
  }
}

export function optionLabelFor(text: string): string | null {
  return load().get(text.trim()) ?? null;
}

/** Tests only. */
export function resetOptionLabels(): void {
  memory = null;
}
