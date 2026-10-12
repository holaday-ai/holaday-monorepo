import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar, SidebarMenuButton, SidebarProvider } from './sidebar';
describe('collapsed sidebar accessibility', () => {
  it('retains an explicit name and native tooltip while showing only its icon', () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen={false}>
        <SidebarMenuButton tooltip="新任务 (/)">
          <svg />
          <span>新任务</span>
        </SidebarMenuButton>
      </SidebarProvider>,
    );
    expect(html).toContain('data-icon-only="true"');
    expect(html).toContain('aria-label="新任务"');
    expect(html).toContain('title="新任务 (/)"');
  });
  it('preserves a caller-provided name', () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen={false}>
        <SidebarMenuButton tooltip="项目" aria-label="展开项目">
          <svg />
        </SidebarMenuButton>
      </SidebarProvider>,
    );
    expect(html).toContain('aria-label="展开项目"');
  });
});

it('names automatically collapsed browser-workspace buttons even when manual state stays expanded', () => {
  const renderSidebar = (forceCollapsed: boolean) =>
    renderToStaticMarkup(
      <SidebarProvider defaultOpen forceCollapsed={forceCollapsed}>
        <Sidebar collapsible="icon">
          <SidebarMenuButton tooltip="文件库">
            <svg />
            <span>文件库</span>
          </SidebarMenuButton>
        </Sidebar>
      </SidebarProvider>,
    );
  const collapsed = renderSidebar(true);
  expect(collapsed).toContain('data-icon-only="true"');
  expect(collapsed).toContain('aria-label="文件库"');
  expect(collapsed).toContain('title="文件库"');
  expect(renderSidebar(false)).not.toContain('data-icon-only="true"');
});
