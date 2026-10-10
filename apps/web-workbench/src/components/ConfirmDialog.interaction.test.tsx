// @vitest-environment happy-dom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
afterEach(cleanup);
describe('confirmation layer dismissal', () => {
  it('Escape closes only the top confirmation without confirming or propagating', () => {
    const outerClose = vi.fn(); const innerClose = vi.fn(); const confirm = vi.fn();
    const underlyingEscape = vi.fn(); document.addEventListener('keydown', underlyingEscape);
    function Fixture() {
      const [open, setOpen] = useState(true);
      return <><ConfirmDialog open title="底层" onClose={outerClose} onConfirm={confirm} />
        <ConfirmDialog open={open} title="删除定时任务？" onClose={() => {innerClose(); setOpen(false);}} onConfirm={confirm} /></>;
    }
    render(<Fixture />);
    fireEvent.keyDown(screen.getAllByRole('button', {name:'取消'})[1], {key:'Escape'});
    expect(innerClose).toHaveBeenCalledOnce(); expect(outerClose).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled(); expect(underlyingEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', {name:'删除定时任务？'})).toBeNull();
    expect(screen.getByRole('dialog', {name:'底层'})).toBeTruthy();
    document.removeEventListener('keydown', underlyingEscape);
  });
  it('keeps an in-flight confirmation open and consumes Escape', async () => {
    const close = vi.fn(); const confirm = vi.fn(() => new Promise<void>(() => {}));
    render(<ConfirmDialog open title="确认" onClose={close} onConfirm={confirm} />);
    fireEvent.click(screen.getByRole('button', {name:'确定'}));
    fireEvent.keyDown(window, {key:'Escape'});
    expect(close).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog').parentElement).toBe(document.body);
  });
});
