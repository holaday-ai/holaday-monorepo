/**
 * FIX-53 #5 (Deploy-49 / Deploy-53 core-04): `summary.slice(0, 200)` cut 「🎭」 in half and MySQL
 * refused the whole `tasks.result` JSON ("The surrogate pair in string is invalid"), so the
 * task failed. Text headed for the database is cut on whole characters.
 */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The first `max` UTF-16 units, one fewer when the last would be half a pair. */
export function cutWhole(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, max > 0 && last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** Every string in a JSON value with any half pair replaced by U+FFFD (the backstop). */
export function wellFormedJson<T>(value: T): T {
  if (typeof value === 'string') return value.replace(LONE_SURROGATE_RE, '�') as T;
  if (Array.isArray(value)) return value.map((item) => wellFormedJson(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, wellFormedJson(item)]),
    ) as T;
  return value;
}
