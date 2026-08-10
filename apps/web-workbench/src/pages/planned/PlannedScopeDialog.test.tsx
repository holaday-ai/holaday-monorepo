// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlannedScopeDialog } from './PlannedScopeDialog';

type Scope = 'occurrence' | 'future' | 'series';

afterEach(cleanup);

function Harness({ onSelect = vi.fn() }: { onSelect?: (scope: Scope) => void }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开范围
      </button>
      <PlannedScopeDialog
        open={open}
        kind="update"
        returnFocusRef={triggerRef}
        onSelect={(scope) => {
          onSelect(scope);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe('PlannedScopeDialog', () => {
  it('moves focus inside and closes with Escape before restoring the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '打开范围' });
    await user.click(trigger);

    expect(screen.getByRole('dialog', { name: '保存到哪些日程？' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /仅这一次/ }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab focus in the dialog and reports the chosen scope once', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: '打开范围' }));
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: /这次及以后/ }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('future');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
