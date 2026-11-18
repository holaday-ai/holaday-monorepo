/** Decimal arithmetic over serialized source values; never binary floating-point sums. */
export interface TableDecimal {
  coefficient: bigint;
  scale: number;
}
export function tableDecimal(value: string): TableDecimal | null {
  const text = value.trim();
  const match = text.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,2}))?$/);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? '';
  const digits = `${match[2] ?? '0'}${fraction}`;
  const exponent = Number(match[5] ?? 0);
  if (digits.length > 64 || Math.abs(exponent) > 24) return null;
  let coefficient = BigInt(`${match[1] === '-' ? '-' : ''}${digits}`);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (scale > 24) return null;
  return { coefficient, scale };
}
export function decimalAdd(a: TableDecimal, b: TableDecimal): TableDecimal {
  const scale = Math.max(a.scale, b.scale);
  return {
    coefficient:
      a.coefficient * 10n ** BigInt(scale - a.scale) +
      b.coefficient * 10n ** BigInt(scale - b.scale),
    scale,
  };
}
export function decimalCompare(a: TableDecimal, b: TableDecimal): number {
  const difference = decimalAdd(a, { ...b, coefficient: -b.coefficient }).coefficient;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function decimalText(value: TableDecimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, '0');
  const text = value.scale
    ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/\.?0+$/, '')
    : digits;
  return `${negative && value.coefficient !== 0n ? '-' : ''}${text || '0'}`;
}
export function decimalAverage(
  sum: TableDecimal,
  count: number,
): { value: string; exact: boolean; fractionDigits: number } {
  const fractionDigits = Math.max(12, sum.scale);
  const numerator = sum.coefficient * 10n ** BigInt(fractionDigits - sum.scale);
  const denominator = BigInt(count);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= denominator)
    quotient += numerator < 0n ? -1n : 1n;
  return {
    value: decimalText({ coefficient: quotient, scale: fractionDigits }),
    exact: remainder === 0n,
    fractionDigits,
  };
}
