export type ToastKind = 'error' | 'info';

export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly text: string;
}

export const TOAST_STACK_LIMIT = 3;

export function enqueueToastItem(
  items: readonly ToastItem[],
  item: ToastItem,
  limit = TOAST_STACK_LIMIT,
): ToastItem[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  return [
    ...items.filter(
      (existing) => existing.kind !== item.kind || existing.text !== item.text,
    ),
    item,
  ].slice(-safeLimit);
}
