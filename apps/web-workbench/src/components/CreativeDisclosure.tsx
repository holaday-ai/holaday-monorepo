import { ChevronRight } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

/** Keep occupied space animated in both directions; collapsed contents cannot receive focus. */
export function CreativeDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="hd-creative-disclosure">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight aria-hidden />
        {label}
      </button>
      <div
        id={id}
        className="hd-creative-disclosure-fold"
        data-open={open}
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
      >
        <div>{children}</div>
      </div>
    </section>
  );
}
