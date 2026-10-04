/**
 * Batch 10.3 — timezone-aware RRULE expansion shared by scheduled and
 * planned tasks.
 *
 * Why: `rrulestr(rule)` without a DTSTART anchors the rule at *parse time*
 * (so every call drifts: `FREQ=DAILY;BYHOUR=9` fires at 09:00:<now's seconds>,
 * and `between()` over a past range is empty), and rrule.js evaluates
 * BYHOUR / BYDAY in UTC. The calendar (FullCalendar's rrule plugin) renders a
 * rule without a `Z` DTSTART as wall-clock time in the viewer's zone, and the
 * planned editor emits `DTSTART:<utc>Z` + `BYDAY` meant as *local* weekdays —
 * so a Shanghai user's "Mon/Wed 07:00" ran Tue/Thu 07:00.
 *
 * Semantics here: the rule is evaluated on the wall clock of `timezone`
 * ("floating" time, RFC 5545 §3.3.5), anchored at
 *   1. the rule's own DTSTART — `…Z` is converted to wall time in `timezone`,
 *      `;TZID=X:` is converted from X, floating is used as-is; else
 *   2. the caller's `anchor` instant (the schedule's current occurrence),
 * and every wall-clock result is converted back to a real instant.
 * Rules with extra lines (EXDATE / RDATE …) fall back to plain rrulestr.
 */
import rruleModule from 'rrule';

type RRuleOptions = Record<string, unknown> & {
  dtstart?: Date | null;
  until?: Date | null;
  tzid?: string | null;
};
interface RRuleInstance {
  after(date: Date, inclusive?: boolean): Date | null;
  between(after: Date, before: Date, inclusive?: boolean): Date[];
}
const { RRule, rrulestr } = rruleModule as unknown as {
  RRule: (new (options: RRuleOptions) => RRuleInstance) & {
    parseString(value: string): RRuleOptions;
  };
  rrulestr: (value: string, options?: { dtstart?: Date }) => RRuleInstance;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** Instant → "wall" Date whose UTC fields are the wall clock in `timezone`. */
export function wallClockOf(instant: Date, timezone: string): Date {
  const formatter = formatterFor(timezone);
  if (!formatter || timezone === 'UTC') return new Date(instant.getTime());
  const parts = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return new Date(
    Date.UTC(
      parts.get('year') ?? 1970,
      (parts.get('month') ?? 1) - 1,
      parts.get('day') ?? 1,
      parts.get('hour') ?? 0,
      parts.get('minute') ?? 0,
      parts.get('second') ?? 0,
      instant.getUTCMilliseconds(),
    ),
  );
}

/** Wall Date (UTC fields = wall clock in `timezone`) → real instant. */
export function instantOfWallClock(wall: Date, timezone: string): Date {
  if (!formatterFor(timezone) || timezone === 'UTC') return new Date(wall.getTime());
  let guess = wall.getTime();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = wallClockOf(new Date(guess), timezone).getTime();
    const delta = wall.getTime() - observed;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

interface ParsedZonedRule {
  options: RRuleOptions;
  /** DTSTART already expressed as wall time in the target zone, if present. */
  dtstartWall: Date | null;
}

function parseZonedRule(raw: string, timezone: string): ParsedZonedRule | null {
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const dtstartLines = lines.filter((line) => /^DTSTART[;:]/i.test(line));
  const ruleLines = lines.filter((line) => !/^DTSTART[;:]/i.test(line));
  if (dtstartLines.length > 1 || ruleLines.length !== 1) return null;
  const ruleLine = ruleLines[0]!;
  if (!/^(RRULE:)?FREQ=/i.test(ruleLine)) return null;

  const options = RRule.parseString(ruleLine.replace(/^RRULE:/i, ''));
  let dtstartWall: Date | null = null;
  const dtstartLine = dtstartLines[0];
  if (dtstartLine) {
    const match = /^DTSTART(?:;TZID=([^:;]+))?:(\d{8}T\d{6})(Z?)$/i.exec(dtstartLine);
    if (!match) return null;
    const parsed = RRule.parseString(`DTSTART:${match[2]}`).dtstart;
    if (!(parsed instanceof Date)) return null;
    if (match[3]) dtstartWall = wallClockOf(parsed, timezone);
    else if (match[1]) dtstartWall = wallClockOf(instantOfWallClock(parsed, match[1]), timezone);
    else dtstartWall = parsed;
  }
  if (options.until instanceof Date && /UNTIL=\d{8}(T\d{6})?Z/i.test(ruleLine)) {
    options.until = wallClockOf(options.until, timezone);
  }
  delete options.tzid;
  return { options, dtstartWall };
}

function buildWallRule(
  rule: string,
  anchor: Date,
  timezone: string,
): RRuleInstance | null {
  const parsed = parseZonedRule(rule, timezone);
  if (!parsed) return null;
  const anchorWall = wallClockOf(anchor, timezone);
  anchorWall.setUTCMilliseconds(0);
  return new RRule({ ...parsed.options, dtstart: parsed.dtstartWall ?? anchorWall });
}

/** First occurrence strictly after `after`. Throws on an unparseable rule. */
export function nextZonedRruleOccurrence(input: {
  rrule: string;
  anchor: Date;
  after: Date;
  timezone: string;
}): Date | null {
  const rule = buildWallRule(input.rrule, input.anchor, input.timezone);
  if (!rule) {
    // Complex rule sets keep the legacy UTC behaviour, but anchored.
    return rrulestr(input.rrule.trim(), { dtstart: input.anchor }).after(input.after, false);
  }
  const next = rule.after(wallClockOf(input.after, input.timezone), false);
  return next ? instantOfWallClock(next, input.timezone) : null;
}

/** Occurrences in [start, end] (inclusive), as real instants. */
export function zonedRruleOccurrencesBetween(input: {
  rrule: string;
  anchor: Date;
  start: Date;
  end: Date;
  timezone: string;
}): Date[] {
  const rule = buildWallRule(input.rrule, input.anchor, input.timezone);
  if (!rule) {
    return rrulestr(input.rrule.trim(), { dtstart: input.anchor }).between(
      input.start,
      input.end,
      true,
    );
  }
  return rule
    .between(wallClockOf(input.start, input.timezone), wallClockOf(input.end, input.timezone), true)
    .map((wall) => instantOfWallClock(wall, input.timezone))
    .filter(
      (instant) =>
        instant.getTime() >= input.start.getTime() && instant.getTime() <= input.end.getTime(),
    );
}

/**
 * Batch 10.3 — move a rule's embedded DTSTART to `start` (UTC form).
 *
 * Dragging a planned series to a new time updated first_run_at / next_run_at
 * but kept `DTSTART:<old>Z` inside the rrule, which wins over first_run_at, so
 * every later occurrence snapped back to the old time of day. Rules without a
 * DTSTART line are returned unchanged (they anchor on first_run_at already).
 */
export function rebaseRruleDtstart(rrule: string | null, start: Date): string | null {
  if (!rrule || Number.isNaN(start.getTime())) return rrule;
  const lines = rrule.trim().split(/\r?\n/);
  const index = lines.findIndex((line) => /^DTSTART[;:]/i.test(line.trim()));
  if (index === -1) return rrule;
  const stamp = start
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  lines[index] = `DTSTART:${stamp}`;
  return lines.join('\n');
}
