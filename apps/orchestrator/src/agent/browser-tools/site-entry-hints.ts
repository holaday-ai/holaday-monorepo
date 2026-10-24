/**
 * FIX-35 #4 (Deploy-35 b-v06): on QQ 音乐 the chart is reached by clicking from the home
 * page, and that click path posts an encrypted request the write guard rightly pauses on.
 * The charts have public pages of their own (verified 2026-10-24): open the page, read it,
 * click nothing.
 */
const QQ_MUSIC_CHARTS: ReadonlyArray<[RegExp, number, string]> = [
  [/热歌榜/, 26, '热歌榜'],
  [/飙升榜/, 62, '飙升榜'],
  [/新歌榜/, 27, '新歌榜'],
  [/流行指数榜|流行榜/, 4, '流行指数榜'],
];

export function siteEntryHint(intent: string): string | null {
  if (!/qq\s*音乐|y\.qq\.com/i.test(intent)) return null;
  const chart = QQ_MUSIC_CHARTS.find(([re]) => re.test(intent));
  if (!chart) return null;
  const [, id, name] = chart;
  return `QQ 音乐${name}有自己的公开页面：直接 navigate 到 https://y.qq.com/n/ryqq/toplist/${id} 读取，不要从首页点击进入（点击路径会发出加密请求而被暂停）。`;
}
