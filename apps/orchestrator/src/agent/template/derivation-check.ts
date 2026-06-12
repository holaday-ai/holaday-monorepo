/**
 * Derived-calculation re-check primitives (Phase 1 #1, P1).
 *
 * The model maps user data → fields, including DERIVED fields (合计 / 差值 /
 * 环比 / 占比). It can get those wrong — especially unit confusion (summing
 * 万元 with 元, or dropping a 万). These pure functions let validateFillJson
 * re-derive each declared derivation DETERMINISTICALLY from the input values
 * (which are all in the fill JSON) and flag a mismatch as [待核对] instead of
 * shipping a wrong number. No eval / no arbitrary code.
 */

import type { FillData, FillRow } from './placeholder-schema.js';

export const TBD_MARK = '[待核对]';

/**
 * Parse a value to a number, handling the units common in Chinese business
 * data: 万 (1e4) / 亿 (1e8) / 千 (1e3), a trailing % (kept as the bare
 * number — 12.5% → 12.5), and ¥ / 元 / thousands separators. Returns null
 * when it isn't a clean number. This unit awareness is what lets the
 * re-check catch unit confusion: "50万" parses to 500000, so a model value
 * of 20 for a "50万 - 30万" difference is caught.
 */
export function parseNumeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v
    .trim()
    .replace(/[,，\s]/g, '')
    .replace(/[¥￥$]/g, '')
    .replace(/元|人民币|RMB|rmb/g, '');
  const m = /^(-?\d+(?:\.\d+)?)(亿|万|千|%|％)?$/.exec(s);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === '亿') n *= 1e8;
  else if (m[2] === '万') n *= 1e4;
  else if (m[2] === '千') n *= 1e3;
  return n;
}

/** Acceptable drift between the model's value and the re-derived value. */
export function withinDerivationTolerance(computed: number, claimed: number): boolean {
  return Math.abs(computed - claimed) <= Math.max(Math.abs(computed) * 0.01, 0.5);
}

/** Sum a loop column referenced as "loopName.colName" from the fill data. */
export function sumLoopColumn(arg: string, data: FillData): number | null {
  const dot = arg.indexOf('.');
  if (dot < 0) return null;
  const loop = arg.slice(0, dot);
  const col = arg.slice(dot + 1);
  const rows = data[loop];
  if (!Array.isArray(rows)) return null;
  let sum = 0;
  let any = false;
  for (const row of rows as FillRow[]) {
    const n = parseNumeric(row[col]);
    if (n !== null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Evaluate a restricted arithmetic formula: numbers, + - * / ( ), unary
 * +/-, identifiers (resolved via resolveVar), and sum(loop.col) (resolved
 * via resolveSum). Returns null on any parse/resolve failure — the caller
 * then flags the field [待核对].
 */
export function evalArithmetic(
  formula: string,
  resolveVar: (name: string) => number | null,
  resolveSum: (arg: string) => number | null,
): number | null {
  let i = 0;
  let failed = false;
  const s = formula;
  const skip = (): void => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const ID = /^[\p{L}\p{N}_.]+/u;

  function factor(): number {
    skip();
    const c = s[i];
    if (c === '(') {
      i++;
      const v = expr();
      skip();
      if (s[i] === ')') i++;
      else failed = true;
      return v;
    }
    if (c === '+') {
      i++;
      return factor();
    }
    if (c === '-') {
      i++;
      return -factor();
    }
    if (c !== undefined && /[0-9.]/.test(c)) {
      const num = /^\d+(?:\.\d+)?/.exec(s.slice(i));
      if (num) {
        i += num[0].length;
        return Number(num[0]);
      }
    }
    const idm = ID.exec(s.slice(i));
    if (idm) {
      const id = idm[0];
      i += id.length;
      skip();
      if (id === 'sum' && s[i] === '(') {
        i++;
        skip();
        const argm = ID.exec(s.slice(i));
        if (!argm) {
          failed = true;
          return 0;
        }
        i += argm[0].length;
        skip();
        if (s[i] === ')') i++;
        else {
          failed = true;
          return 0;
        }
        const v = resolveSum(argm[0]);
        if (v === null) {
          failed = true;
          return 0;
        }
        return v;
      }
      const v = resolveVar(id);
      if (v === null) {
        failed = true;
        return 0;
      }
      return v;
    }
    failed = true;
    return 0;
  }
  function term(): number {
    let v = factor();
    for (;;) {
      skip();
      const c = s[i];
      if (c === '*') {
        i++;
        v *= factor();
      } else if (c === '/') {
        i++;
        const d = factor();
        if (d === 0) {
          failed = true;
          return 0;
        }
        v /= d;
      } else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      skip();
      const c = s[i];
      if (c === '+') {
        i++;
        v += term();
      } else if (c === '-') {
        i++;
        v -= term();
      } else return v;
    }
  }

  const result = expr();
  skip();
  if (failed || i < s.length || !Number.isFinite(result)) return null;
  return result;
}
