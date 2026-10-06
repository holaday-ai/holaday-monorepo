import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';

/** The approved media menus float beside their trigger and keep keyboard focus. */
export function CreativePopover({
  open,
  onOpenChange,
  anchorRef,
  title,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  anchorRef: RefObject<HTMLButtonElement>;
  title: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState({ left: 20, top: 80 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 392)),
          top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 440)),
        });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          className="hd-creative-popover"
          style={position}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            anchorRef.current?.focus();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close
            className="hd-dialog-close"
            title={`关闭${title}`}
            aria-label={`关闭${title}`}
          >
            <X />
          </Dialog.Close>
          <div className="hd-creative-popover-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
