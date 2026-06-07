export type VerificationFailureLevel =
  | 'fixable'
  | 'needs_clarification'
  | 'hard_fail'
  | null;

export interface VerificationCheck {
  type: string;
  detail: string;
}

export interface VerificationBannerCopy {
  tone: 'warning' | 'danger';
  eyebrow: string;
  title: string;
  body: string;
  checks: string[];
  hiddenCount: number;
}

const CHECK_TYPE_LABELS: Record<string, string> = {
  url_count: '缺少来源链接',
  result_count: '结果数量不足',
  price_sort: '价格排序不正确',
  ecommerce_rows: '商品行字段不完整',
  'generic.url_grounding': '回复中存在未验证的链接',
  'generic.empty_result': '回复内容近似为空',
  'generic.constraints': '未完全满足约束条件',
  'generic.number_cross_check': '数据交叉校验不一致',
  'llm.overall': '整体答案需要人工复核',
};

export function verificationCheckLabel(check: VerificationCheck): string {
  const detail = check.detail.trim();
  if (check.type === 'ecommerce_rows' && detail) return detail;
  if (check.type === 'url_count' && /only\s+0\s+URL|链接数减少|0\s*→/i.test(detail)) {
    return '缺少可验证来源链接';
  }
  if (/second-opinion|verifier_fallback|disagrees/i.test(detail)) {
    return '自动复核认为答案需要人工确认';
  }
  if (/timeout|timed out|超时/i.test(detail)) {
    return '自动审核超时，未阻塞任务结果';
  }
  return CHECK_TYPE_LABELS[check.type] ?? (detail || '自动审核发现一项问题');
}

export function verificationBannerCopy({
  level,
  status,
  failedChecks,
}: {
  level: VerificationFailureLevel;
  status: string;
  failedChecks: readonly VerificationCheck[] | null | undefined;
}): VerificationBannerCopy {
  const isHard = level === 'hard_fail' || status === 'failed';
  const isClarification = level === 'needs_clarification';
  const labels = dedupe(
    (failedChecks ?? []).map(verificationCheckLabel).filter(Boolean),
  );
  const checks = labels.slice(0, 4);
  const hiddenCount = Math.max(0, labels.length - checks.length);
  const timeoutOnly =
    labels.length > 0 && labels.every((label) => label.includes('自动审核超时'));

  if (isHard) {
    return {
      tone: 'danger',
      eyebrow: '自动审核未通过',
      title: '这次结果不够可信',
      body:
        labels.length > 0
          ? 'HOLA DAY 已拦截这次结果。建议重新执行任务，或把范围、来源、字段要求写得更具体。'
          : 'HOLA DAY 已拦截这次结果，但旧任务没有保存具体检查项。建议重新执行任务或补充更明确的要求。',
      checks,
      hiddenCount,
    };
  }

  if (isClarification) {
    return {
      tone: 'warning',
      eyebrow: '自动审核需要复核',
      title: '结果需要你确认后再使用',
      body:
        timeoutOnly
          ? '答案已经生成，但自动审核等待过久。HOLA DAY 没有因此阻塞任务，请按关键数据和来源自行核对。'
          : labels.length > 0
          ? '答案已经生成，但审核认为仍有不确定点。请先核对下面的问题，再决定是否继续追问。'
          : '答案已经生成，但审核无法给出明确通过结论。请核对关键数据或补充更具体的约束。',
      checks,
      hiddenCount,
    };
  }

  return {
    tone: 'warning',
    eyebrow: '自动审核发现可修正问题',
    title: '结果可能不完整',
    body:
      timeoutOnly
        ? '答案已经生成，但自动审核等待过久。HOLA DAY 没有因此阻塞任务，请按关键数据和来源自行核对。'
        : labels.includes('缺少可验证来源链接')
        ? '答案可先参考，但原始来源链接不足或已被移除，避免把未验证链接当作事实来源。建议重新执行或指定可信来源。'
        : labels.length > 0
        ? '答案可先参考，但下面的结构性要求没有完全满足。建议核对来源后再行动。'
        : '答案可先参考，但旧任务没有保存具体检查项。建议核对来源、数量和排序后再行动。',
    checks,
    hiddenCount,
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
