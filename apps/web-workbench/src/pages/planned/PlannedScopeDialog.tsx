import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';
import { Button } from '@/components/ui/button';

export type PlannedScope = 'occurrence' | 'future' | 'series';
export type PlannedScopeActionKind = 'reschedule' | 'remove' | 'update';

interface Props {
  open: boolean;
  kind: PlannedScopeActionKind;
  returnFocusRef: React.RefObject<HTMLElement>;
  onSelect(scope: PlannedScope): void;
  onClose(): void;
}

const TITLES: Record<PlannedScopeActionKind, string> = {
  remove: '删除哪些日程？',
  update: '保存到哪些日程？',
  reschedule: '更改哪些日程？',
};

export function PlannedScopeDialog({
  open,
  kind,
  returnFocusRef,
  onSelect,
  onClose,
}: Props): JSX.Element {
  const firstChoiceRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="planned-scope-dialog" />
        <Dialog.Content
          className="planned-scope-dialog__panel"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstChoiceRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <Dialog.Title>{TITLES[kind]}</Dialog.Title>
          <Dialog.Description>
            这是重复规划。已完成的运行记录不会被修改。
          </Dialog.Description>
          <button ref={firstChoiceRef} type="button" onClick={() => onSelect('occurrence')}>
            仅这一次<span>只调整当前日程</span>
          </button>
          <button type="button" onClick={() => onSelect('future')}>
            这次及以后<span>保留此前记录，拆分后续系列</span>
          </button>
          <button type="button" onClick={() => onSelect('series')}>
            整个系列<span>应用到全部未完成日程</span>
          </button>
          <Dialog.Close asChild>
            <Button variant="ghost">取消</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
