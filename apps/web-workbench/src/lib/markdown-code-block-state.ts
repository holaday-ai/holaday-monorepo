export interface MarkdownCodeBlockMeta {
  readonly label: string;
  readonly copyLabel: string;
  readonly copiedToast: string;
  readonly codeLike: boolean;
}

const KNOWN_LANGUAGE_LABELS: Record<string, string> = {
  bash: 'SHELL',
  sh: 'SHELL',
  shell: 'SHELL',
  zsh: 'SHELL',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  toml: 'TOML',
  yaml: 'YAML',
  yml: 'YAML',
};

export function markdownCodeBlockMeta(
  className: string | undefined,
  text: string,
): MarkdownCodeBlockMeta {
  const raw = className?.replace(/^language-/, '').trim().toLowerCase();
  if (raw) {
    return {
      label: KNOWN_LANGUAGE_LABELS[raw] ?? raw.toUpperCase(),
      copyLabel: '代码',
      copiedToast: '已复制代码',
      codeLike: true,
    };
  }

  if (looksLikeBusinessTemplate(text)) {
    return {
      label: '模板',
      copyLabel: '内容',
      copiedToast: '已复制内容',
      codeLike: false,
    };
  }

  if (looksLikeDiagram(text)) {
    return {
      label: '图示',
      copyLabel: '内容',
      copiedToast: '已复制内容',
      codeLike: true,
    };
  }

  return {
    label: '文本块',
    copyLabel: '内容',
    copiedToast: '已复制内容',
    codeLike: false,
  };
}

function looksLikeBusinessTemplate(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const templateMarkers = [
    '目标：',
    '假设：',
    '实验：',
    '指标：',
    '步骤：',
    '受众：',
    '渠道：',
    '文案：',
    '结论：',
    '目标:',
    'Hypothesis:',
    'Metric:',
    'Experiment:',
  ];
  return templateMarkers.some((marker) => normalized.includes(marker));
}

function looksLikeDiagram(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  const diagramLines = lines.filter((line) =>
    /(?:->|-{2,}>|=>|[↓↑←→↔↕]|[┌┐└┘├┤│─]|[+|][ -]*[+|])/.test(line),
  );
  return diagramLines.length >= Math.min(2, lines.length);
}
