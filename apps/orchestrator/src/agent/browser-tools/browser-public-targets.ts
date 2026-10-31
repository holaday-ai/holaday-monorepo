/** Host-observed fields outside every login/challenge component, never model claims. */
export interface PublicTargets {
  title: boolean;
  channel: boolean;
  views: boolean;
  date: boolean;
  description: boolean;
  article: boolean;
}

/** Deliberately narrow: unknown goals and protected-content goals fail closed. */
export function canReadOutsideWall(intent: string | undefined, targets: PublicTargets): boolean {
  if (!intent) return false;
  const goal = intent
    .replace(/(?:不要|不必|无需|禁止|不|未)(?:播放|观看|下载)(?:视频)?/g, '')
    .replace(
      /\b(?:do not|don['’]t|without|not)\s+(?:play(?:ing)?|watch(?:ing)?|download(?:ing)?)(?:\s+(?:the\s+)?video)?/gi,
      '',
    );
  if (
    /(?:播放(?!量)|观看(?!量)|字幕|音轨|台词|视频内容|评论|弹幕|被遮挡|受保护|\bplay(?:ing)?\b|\bwatch(?:ing)?\b|transcript|subtitle|captions|video content|comments?|replies|protected|obscured)/i.test(
      goal,
    )
  )
    return false;
  const fields: Array<[RegExp, keyof PublicTargets]> = [
    [/标题|\btitle\b/i, 'title'],
    [/频道|作者|\bchannel\b|\bauthor\b/i, 'channel'],
    [/播放量|观看量|观看次数|view count|\bviews\b/i, 'views'],
    [/发布(?:日期|时间|日)|日期|\bdate\b|published|upload time/i, 'date'],
    [/描述|简介|description/i, 'description'],
    [/正文|文章|\barticle\b|\bbody\b/i, 'article'],
  ];
  const requested = fields.filter(([pattern]) => pattern.test(goal)).map(([, field]) => field);
  if (/元信息|元数据|metadata/i.test(goal)) requested.push('title', 'channel', 'views', 'date');
  return requested.length > 0 && requested.every((field) => targets[field]);
}
