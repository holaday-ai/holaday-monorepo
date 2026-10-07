// @vitest-environment happy-dom
import { UserMenu } from '../UserMenu';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../ui/dropdown-menu';
// UserMenu imports the theme store, which reads storage during module evaluation.
// Stub before imports so Node's experimental localStorage never leaks into this test.
const storage = vi.hoisted(() => {
 const entries = new Map<string, string>();
 const value: Storage = {
  get length() { return entries.size; },
  clear: () => entries.clear(),
  getItem: key => entries.get(key) ?? null,
  key: index => [...entries.keys()][index] ?? null,
  removeItem: key => { entries.delete(key); },
  setItem: (key, item) => { entries.set(key, String(item)); },
 };
 vi.stubGlobal('localStorage', value);
 return value;
});
beforeEach(() => storage.clear());
afterAll(() => vi.unstubAllGlobals());
vi.mock('@/lib/trpc', () => ({ trpc: { notifications: {
 unreadCount: { query: vi.fn(async () => ({ count: 1 })) },
 list: { query: vi.fn(async () => ({ items: [], nextCursor: null })) },
} } }));
afterEach(cleanup);
function mount() { render(<MemoryRouter><NotificationBell placement="topbar"/><DropdownMenu><DropdownMenuTrigger>更多测试</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>菜单内容</DropdownMenuItem></DropdownMenuContent></DropdownMenu></MemoryRouter>); }
async function notice() { const button=screen.getByRole('button',{name:/通知/});fireEvent.click(button);await waitFor(()=>expect(button.getAttribute('aria-expanded')).toBe('true'));return button; }
describe('top-level overlay behavior', () => {
 it('closes notifications when another independent Radix menu opens', async () => {
  mount();const button=await notice();
  fireEvent.pointerDown(screen.getByRole('button',{name:'更多测试'}),{button:0,ctrlKey:false,pointerType:'mouse'});
  await screen.findByText('菜单内容');
  expect(button.getAttribute('aria-expanded')).toBe('false');
 });
 it('dismisses notifications on a touch pointer outside and on Escape',async()=>{
  mount();const button=await notice();
  fireEvent.pointerDown(document.body,{pointerType:'touch'});
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await notice();fireEvent.keyDown(document,{key:'Escape'});
  expect(button.getAttribute('aria-expanded')).toBe('false');
 });
});

it('keeps a legal model submenu with its parent and closes it on a second trigger click', async()=>{
 render(<DropdownMenu><DropdownMenuTrigger>附件测试</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuSub><DropdownMenuSubTrigger>模型测试</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>模型选项</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuContent></DropdownMenu>);
 fireEvent.pointerDown(screen.getByRole('button',{name:'附件测试'}),{button:0,ctrlKey:false});
 const trigger=await screen.findByText('模型测试');fireEvent.click(trigger);
 await screen.findByText('模型选项');
 expect(screen.getByText('模型测试')).toBeTruthy();
 fireEvent.click(trigger);
 await waitFor(()=>expect(screen.queryByText('模型选项')).toBeNull());
 expect(screen.getByText('模型测试')).toBeTruthy();
});

it('closes the account menu when the notification menu opens',async()=>{
 render(<MemoryRouter><UserMenu compact displayName="审计用户" email={null} plan="pro" onLogout={()=>undefined}/><NotificationBell placement="topbar"/></MemoryRouter>);
 const account=screen.getByRole('button',{name:'用户菜单：审计用户'});fireEvent.click(account);
 expect(account.getAttribute('aria-expanded')).toBe('true');
 await notice();expect(account.getAttribute('aria-expanded')).toBe('false');
});
