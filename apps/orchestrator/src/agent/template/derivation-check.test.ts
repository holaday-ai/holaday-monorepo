import { describe, it, expect } from 'vitest';
import {
  parseNumeric,
  evalArithmetic,
  sumLoopColumn,
  withinDerivationTolerance,
} from './derivation-check.js';
import type { FillData } from './placeholder-schema.js';

const NO = (): number | null => null;

describe('parseNumeric (unit-aware)', () => {
  it('parses plain numbers + thousands + currency', () => {
    expect(parseNumeric('100')).toBe(100);
    expect(parseNumeric(100)).toBe(100);
    expect(parseNumeric('1,200')).toBe(1200);
    expect(parseNumeric('1,200元')).toBe(1200);
    expect(parseNumeric('¥500')).toBe(500);
    expect(parseNumeric('-8')).toBe(-8);
  });
  it('parses Chinese units 万/亿/千 and % — the core of unit-confusion catching', () => {
    expect(parseNumeric('5万')).toBe(50000);
    expect(parseNumeric('5万元')).toBe(50000);
    expect(parseNumeric('1.2亿')).toBe(120000000);
    expect(parseNumeric('3千')).toBe(3000);
    expect(parseNumeric('12.5%')).toBe(12.5);
  });
  it('returns null for non-numbers', () => {
    expect(parseNumeric('abc')).toBeNull();
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric({})).toBeNull();
    expect(parseNumeric('5万8')).toBeNull(); // unit not at the end
  });
});

describe('evalArithmetic (safe, no eval)', () => {
  it('respects precedence + parens', () => {
    expect(evalArithmetic('2 + 3 * 4', NO, NO)).toBe(14);
    expect(evalArithmetic('(2 + 3) * 4', NO, NO)).toBe(20);
    expect(evalArithmetic('10 - 2 - 3', NO, NO)).toBe(5);
    expect(evalArithmetic('100 / 4', NO, NO)).toBe(25);
    expect(evalArithmetic('-5 + 8', NO, NO)).toBe(3);
  });
  it('resolves identifiers (incl. CJK field names)', () => {
    const vars: Record<string, number> = { revenue: 500000, cost: 300000, 营收: 500000 };
    const r = (n: string): number | null => (n in vars ? vars[n]! : null);
    expect(evalArithmetic('revenue - cost', r, NO)).toBe(200000);
    expect(evalArithmetic('营收 - 300000', r, NO)).toBe(200000);
    expect(evalArithmetic('(revenue - cost) / cost * 100', r, NO)).toBeCloseTo(66.667, 2);
  });
  it('resolves sum(loop.col)', () => {
    expect(evalArithmetic('sum(items.price)', NO, (a) => (a === 'items.price' ? 13 : null))).toBe(13);
    expect(evalArithmetic('sum(items.price) + 2', NO, () => 13)).toBe(15);
  });
  it('returns null on unresolved id / bad syntax / div-by-zero', () => {
    expect(evalArithmetic('a + b', NO, NO)).toBeNull();
    expect(evalArithmetic('2 +', NO, NO)).toBeNull();
    expect(evalArithmetic('2 / 0', NO, NO)).toBeNull();
    expect(evalArithmetic(') (', NO, NO)).toBeNull();
  });
  it('never executes arbitrary code', () => {
    expect(evalArithmetic('process.exit(1)', NO, NO)).toBeNull();
    expect(evalArithmetic('1; throw 1', NO, NO)).toBeNull();
  });
});

describe('sumLoopColumn', () => {
  it('sums a numeric loop column (unit-aware)', () => {
    const data = { items: [{ price: '5' }, { price: '3' }, { price: '2元' }] } as FillData;
    expect(sumLoopColumn('items.price', data)).toBe(10);
  });
  it('returns null for a missing loop / column / bad arg', () => {
    expect(sumLoopColumn('nope.x', {} as FillData)).toBeNull();
    expect(sumLoopColumn('items.qty', { items: [{ price: '5' }] } as FillData)).toBeNull();
    expect(sumLoopColumn('noDot', {} as FillData)).toBeNull();
  });
});

describe('withinDerivationTolerance', () => {
  it('allows rounding but rejects unit confusion', () => {
    expect(withinDerivationTolerance(200000, 200000)).toBe(true);
    expect(withinDerivationTolerance(20.0, 20.04)).toBe(true); // percent rounding
    expect(withinDerivationTolerance(200000, 20)).toBe(false); // dropped 万
    expect(withinDerivationTolerance(8, 9)).toBe(false);
  });
});
