// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { FilesPage } from './FilesPage';
const api = vi.hoisted(() => ({ list:vi.fn(), capability:vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc:{files:{list:{query:api.list}},videoEditing:{capability:{query:api.capability}}} }));
vi.mock('@/components/FilePreviewModal', () => ({FilePreviewModal:()=>null}));
const files = [
 {fileId:'file_z',filename:'Z-notes.pdf',mimetype:'application/pdf',sizeBytes:1024,createdAt:'2026-10-05T08:00:00Z'},
 {fileId:'file_a',filename:'A-notes.xlsx',mimetype:'application/vnd.ms-excel',sizeBytes:2048,createdAt:'2026-10-04T08:00:00Z'},
];
beforeEach(()=>{api.list.mockReset();api.list.mockResolvedValue({items:files,nextCursor:null});api.capability.mockResolvedValue({enabled:false});});
afterEach(cleanup);
function mount() {
 const router = createMemoryRouter([{path:'/files',element:<FilesPage/>},{path:'/',element:<main>新任务</main>}],{initialEntries:['/files']});
 render(<ToastProvider><RouterProvider router={router}/></ToastProvider>); return router;
}
describe('file library view integration',()=>{
 it('shows a listed file with missing bytes as unavailable before preview or attachment',async()=>{
  api.list.mockResolvedValue({items:[{...files[0],fileId:'file_storage_gone',filename:'Missing-photo.png',mimetype:'image/png',availability:'unavailable'}],nextCursor:null});mount();
  const button=(await screen.findByText('Missing-photo.png')).closest('button');
  expect((button as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText('已失效')).toBeTruthy();
 });
 it('keeps preview and task attachment actions available after switching view and sorting',async()=>{
  const user=userEvent.setup();const router=mount();
  await screen.findByRole('button',{name:'Z-notes.pdf'});
  await user.click(screen.getByRole('button',{name:'列表视图'}));
  expect(screen.getByRole('button',{name:'列表视图'}).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button',{name:'文件排序'}));
  await user.click(await screen.findByRole('menuitem',{name:'名称顺序'}));
  expect(screen.getAllByTitle(/^预览 /).map(el=>el.getAttribute('title'))).toEqual(['预览 A-notes.xlsx','预览 Z-notes.pdf']);
  await user.click(screen.getByRole('button',{name:'把 A-notes.xlsx 用于新任务'}));
  expect(router.state.location.pathname).toBe('/');
  expect(router.state.location.state).toMatchObject({newTask:true,attachFile:{fileId:'file_a',filename:'A-notes.xlsx'}});
 });
 it('labels sorting as partial when more files remain on the server',async()=>{
  api.list.mockResolvedValue({items:files,nextCursor:42});const user=userEvent.setup();mount();
  await screen.findByRole('button',{name:'Z-notes.pdf'});
  await user.click(screen.getByRole('button',{name:'文件排序'}));
  expect(await screen.findByText('排序应用于已加载的文件')).toBeTruthy();
 });
});
