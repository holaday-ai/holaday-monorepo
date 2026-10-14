import { TEXT_URL_RE } from '../../execution/text-urls.js';

export interface ObservedEvidence {
  text: string;
  tabId?: string;
  sourceURL?: string;
  links?: Array<{ text: string; url: string; kind?: string }>;
}
export interface CompletionField {
  name: string;
  value: string;
  tabId?: string;
  sourceURL?: string;
}
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
const clean = (value: string) => value.replace(/^[\s*`#>]+|[\s*`。]+$/g, '').trim();

/** Only successful content reads enter this store; listings and navigation receipts do not. */
export function observedEvidence(text: string, decoded: string, url?: string): ObservedEvidence {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(text);
  } catch {
    /* Plain accessibility snapshots are supported. */
  }
  const links = Array.isArray(meta.items)
    ? meta.items.filter(
        (item): item is { text: string; url: string; kind?: string } =>
          !!item && typeof item.text === 'string' && typeof item.url === 'string',
      )
    : [];
  return {
    text: decoded,
    links,
    ...(typeof meta.tabId === 'string' ? { tabId: meta.tabId } : {}),
    ...(typeof meta.sourceURL === 'string'
      ? { sourceURL: meta.sourceURL }
      : url
        ? { sourceURL: url }
        : {}),
  };
}

function explicitFields(input: unknown): CompletionField[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 60).map((field): CompletionField => {
    if (!field || typeof field !== 'object') return { name: '无效字段', value: '' };
    const f = field as Record<string, unknown>;
    return {
      name: typeof f.name === 'string' ? f.name.slice(0, 80) : '字段',
      value: typeof f.value === 'string' ? f.value.slice(0, 2000) : '',
      ...(typeof f.tabId === 'string' ? { tabId: f.tabId } : {}),
      ...(typeof f.sourceURL === 'string' ? { sourceURL: f.sourceURL } : {}),
    };
  });
}

/** Extract factual cells, quoted values, labels and URLs, not procedural summary prose. */
function answerFields(summary: string): CompletionField[] {
  const result: CompletionField[] = [];
  const add = (name: string, value: string) => {
    let v = clean(value);
    // A precision disclaimer is not a page fact. Strip only this known note from
    // a date field whose remaining value is itself a relative timestamp.
    if (/日期|发布时间|published/i.test(name)) {
      const date = v.replace(/\s*[（(]相对时间\s*[,，、]\s*非精确日期[）)]$/u, '');
      if (
        /^(?:\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago|\d+\s*(?:秒|分钟|小时|天|周|个月|月|年)前)$/iu.test(
          date,
        )
      )
        v = date;
    }
    if (v) result.push({ name, value: v });
  };
  for (const url of summary.match(TEXT_URL_RE) ?? []) add('链接', url);
  for (const match of summary.matchAll(
    /(?:标题|频道|播放量|观看次数|发布日期(?:或页面相对日期)?|发布时间|日期|title|channel|views|published|tab\s*\d+\s*title)\s*[*`]*\s*(?:[:：]|为|是)\s*([^\n；;|。]+)/giu,
  ))
    add(match[0].split(/[:：]/)[0]!, match[1]!);
  for (const match of summary.matchAll(/[“「"]([^”」"\n]{2,300})[”」"]/gu)) add('引用', match[1]!);
  let headers: string[] | undefined;
  for (const line of summary.split('\n')) {
    if (line.trim().startsWith('|')) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(clean);
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
      if (
        !headers &&
        cells.some((cell) => /标题|频道|播放量|日期|链接|title|channel|views|url/i.test(cell))
      ) {
        headers = cells;
        continue;
      }
      if (headers)
        for (let i = 0; i < cells.length; i++) {
          if (/标题|频道|播放量|日期|链接|title|channel|views|url/i.test(headers[i] ?? ''))
            add(headers[i]!, cells[i]!.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
        }
    }

    // A numbered title/link list associates the title with that particular source.
    const item = line.match(/^\s*\d+[.)、]\s+(.+?)\s+[—–-]\s+(https?:\/\/\S+)/u);
    if (item) {
      const url = item[2]!.match(TEXT_URL_RE)?.[0];
      if (url) result.push({ name: '条目标题', value: clean(item[1]!), sourceURL: url });
    }
  }
  return result;
}

function evidenceFields(evidence: string): CompletionField[] {
  return evidence
    .split(/\n|；|;/u)
    .map((part) => clean(part))
    .filter(Boolean)
    .map((part) => {
      const quote = part.match(/^(?:[-*]\s*)?(?:heading|link|generic|text|paragraph)\s+"([^"]+)"/);
      const label = part.match(
        /^(?:标题|频道|播放量|发布日期|title|channel|views)\s*[:：]\s*(.+)$/i,
      );
      return { name: '证据', value: quote?.[1] ?? label?.[1] ?? part };
    });
}

function nearest(field: CompletionField, pages: ObservedEvidence[]): string {
  const tokens =
    normalized(field.value)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  let best = '';
  let score = 0;
  for (const page of pages)
    for (const line of page.text.split('\n')) {
      const lower = line.toLocaleLowerCase();
      const n = tokens.reduce((sum, token) => sum + (lower.includes(token) ? token.length : 0), 0);
      if (n > score) {
        score = n;
        best = line;
      }
    }
  return best.slice(0, 300) || '没有对应的已读字段';
}

/** All identified answer fields and evidence fragments must be grounded independently. */
export function completionFieldGaps(
  summary: string,
  evidence: string,
  fields: unknown,
  pages: ObservedEvidence[],
  intent = '',
): string | null {
  const videoSearch =
    /youtube/i.test(intent) && /视频|videos?/i.test(intent) && /搜索|search/i.test(intent);
  const claims = [...explicitFields(fields), ...answerFields(summary), ...evidenceFields(evidence)];
  const misses: string[] = [];
  for (const field of claims) {
    const value = normalized(field.value);
    const eligible = pages.filter(
      (p) =>
        (!field.tabId || p.tabId === field.tabId) &&
        (!field.sourceURL ||
          p.sourceURL === field.sourceURL ||
          (videoSearch &&
            p.links?.some(
              (link) => link.url === field.sourceURL && normalized(link.text).includes(value),
            ))),
    );
    const wrongVideoKind =
      videoSearch &&
      eligible.some((p) =>
        p.links?.some(
          (link) =>
            ['playlist', 'channel'].includes(link.kind ?? '') &&
            (link.url === field.value || normalized(link.text) === value),
        ),
      );
    if (
      value &&
      !wrongVideoKind &&
      eligible.some((p) => normalized(p.text).includes(value) || p.sourceURL === value)
    )
      continue;
    misses.push(
      `${field.name}「${field.value.slice(0, 180)}」未通过核验；最相近原文：${nearest(field, eligible)}`,
    );
    if (misses.length === 8) break;
  }
  return misses.length ? `完成字段证据不足：\n${[...new Set(misses)].join('\n')}` : null;
}
