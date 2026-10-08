// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { FilesPage } from './FilesPage';
import { resetUnavailableFilesForTests } from '@/lib/unavailable-file-registry';
const download = vi.hoisted(()=>vi.fn());
vi.mock('@/lib/download-file', async (importOriginal)=>({...await importOriginal<typeof import('@/lib/download-file')>(),downloadFileAuthed:download}));
const api = vi.hoisted(() => ({ list:vi.fn(), capability:vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc:{files:{list:{query:api.list}},videoEditing:{capability:{query:api.capability}}} }));
vi.mock('@/components/FilePreviewModal', () => ({FilePreviewModal:()=>null}));
const files = [
 {fileId:'file_z',filename:'Z-notes.pdf',mimetype:'application/pdf',sizeBytes:1024,createdAt:'2026-10-05T08:00:00Z'},
 {fileId:'file_a',filename:'A-notes.xlsx',mimetype:'application/vnd.ms-excel',sizeBytes:2048,createdAt:'2026-10-04T08:00:00Z'},
];
beforeEach(()=>{api.list.mockReset();api.list.mockResolvedValue({items:files,nextCursor:null});api.capability.mockResolvedValue({enabled:false});});
afterEach(()=>{cleanup();resetUnavailableFilesForTests();download.mockReset();});
function mount(entry = '/files') {
 const router = createMemoryRouter([{path:'/files',element:<FilesPage/>},{path:'/',element:<main>新任务</main>}],{initialEntries:[entry]});
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

it('restores search, type, view and sort from the URL on back and refresh',async()=>{
 const user=userEvent.setup();const router=mount();
 await screen.findByRole('button',{name:'Z-notes.pdf'});
 await user.type(screen.getByRole('textbox',{name:'搜索文件名'}),'notes');
 await user.click(screen.getByRole('button',{name:'列表视图'}));
 await user.click(screen.getByRole('button',{name:'文件排序'}));
 await user.click(await screen.findByRole('menuitem',{name:'名称顺序'}));
 const saved=router.state.location.search;
 expect(new URLSearchParams(saved).get('q')).toBe('notes');
 await act(async()=>{await router.navigate('/');await router.navigate(-1);});
 expect((screen.getByRole('textbox',{name:'搜索文件名'}) as HTMLInputElement).value).toBe('notes');
 expect(screen.getByRole('button',{name:'列表视图'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByRole('button',{name:'文件排序'}).textContent).toContain('名称顺序');
});

it('hydrates search and all file filters after a fresh page mount, preserving unrelated query values',async()=>{
 const router=mount('/files?q=notes&type=documents&view=list&sort=name&keep=1');
 await screen.findByTitle('预览 A-notes.xlsx');
 expect((screen.getByRole('textbox',{name:'搜索文件名'}) as HTMLInputElement).value).toBe('notes');
 expect(screen.getByRole('button',{name:'列表视图'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByRole('button',{name:'文件排序'}).textContent).toContain('名称顺序');
 expect(new URLSearchParams(router.state.location.search).get('type')).toBe('documents');
 const user=userEvent.setup(); await user.clear(screen.getByRole('textbox',{name:'搜索文件名'}));
 expect(new URLSearchParams(router.state.location.search).get('keep')).toBe('1');
 expect(new URLSearchParams(router.state.location.search).get('q')).toBe(null);
});


it.each([404,410])('shows a missing file as unavailable without an error or dead download action (%s)', async status=>{
 download.mockResolvedValue({ok:false,status,message:'missing bytes'});
 const user=userEvent.setup();mount();
 const file=await screen.findByTitle('预览 Z-notes.pdf');
 const row=file.closest('article, [data-file-id]') ?? file.parentElement!;
 await user.click(within(row as HTMLElement).getByRole('button',{name:'更多操作'}));
 await user.click(await screen.findByRole('menuitem',{name:'下载'}));
 await waitFor(()=>expect(within(row as HTMLElement).getByText('文件已不可用')).toBeTruthy());
 expect(screen.queryByRole('alert')).toBeNull();
 await user.click(within(row as HTMLElement).getByRole('button',{name:'更多操作'}));
 expect(screen.queryByRole('menuitem',{name:'下载'})).toBeNull();
 expect(download).toHaveBeenCalledTimes(1);
});
