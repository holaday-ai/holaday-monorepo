import type { ReactNode } from 'react';

export function MarketTemperatureDetails({
  score,
  notes,
}: {
  score: number;
  notes: readonly string[];
}): JSX.Element {
  const breadthNote = notes[0] ?? '涨跌家数暂不可用。';
  const breadth = marketBreadth(breadthNote);
  const flowNote = marketFlowLabel(notes[1] ?? '资金流向等待刷新。');
  return (
    <div className="mt-4 flex flex-1 flex-col divide-y divide-[#ECEEF3] border-t border-[#ECEEF3] text-[12px] text-[#4F5868]">
      <MarketTemperatureDetail label="市场广度" value={breadthNote}>
        {breadth ? (
          <div
            role="meter"
            aria-label="上涨家数占比"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={breadth.upPercent}
            className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#ECEFF3]"
          >
            <span className="bg-[#18A76F]" style={{ width: `${breadth.upPercent}%` }} aria-hidden />
            <span className="flex-1 bg-[#EA1F59]" aria-hidden />
          </div>
        ) : null}
      </MarketTemperatureDetail>
      <MarketTemperatureDetail label="资金动向" value={flowNote} />
      <MarketTemperatureDetail
        label="今日观察"
        value={marketTemperatureObservation(score, breadth?.upPercent)}
      />
    </div>
  );
}

function MarketTemperatureDetail({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-1 flex-col justify-center py-3 first:pt-3 last:pb-0">
      <div className="text-[12px] font-semibold text-[#344054]">{label}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-[#667085]">{value}</p>
      {children}
    </div>
  );
}

function marketTemperatureObservation(score: number, upPercent?: number): string {
  const observation = score >= 70
    ? '情绪偏热，警惕追涨与个股分化'
    : score >= 58
      ? '情绪偏乐观，继续核对成交持续性'
      : score >= 45
        ? '多空相对均衡，关注个股分化'
        : '情绪偏谨慎，优先控制回撤风险';
  return upPercent === undefined ? observation : `上涨占比 ${upPercent.toFixed(1)}% · ${observation}`;
}

function marketBreadth(note: string): { upPercent: number } | null {
  const match = note.match(/上涨\s*([\d,]+)\s*家[，,]\s*下跌\s*([\d,]+)\s*家/);
  if (!match) return null;
  const up = Number(match[1].replaceAll(',', ''));
  const down = Number(match[2].replaceAll(',', ''));
  const total = up + down;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { upPercent: Number(((up / total) * 100).toFixed(1)) };
}

function marketFlowLabel(note: string): string {
  const match = note.match(/^主力净流入\s*(-[\d,.]+)\s*亿元([。.]?)$/);
  if (!match) return note;
  return `主力净流出 ${match[1].slice(1)} 亿元${match[2] || '。'}`;
}

export function sectorTrendValues(values: readonly number[]): number[] | null {
  return values.length >= 2 ? [...values] : null;
}
