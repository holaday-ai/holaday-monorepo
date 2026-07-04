export interface MentionableSkill {
  id: string;
  name: string;
  aliases?: readonly string[];
  enabled?: boolean;
}

export interface SkillMentionTrigger {
  start: number;
  end: number;
  query: string;
}

const MENTION_BOUNDARY = /[\s([{"'，。！？、；：]/u;

export function detectSkillMentionTrigger(
  value: string,
  caretIndex = value.length,
): SkillMentionTrigger | null {
  const safeCaret = Math.max(0, Math.min(caretIndex, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const start = beforeCaret.lastIndexOf('@');
  if (start < 0) return null;
  const previous = start > 0 ? beforeCaret[start - 1] : '';
  if (previous && !MENTION_BOUNDARY.test(previous)) return null;
  const query = beforeCaret.slice(start + 1);
  if (/[\s\n\r\t]/u.test(query)) return null;
  return {
    start,
    end: safeCaret,
    query,
  };
}

export function filterMentionSkills<T extends MentionableSkill>(
  skills: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeQuery(query);
  return skills
    .filter((skill) => skill.enabled !== false)
    .filter((skill) => {
      if (!normalizedQuery) return true;
      const haystack = [
        skill.id,
        skill.name,
        ...(skill.aliases ?? []),
      ].map(normalizeQuery);
      return haystack.some((text) => text.includes(normalizedQuery));
    });
}

export function stripSkillMention(intent: string, skillName: string): string {
  const trimmed = intent.trim();
  const mention = `@${skillName}`;
  if (!trimmed.startsWith(mention)) return trimmed;
  return trimmed.slice(mention.length).trimStart();
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}
