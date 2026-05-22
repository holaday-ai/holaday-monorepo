/**
 * Small date helpers for the scheduled calendar. Kept outside the
 * React component so edge cases around past clicks and server
 * roll-forward copy stay unit-testable.
 */

export function nextQuickCreateDate(clicked: Date, now = new Date()): Date {
  if (clicked.getTime() >= now.getTime() + 60_000) return new Date(clicked);

  const out = new Date(now);
  const minutes = out.getMinutes();
  const roundedMinutes = Math.ceil(minutes / 30) * 30;
  out.setSeconds(0, 0);
  if (roundedMinutes >= 60) {
    out.setHours(out.getHours() + 1, 0, 0, 0);
  } else {
    out.setMinutes(roundedMinutes, 0, 0);
  }
  return out;
}

export function formatDateTimeLocalInput(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultScheduledAtLocalInput(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return formatDateTimeLocalInput(d);
}

/**
 * Format an adjusted next-run time for roll-forward toasts. Uses
 * locale-aware "明天 09:00" / "周一 09:00" / "05-23 09:00" style so
 * the user sees the new fire time without parsing an ISO string.
 */
export function formatRollForward(at: Date, now = new Date()): string {
  const startOfDay = (d: Date) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  };
  const diffDays = Math.round(
    (startOfDay(at).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  const time = at.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `明天 ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekday = at.toLocaleDateString('zh-CN', { weekday: 'short' });
    return `${weekday} ${time}`;
  }
  return `${at.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })} ${time}`;
}
