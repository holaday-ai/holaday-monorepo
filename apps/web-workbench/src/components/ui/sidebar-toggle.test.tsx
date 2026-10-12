// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from './sidebar';

function Preference() {
  const { open } = useSidebar();
  return <output aria-label="保存的侧栏偏好">{String(open)}</output>;
}
function Fixture({ forced = false, defaultOpen = true }) {
  return (
    <SidebarProvider forceCollapsed={forced} defaultOpen={defaultOpen}>
      <Sidebar collapsible="icon" variant="floating">
        <SidebarTrigger />
        <DropdownMenu>
          <DropdownMenuTrigger>侧栏菜单</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
              侧栏操作
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Sidebar>
      <button type="button">内容区域</button>
      <Preference />
    </SidebarProvider>
  );
}
const toggle = () => screen.getByRole('button', { name: '切换侧边栏' });
const preference = () => screen.getByLabelText('保存的侧栏偏好').textContent;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = 'sidebar:state=; max-age=0; path=/';
});

describe('adaptive sidebar toggle', () => {
  it.each([true, false])(
    'opens and closes an overlay without changing saved preference %s',
    async (saved) => {
      const user = userEvent.setup();
      render(<Fixture forced defaultOpen={saved} />);
      const cookie = document.cookie;
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().title).toBe('展开侧边栏');
      await user.click(toggle());
      expect(screen.getByRole('dialog', { name: '侧边栏导航' })).toBeTruthy();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().title).toBe('收起侧边栏');
      expect(preference()).toBe(String(saved));
      expect(document.cookie).toBe(cookie);
      await user.click(toggle());
      expect(screen.queryByRole('dialog', { name: '侧边栏导航' })).toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(preference()).toBe(String(saved));
      expect(document.cookie).toBe(cookie);
    },
  );

  it('dismisses on an outside click or Escape and supports the keyboard toggle', async () => {
    const user = userEvent.setup();
    render(<Fixture forced />);
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: '内容区域' }));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
    expect(preference()).toBe('true');
  });

  it('keeps portalled sidebar menus usable and lets Escape close the menu first', async () => {
    const user = userEvent.setup();
    render(<Fixture forced />);
    const trigger = toggle();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '侧栏菜单' }));
    await user.click(screen.getByRole('menuitem', { name: '侧栏操作' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it.each([true, false])(
    'restores preference %s when the viewport leaves forced mode',
    async (saved) => {
      const user = userEvent.setup();
      const { rerender } = render(<Fixture forced defaultOpen={saved} />);
      await user.click(toggle());
      rerender(<Fixture forced={false} defaultOpen={saved} />);
      expect(screen.queryByRole('dialog', { name: '侧边栏导航' })).toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe(String(saved));
      expect(preference()).toBe(String(saved));
      rerender(<Fixture forced defaultOpen={saved} />);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    },
  );

  it('uses the mobile sheet at the 768px boundary without changing desktop preference', async () => {
    vi.stubGlobal('innerWidth', 768);
    const user = userEvent.setup();
    render(
      <SidebarProvider forceCollapsed>
        <SidebarTrigger aria-label="打开导航" />
        <Sidebar>
          <SidebarTrigger />
        </Sidebar>
        <Preference />
      </SidebarProvider>,
    );
    const cookie = document.cookie;
    await user.click(screen.getByRole('button', { name: '打开导航' }));
    expect(screen.getByRole('dialog', { name: '任务列表' })).toBeTruthy();
    await user.click(toggle());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(preference()).toBe('true');
    expect(document.cookie).toBe(cookie);
  });

  it('retains the wide-screen persisted toggle behavior', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(toggle());
    expect(preference()).toBe('false');
    expect(document.cookie).toContain('sidebar:state=false');
    await user.click(toggle());
    expect(preference()).toBe('true');
    expect(document.cookie).toContain('sidebar:state=true');
    expect(screen.queryByRole('dialog', { name: '侧边栏导航' })).toBeNull();
  });
});
