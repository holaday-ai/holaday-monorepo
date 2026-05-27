export interface ParsedBatchPrompts {
  prompts: string[];
  rawCount: number;
  duplicateCount: number;
  overLimit: boolean;
}

export function parseBatchPrompts(
  text: string,
  maxItems: number,
): ParsedBatchPrompts {
  return parseBatchPromptItems(text.split('\n'), maxItems);
}

export function parseBatchPromptItems(
  items: readonly string[],
  maxItems: number,
): ParsedBatchPrompts {
  const raw = items.map((s) => s.trim()).filter((s) => s.length > 0);
  const seen = new Set<string>();
  const prompts: string[] = [];
  let duplicateCount = 0;
  for (const prompt of raw) {
    if (seen.has(prompt)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(prompt);
    prompts.push(prompt);
  }
  return {
    prompts,
    rawCount: raw.length,
    duplicateCount,
    overLimit: prompts.length > maxItems,
  };
}
