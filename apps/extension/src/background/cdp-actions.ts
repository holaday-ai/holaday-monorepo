/**
 * CDP action executor for the vision loop.
 *
 * When the orchestrator sends `server.vision.act`, the SW translates
 * the `VisionAction` into a sequence of `chrome.debugger.sendCommand`
 * calls against the Chrome DevTools Protocol (CDP). That's the only
 * way a Chrome extension can simulate real user input at arbitrary
 * (x, y) coordinates — content-script `dispatchEvent` doesn't trigger
 * native behaviours (focus rings, IME, keyboard shortcuts).
 *
 * Coordinate contract: `VisionAction.click.x/y` are already REAL
 * viewport pixels when we get them (the orchestrator pre-translated
 * from Claude's model-space via `modelCoordToReal`). No scaling here.
 *
 * Debugger attach is lazy + idempotent — we attach on the first action
 * for a given tabId and keep the session open until detach is asked
 * for explicitly (or the tab closes). Phase A: every task is a fresh
 * SW instance; Phase B will wire detach to task-teardown.
 *
 * Screenshot: delegates to the existing adapter fallback chain in
 * crx-adapter.ts (playwright clean → playwright plain → raw CDP →
 * captureVisibleTab). The vision-loop uses that path for the `SW →
 * client.vision.observation` round-trip too, so we keep one screenshot
 * implementation across classic and vision flows.
 */

import type { VisionAction } from '@holaday/shared-types';
import { withDeadline } from '../shared/deadline.js';
import { sanitizePageContextUrl } from '../shared/page-context.js';

export interface ActionResult {
  ok: boolean;
  /** Short free-text the orchestrator plumbs through to Claude on the
   *  next tick's tool_result — so Claude can see when an action's
   *  coordinate was off-screen, the debugger bounced, etc. */
  message?: string;
}

/** CDP protocol version we pin every attach to. */
const CDP_VERSION = '1.3';
/** Per-command hard cap; CDP should answer sub-second for input events. */
const CDP_COMMAND_TIMEOUT_MS = 5_000;
const CDP_ATTACH_TIMEOUT_MS = 5_000;
const CDP_DETACH_TIMEOUT_MS = 2_000;
const ACTIVE_TAB_QUERY_TIMEOUT_MS = 1_500;
const TAB_METADATA_TIMEOUT_MS = 1_000;
const VIEWPORT_READ_TIMEOUT_MS = 500;
/** How long to wait before reporting a wait() complete (honours upper bound). */
const WAIT_CAP_MS = 10_000;
const MAX_NAVIGATE_URL_LENGTH = 2048;
const TYPE_TEXT_CHUNK_CHARS = 1_000;
const MAX_TYPE_TEXT_CHARS = 4_000;
const MAX_KEY_DESCRIPTOR_CHARS = 64;
const MAX_ACTION_RESULT_MESSAGE_CHARS = 1_000;
const MAX_SCROLL_DELTA_PX = 5_000;
const MOUSE_BUTTONS = new Set(['left', 'right', 'middle']);

/** Tabs we've already attached the debugger to this SW lifetime. */
const attachedTabs = new Set<number>();
const pendingAttachByTab = new Map<number, Promise<void>>();

function forgetAttachedTab(tabId: number): void {
  attachedTabs.delete(tabId);
  pendingAttachByTab.delete(tabId);
}

if (typeof chrome !== 'undefined') {
  chrome.debugger?.onDetach?.addListener?.((source) => {
    if (typeof source.tabId === 'number') forgetAttachedTab(source.tabId);
  });
  chrome.tabs?.onRemoved?.addListener?.((tabId) => {
    forgetAttachedTab(tabId);
  });
}

/**
 * Idempotently attach the debugger to the target tab. Returns quietly
 * if already attached; throws if the user denied the permission dialog
 * or the tab vanished.
 */
async function ensureAttached(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return;
  const pending = pendingAttachByTab.get(tabId);
  if (pending) {
    await pending;
    return;
  }
  const attachPromise = withDeadline(
    chrome.debugger.attach({ tabId }, CDP_VERSION),
    CDP_ATTACH_TIMEOUT_MS,
    'debugger_attach_timeout',
  )
    .then(() => {
      attachedTabs.add(tabId);
    })
    .finally(() => {
      pendingAttachByTab.delete(tabId);
    });
  pendingAttachByTab.set(tabId, attachPromise);
  await attachPromise;
}

/**
 * Public escape hatch — release the debugger from a specific tab (or
 * all tabs this SW has attached). Callers should invoke on task
 * teardown. Failure to detach is not fatal — Chrome auto-detaches
 * when the tab closes or the SW is torn down.
 */
export async function detachFromTab(tabId: number): Promise<void> {
  const pending = pendingAttachByTab.get(tabId);
  if (pending && !attachedTabs.has(tabId)) {
    try {
      await pending;
    } catch {
      return;
    }
  }
  if (!attachedTabs.has(tabId)) return;
  try {
    await withDeadline(
      chrome.debugger.detach({ tabId }),
      CDP_DETACH_TIMEOUT_MS,
      'debugger_detach_timeout',
    );
  } catch {
    // best-effort: tab may already be closed / debugger was released
  } finally {
    forgetAttachedTab(tabId);
  }
}

export async function detachAll(): Promise<void> {
  const ids = new Set([...attachedTabs, ...pendingAttachByTab.keys()]);
  await Promise.allSettled([...ids].map((id) => detachFromTab(id)));
}

/**
 * Execute one VisionAction on the given tab. Returns `{ok}` and an
 * optional diagnostic message. Never throws — CDP failures become
 * `{ok: false, message: ...}` so the loop can continue.
 *
 * Terminal actions (`done` / `give_up`) are a no-op at the driver
 * level; the orchestrator handles them without dispatching an act
 * frame to the SW. If one ever arrives here, we report ok=true so
 * the loop can close cleanly.
 */
export async function executeCdpAction(tabId: number, action: VisionAction): Promise<ActionResult> {
  try {
    let result: ActionResult;
    switch (action.kind) {
      case 'click':
        result = await doClick(tabId, action);
        break;
      case 'type':
        result = await doType(tabId, action);
        break;
      case 'key':
        result = await doKey(tabId, action);
        break;
      case 'scroll':
        result = await doScroll(tabId, action);
        break;
      case 'navigate':
        result = await doNavigate(tabId, action);
        break;
      case 'wait_for_human':
        // Orchestrator does the polling + Layer 4 bookkeeping for this
        // action; the extension just acknowledges so the runner sees
        // ok:true and proceeds to the wait loop (triggered server-side
        // via the runner's turn subscription).
        result = { ok: true, message: `wait_for_human: ${action.reason}` };
        break;
      case 'wait':
        result = await doWait(action);
        break;
      case 'screenshot':
        // A `screenshot` action means "re-observe without acting";
        // the runner takes a fresh observation on the next tick, so
        // there's nothing to dispatch here.
        result = { ok: true, message: 'screenshot re-observation noop' };
        break;
      case 'done':
      case 'give_up':
        result = { ok: true, message: `${action.kind} terminal; no driver work` };
        break;
      default:
        result = { ok: false, message: '浏览器操作类型无效，请重新生成操作' };
        break;
    }
    return sanitizeActionResult(result);
  } catch (err) {
    return sanitizeActionResult({ ok: false, message: cdpActionErrorMessage(err) });
  }
}

function sanitizeActionResult(result: ActionResult): ActionResult {
  if (!result.message || result.message.length <= MAX_ACTION_RESULT_MESSAGE_CHARS) {
    return result;
  }
  return {
    ...result,
    message: result.message.slice(0, MAX_ACTION_RESULT_MESSAGE_CHARS),
  };
}

export function cdpActionErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (message.startsWith('bad_url')) {
    return '导航地址无效，请检查后重试';
  }
  if (
    lower.includes('no tab with id') ||
    lower.includes('tab closed') ||
    lower.includes('target closed') ||
    lower.includes('target detached') ||
    lower.includes('not attached') ||
    lower.includes('frame was detached') ||
    lower.includes('target navigated or closed') ||
    lower.includes('execution context was destroyed') ||
    lower.includes('cannot find context with specified id')
  ) {
    return '浏览器标签页已关闭或连接中断，请重新打开页面后重试';
  }
  if (
    lower.includes('another debugger') ||
    lower.includes('debugger is already attached') ||
    lower.includes('debugger already attached')
  ) {
    return '浏览器调试通道被占用，请关闭该标签页 DevTools 后重试';
  }
  if (
    lower.includes('missing host permission') ||
    lower.includes('cannot access contents of url') ||
    lower.includes('cannot access contents of the page') ||
    lower.includes('extension manifest must request permission') ||
    lower.includes('activetab permission') ||
    lower.includes('cannot access a chrome:// url') ||
    lower.includes('cannot access a chrome-extension:// url') ||
    lower.includes('cannot access a file:// url') ||
    lower.includes('extensions gallery cannot be scripted') ||
    lower.includes('cannot be scripted')
  ) {
    return '扩展没有这个页面的访问权限，请检查扩展权限后重试';
  }
  if (lower.includes('timeout')) {
    return '浏览器操作超时，请保持标签页打开后重试';
  }
  return '浏览器操作失败，请稍后重试';
}

// ---------------------------------------------------------------------------
// Per-kind CDP implementations.
// ---------------------------------------------------------------------------

async function doClick(
  tabId: number,
  action: Extract<VisionAction, { kind: 'click' }>,
): Promise<ActionResult> {
  if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) {
    return { ok: false, message: '点击坐标无效，请重新定位后再试' };
  }
  const button = normalizeMouseButton(action.button);
  if (!button) {
    return { ok: false, message: '点击按钮类型无效，请重新生成点击操作' };
  }
  await ensureAttached(tabId);
  const viewport = await getViewportSizeForInput(tabId);
  if (
    viewport &&
    (action.x < 0 || action.y < 0 || action.x >= viewport.width || action.y >= viewport.height)
  ) {
    return {
      ok: false,
      message: `点击坐标超出可视区域 (${Math.round(action.x)},${Math.round(action.y)}) / ${viewport.width}x${viewport.height}，请重新定位`,
    };
  }
  await ensureAttached(tabId);
  // Press then release. CDP's mouseMoved first is unnecessary for a
  // single click — Input.dispatchMouseEvent with `type: 'mousePressed'`
  // implicitly moves. Keep clickCount=1; double-click would be two
  // mousePressed frames.
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button,
    x: action.x,
    y: action.y,
    clickCount: 1,
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button,
    x: action.x,
    y: action.y,
    clickCount: 1,
  });
  return { ok: true, message: `clicked ${button} @ (${action.x},${action.y})` };
}

function normalizeMouseButton(raw: unknown): 'left' | 'right' | 'middle' | null {
  const button = raw ?? 'left';
  return typeof button === 'string' && MOUSE_BUTTONS.has(button)
    ? (button as 'left' | 'right' | 'middle')
    : null;
}

async function doType(
  tabId: number,
  action: Extract<VisionAction, { kind: 'type' }>,
): Promise<ActionResult> {
  if (typeof action.text !== 'string') {
    return { ok: false, message: '输入文本无效，请重新生成输入内容' };
  }
  if (action.text.length > MAX_TYPE_TEXT_CHARS) {
    return { ok: false, message: '输入文本过长，请拆成更短步骤后重试' };
  }
  await ensureAttached(tabId);
  // Input.insertText dispatches a real `input` event on the focused
  // element and handles IME / composing glyphs. Works in all input
  // surfaces (text inputs, contenteditable, textareas).
  if (action.text.length === 0) {
    return { ok: true, message: 'typed 0 chars' };
  }
  for (const chunk of chunkString(action.text, TYPE_TEXT_CHUNK_CHARS)) {
    await sendCdp(tabId, 'Input.insertText', { text: chunk });
  }
  return { ok: true, message: `typed ${action.text.length} chars` };
}

async function doKey(
  tabId: number,
  action: Extract<VisionAction, { kind: 'key' }>,
): Promise<ActionResult> {
  if (typeof action.key !== 'string' || action.key.trim().length === 0) {
    return { ok: false, message: '按键指令无效，请重新生成按键操作' };
  }
  if (action.key.length > MAX_KEY_DESCRIPTOR_CHARS) {
    return { ok: false, message: '按键指令过长，请拆成更短步骤后重试' };
  }
  // Support simple chords ("ctrl+a", "cmd+c") by splitting on '+' and
  // folding lowered modifiers into the CDP modifiers bitmask. The
  // terminal key is the last segment.
  const parts = parseKeyDescriptor(action.key);
  if (parts.length === 0) {
    return { ok: false, message: `empty key descriptor: ${action.key}` };
  }
  const last = parts[parts.length - 1];
  if (!last) return { ok: false, message: `empty key descriptor: ${action.key}` };
  let mods = 0;
  for (const modifier of parts.slice(0, -1)) {
    const bit = modifierBit(modifier);
    if (bit === null) {
      return { ok: false, message: '按键组合包含未知修饰键，请重新生成按键操作' };
    }
    mods |= bit;
  }
  const info = resolveKey(last);
  await ensureAttached(tabId);
  await sendCdp(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: mods,
    key: info.key,
    code: info.code,
    ...(mods === 0 && info.text ? { text: info.text } : {}),
    ...(info.windowsVirtualKeyCode !== undefined
      ? { windowsVirtualKeyCode: info.windowsVirtualKeyCode }
      : {}),
  });
  await sendCdp(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: mods,
    key: info.key,
    code: info.code,
    ...(info.windowsVirtualKeyCode !== undefined
      ? { windowsVirtualKeyCode: info.windowsVirtualKeyCode }
      : {}),
  });
  return { ok: true, message: `key ${action.key}` };
}

function parseKeyDescriptor(value: string): string[] {
  if (value.trim() === '+') return ['+'];
  const rawParts = value.split('+').map((p) => p.trim());
  const parts = rawParts.filter((p) => p.length > 0);
  if (parts.length > 0 && rawParts.length > 1 && rawParts[rawParts.length - 1] === '') {
    parts.push('+');
  }
  return parts;
}

async function doScroll(
  tabId: number,
  action: Extract<VisionAction, { kind: 'scroll' }>,
): Promise<ActionResult> {
  if (!Number.isFinite(action.dy)) {
    return { ok: false, message: '滚动距离无效，请重新判断后再试' };
  }
  const deltaY = Math.max(-MAX_SCROLL_DELTA_PX, Math.min(MAX_SCROLL_DELTA_PX, action.dy));
  await ensureAttached(tabId);
  // Scroll via mouseWheel at viewport centre. Read the live viewport
  // when possible so narrow windows / side panels do not receive
  // off-screen wheel events.
  const point = await getViewportCenterForInput(tabId);
  await ensureAttached(tabId);
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: 0,
    deltaY,
  });
  return { ok: true, message: `scrolled ${deltaY}px` };
}

async function getViewportCenterForInput(tabId: number): Promise<{ x: number; y: number }> {
  const viewport = await getViewportSizeForInput(tabId);
  if (viewport) {
    return {
      x: Math.max(1, Math.floor(viewport.width / 2)),
      y: Math.max(1, Math.floor(viewport.height / 2)),
    };
  }
  return { x: 400, y: 300 };
}

async function getViewportSizeForInput(
  tabId: number,
): Promise<{ width: number; height: number } | null> {
  try {
    const evalResp = (await sendCdp(
      tabId,
      'Runtime.evaluate',
      {
        expression: 'JSON.stringify({ w: innerWidth, h: innerHeight })',
        returnByValue: true,
      },
      VIEWPORT_READ_TIMEOUT_MS,
    )) as { result?: { value?: unknown } };
    const raw = evalResp?.result?.value;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as { w?: number; h?: number };
      const width = typeof parsed.w === 'number' && Number.isFinite(parsed.w) ? parsed.w : 0;
      const height = typeof parsed.h === 'number' && Number.isFinite(parsed.h) ? parsed.h : 0;
      if (width > 0 && height > 0) {
        return { width: Math.floor(width), height: Math.floor(height) };
      }
    }
  } catch {
    // Keep input robust on pages where Runtime.evaluate is blocked.
  }
  return null;
}

async function doWait(action: Extract<VisionAction, { kind: 'wait' }>): Promise<ActionResult> {
  if (!Number.isFinite(action.ms)) {
    return { ok: false, message: '等待时间无效，请重新生成等待操作' };
  }
  const ms = Math.max(0, Math.min(action.ms, WAIT_CAP_MS));
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return { ok: true, message: `waited ${ms}ms` };
}

async function doNavigate(
  tabId: number,
  action: Extract<VisionAction, { kind: 'navigate' }>,
): Promise<ActionResult> {
  const url = normalizeCdpNavigateUrl(action.url);
  await ensureAttached(tabId);
  const resp = (await sendCdp(tabId, 'Page.navigate', { url })) as { errorText?: unknown };
  if (typeof resp?.errorText === 'string' && resp.errorText.trim()) {
    return {
      ok: false,
      message: cdpNavigateErrorMessage(resp.errorText),
    };
  }
  return { ok: true, message: `navigated to ${sanitizePageContextUrl(url)}` };
}

function cdpNavigateErrorMessage(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes('err_name_not_resolved')) {
    return '页面导航失败：域名无法解析，请检查网址后重试';
  }
  if (lower.includes('err_internet_disconnected')) {
    return '页面导航失败：浏览器网络已断开，请恢复网络后重试';
  }
  if (lower.includes('err_timed_out') || lower.includes('timeout')) {
    return '页面导航超时，请稍后重试';
  }
  if (lower.includes('err_aborted')) {
    return '页面导航被中断，请确认页面没有被手动关闭后重试';
  }
  return '页面导航失败，请检查地址后重试';
}

export function normalizeCdpNavigateUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > MAX_NAVIGATE_URL_LENGTH) {
    throw new Error('bad_url');
  }

  const normalized = hasHierarchicalUrlScheme(value) ? value : normalizeBareNavigateUrl(value);

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('bad_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('bad_url');
  }
  return parsed.href;
}

function hasHierarchicalUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function normalizeBareNavigateUrl(value: string): string {
  const localHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i.test(value);
  return `${localHost ? 'http' : 'https'}://${value}`;
}

// ---------------------------------------------------------------------------
// CDP plumbing.
// ---------------------------------------------------------------------------

/**
 * Send a CDP command with a hard-cap timeout wrapper. The underlying
 * `chrome.debugger.sendCommand` is a Promise-returning API on MV3
 * but silently hangs on detached targets; the cap protects us.
 */
async function sendCdp(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = CDP_COMMAND_TIMEOUT_MS,
): Promise<unknown> {
  try {
    return await sendCdpOnce(tabId, method, params, timeoutMs);
  } catch (err) {
    if (!shouldRetryCdpAfterReattach(err)) throw err;
    await ensureAttached(tabId);
    return sendCdpOnce(tabId, method, params, timeoutMs);
  }
}

async function sendCdpOnce(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`CDP ${method} timeout ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      chrome.debugger.sendCommand({ tabId }, method, params) as Promise<unknown>,
      cap,
    ]);
  } catch (err) {
    if (shouldResetCdpSession(err)) {
      forgetAttachedTab(tabId);
      try {
        await withDeadline(
          chrome.debugger.detach({ tabId }),
          CDP_DETACH_TIMEOUT_MS,
          'debugger_detach_timeout',
        );
      } catch {
        // best-effort: the target may already be gone or detached
      }
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function shouldRetryCdpAfterReattach(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes('not attached') ||
    lower.includes('target detached') ||
    lower.includes('detached from target') ||
    lower.includes('no session with given id')
  );
}

function shouldResetCdpSession(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('no tab with id') ||
    lower.includes('tab closed') ||
    lower.includes('target closed') ||
    lower.includes('target detached') ||
    lower.includes('not attached') ||
    lower.includes('frame was detached') ||
    lower.includes('target navigated or closed') ||
    lower.includes('execution context was destroyed') ||
    lower.includes('cannot find context with specified id')
  );
}

function chunkString(value: string, chunkChars: number): string[] {
  if (value.length <= chunkChars) return [value];
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkChars) {
    chunks.push(value.slice(i, i + chunkChars));
  }
  return chunks;
}

/**
 * CDP modifier bitmask:
 *   1 = alt, 2 = ctrl, 4 = meta/cmd, 8 = shift
 * We lowercase the name so "Ctrl"/"ctrl"/"Cmd"/"cmd" all work.
 */
function modifierBit(name: string): number | null {
  switch (name.toLowerCase()) {
    case 'alt':
    case 'option':
      return 1;
    case 'ctrl':
    case 'control':
      return 2;
    case 'meta':
    case 'cmd':
    case 'command':
    case 'super':
    case 'win':
    case 'windows':
      return 4;
    case 'shift':
      return 8;
    default:
      return null;
  }
}

interface KeyInfo {
  /** DOM KeyboardEvent.key (e.g. "Enter", "a", "ArrowDown"). */
  key: string;
  /** DOM KeyboardEvent.code (e.g. "Enter", "KeyA", "ArrowDown"). */
  code: string;
  /** Character that would be inserted; required for printable keys. */
  text?: string;
  /** Windows VK code — some CDP callers require it for correctness. */
  windowsVirtualKeyCode?: number;
}

/**
 * Map a named key (or single printable char) onto CDP's expected
 * shape. Covers the common special keys; a plain "a" or "X" falls
 * through to the printable-char branch.
 */
function resolveKey(name: string): KeyInfo {
  const named: Record<string, KeyInfo> = {
    enter: { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
    return: { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
    escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    tab: { key: 'Tab', code: 'Tab', text: '\t', windowsVirtualKeyCode: 9 },
    backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    space: { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 },
    '+': { key: '+', code: 'Equal', text: '+', windowsVirtualKeyCode: 187 },
    plus: { key: '+', code: 'Equal', text: '+', windowsVirtualKeyCode: 187 },
    '=': { key: '=', code: 'Equal', text: '=', windowsVirtualKeyCode: 187 },
    equal: { key: '=', code: 'Equal', text: '=', windowsVirtualKeyCode: 187 },
    '-': { key: '-', code: 'Minus', text: '-', windowsVirtualKeyCode: 189 },
    minus: { key: '-', code: 'Minus', text: '-', windowsVirtualKeyCode: 189 },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
    end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
    pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
    pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
    '/': { key: '/', code: 'Slash', text: '/', windowsVirtualKeyCode: 191 },
    slash: { key: '/', code: 'Slash', text: '/', windowsVirtualKeyCode: 191 },
    '\\': { key: '\\', code: 'Backslash', text: '\\', windowsVirtualKeyCode: 220 },
    backslash: { key: '\\', code: 'Backslash', text: '\\', windowsVirtualKeyCode: 220 },
    ',': { key: ',', code: 'Comma', text: ',', windowsVirtualKeyCode: 188 },
    comma: { key: ',', code: 'Comma', text: ',', windowsVirtualKeyCode: 188 },
    '.': { key: '.', code: 'Period', text: '.', windowsVirtualKeyCode: 190 },
    period: { key: '.', code: 'Period', text: '.', windowsVirtualKeyCode: 190 },
  };
  const special = named[name.toLowerCase()];
  if (special) return special;
  const functionKey = name.match(/^f([1-9]|1[0-2])$/i);
  if (functionKey?.[1]) {
    const index = Number(functionKey[1]);
    return {
      key: `F${index}`,
      code: `F${index}`,
      windowsVirtualKeyCode: 111 + index,
    };
  }
  // Single printable char — emit as `text` so CDP inserts it.
  if (name.length === 1) {
    const code = /^[a-z]$/i.test(name)
      ? `Key${name.toUpperCase()}`
      : /^[0-9]$/.test(name)
        ? `Digit${name}`
        : name;
    const windowsVirtualKeyCode = /^[a-z0-9]$/i.test(name)
      ? name.toUpperCase().charCodeAt(0)
      : undefined;
    return {
      key: name,
      code,
      text: name,
      ...(windowsVirtualKeyCode !== undefined ? { windowsVirtualKeyCode } : {}),
    };
  }
  // Unknown multi-char name — let CDP try it raw and fail diagnostically.
  return { key: name, code: name };
}

/**
 * Test seam: reset the module-level attach set. Used by unit tests so
 * each scenario starts with no attachments assumed.
 */
export function _resetAttachedTabsForTests(): void {
  attachedTabs.clear();
  pendingAttachByTab.clear();
}

// ---------------------------------------------------------------------------
// Vision-loop observation capture.
// ---------------------------------------------------------------------------

/**
 * Shape the SW reports back to the orchestrator for one tick.
 * `error` (if set) means capture failed — the orchestrator will surface
 * it as the tick's failure reason and exit the loop.
 */
export interface VisionObservationCapture {
  screenshotBase64: string;
  viewportWidth: number;
  viewportHeight: number;
  url: string;
  title: string;
  error?: string;
}

const MAX_OBSERVATION_SCREENSHOT_BASE64_CHARS = 2_000_000;
const OBSERVATION_SCREENSHOT_QUALITIES = [80, 60, 40] as const;
const MAX_OBSERVATION_VIEWPORT_PX = 20_000;
const MAX_OBSERVATION_URL_CHARS = 2048;
const MAX_OBSERVATION_TITLE_CHARS = 512;
const MAX_OBSERVATION_ERROR_CHARS = 1000;

function clipString(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function clampViewportSize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_OBSERVATION_VIEWPORT_PX, Math.round(value)));
}

export function sanitizeVisionObservationCapture(
  observation: VisionObservationCapture,
): VisionObservationCapture {
  let screenshotBase64 = observation.screenshotBase64;
  let error = observation.error;

  if (screenshotBase64.length > MAX_OBSERVATION_SCREENSHOT_BASE64_CHARS) {
    screenshotBase64 = '';
    error = error
      ? `${error}; Page.captureScreenshot returned oversized image`
      : 'Page.captureScreenshot returned oversized image';
  }

  return {
    screenshotBase64,
    viewportWidth: clampViewportSize(observation.viewportWidth),
    viewportHeight: clampViewportSize(observation.viewportHeight),
    url: clipString(sanitizePageContextUrl(observation.url), MAX_OBSERVATION_URL_CHARS),
    title: clipString(observation.title, MAX_OBSERVATION_TITLE_CHARS),
    ...(error ? { error: clipString(error, MAX_OBSERVATION_ERROR_CHARS) } : {}),
  };
}

/**
 * Pick the currently-active tab in the foreground window — the tab the
 * user is looking at. The vision loop always operates on whatever's
 * in front; we don't try to track a specific task's tab (Phase B).
 *
 * Returns null when there's no active tab (e.g. SW launched during
 * Chrome startup before any window has focus) so callers can surface
 * a clean error instead of crashing.
 */
export async function getActiveTabId(
  opts: { allowErrorPage?: boolean } = {},
): Promise<number | null> {
  const queries: chrome.tabs.QueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { active: true, windowType: 'normal' },
    { windowType: 'normal' },
  ];
  const candidateGroups = await Promise.all(
    queries.map(async (query, queryIndex) => {
      try {
        const tabs = await withDeadline(
          chrome.tabs.query(query),
          ACTIVE_TAB_QUERY_TIMEOUT_MS,
          'active_tab_query_timeout',
        );
        return tabs
          .filter((tab) => typeof tab?.id === 'number')
          .map((tab, tabIndex) => ({ tab, queryIndex, tabIndex }));
      } catch {
        // Keep walking the fallback chain; Chrome can transiently reject
        // currentWindow lookups while another normal window is still usable.
        return [];
      }
    }),
  );
  const candidates = candidateGroups.flat();

  const webTab = pickBestActiveTabCandidate(candidates, (tab) => {
    const url = getTabUrlForCdp(tab);
    return (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      Boolean(opts.allowErrorPage && url.toLowerCase().startsWith('chrome-error://'))
    );
  });
  const nonInternalTab = pickBestActiveTabCandidate(candidates, (tab) => {
    const url = getTabUrlForCdp(tab);
    if (opts.allowErrorPage && url.toLowerCase().startsWith('chrome-error://')) return true;
    return (
      !url ||
      !/^(chrome|chrome-extension|chrome-error|edge|about|devtools|view-source|file):/i.test(url)
    );
  });
  const tab = webTab ?? nonInternalTab;
  if (!tab || typeof tab.id !== 'number') return null;
  await activateTabForCdpIfNeeded(tab);
  return tab.id;
}

function getTabUrlForCdp(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || '';
}

function pickBestActiveTabCandidate(
  candidates: Array<{ tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number }>,
  predicate: (tab: chrome.tabs.Tab) => boolean,
): chrome.tabs.Tab | null {
  const [best] = candidates
    .filter(({ tab }) => predicate(tab))
    .sort(compareActiveTabCandidates);
  return best?.tab ?? null;
}

async function activateTabForCdpIfNeeded(tab: chrome.tabs.Tab): Promise<void> {
  if (typeof tab.id === 'number' && tab.active === false) {
    try {
      await withDeadline(
        chrome.tabs.update(tab.id, { active: true }),
        TAB_METADATA_TIMEOUT_MS,
        'active_tab_update_timeout',
      );
    } catch {
      // Best effort only: CDP can still operate on the selected tab, but
      // foregrounding it keeps the user's visible page aligned when possible.
    }
  }
  if (typeof tab.windowId === 'number' && chrome.windows?.update) {
    try {
      const updateInfo: chrome.windows.UpdateInfo = { focused: true };
      if (chrome.windows.get) {
        try {
          const win = await withDeadline(
            chrome.windows.get(tab.windowId),
            TAB_METADATA_TIMEOUT_MS,
            'active_window_get_timeout',
          );
          if (win?.state === 'minimized') {
            updateInfo.state = 'normal';
          }
        } catch {
          // Focus below is still the useful best-effort action.
        }
      }
      await withDeadline(
        chrome.windows.update(tab.windowId, updateInfo),
        TAB_METADATA_TIMEOUT_MS,
        'active_window_update_timeout',
      );
    } catch {
      // Best effort only: window focus may be unavailable on some Chrome surfaces.
    }
  }
}

function compareActiveTabCandidates(
  a: { tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number },
  b: { tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number },
): number {
  if (a.queryIndex !== b.queryIndex) return a.queryIndex - b.queryIndex;
  const aLastAccessed = typeof a.tab.lastAccessed === 'number' ? a.tab.lastAccessed : 0;
  const bLastAccessed = typeof b.tab.lastAccessed === 'number' ? b.tab.lastAccessed : 0;
  if (aLastAccessed !== bLastAccessed) return bLastAccessed - aLastAccessed;
  return a.tabIndex - b.tabIndex;
}

/**
 * Capture one observation via raw CDP: screenshot + viewport dims +
 * url + title. Single round-trip through the debugger session (two
 * CDP calls: Page.captureScreenshot, Runtime.evaluate for dims/url/
 * title). Attaches debugger idempotently via ensureAttached.
 *
 * Never throws — any CDP failure returns a result with `error` set
 * plus best-effort defaults for the other fields. The orchestrator
 * checks `error` first; populated = failed tick.
 */
export async function captureVisionObservation(tabId: number): Promise<VisionObservationCapture> {
  try {
    await ensureAttached(tabId);
  } catch (err) {
    return sanitizeVisionObservationCapture({
      screenshotBase64: '',
      viewportWidth: 0,
      viewportHeight: 0,
      url: '',
      title: '',
      error: `debugger attach failed: ${cdpActionErrorMessage(err)}`,
    });
  }

  // Read viewport + url + title FIRST so we still have metadata even
  // if the screenshot capture then fails.
  let viewportWidth = 0;
  let viewportHeight = 0;
  let url = '';
  let title = '';
  try {
    const evalResp = (await sendCdp(tabId, 'Runtime.evaluate', {
      expression:
        'JSON.stringify({ w: innerWidth, h: innerHeight, u: location.href, t: document.title })',
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    const raw = evalResp?.result?.value;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as { w?: number; h?: number; u?: string; t?: string };
      viewportWidth = Math.round(parsed.w ?? 0);
      viewportHeight = Math.round(parsed.h ?? 0);
      url = parsed.u ?? '';
      title = parsed.t ?? '';
    }
  } catch {
    // Tab may be an extension page, chrome://, or otherwise not
    // evaluable. Fall through with zeros; screenshot may still succeed.
  }
  if (!url || !title) {
    const tabMeta = await readTabMetadata(tabId);
    url ||= tabMeta.url;
    title ||= tabMeta.title;
  }

  let screenshotBase64 = '';
  let error: string | undefined;
  try {
    await ensureAttached(tabId);
    for (const quality of OBSERVATION_SCREENSHOT_QUALITIES) {
      const shot = (await sendCdp(tabId, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        captureBeyondViewport: false,
      })) as { data?: unknown };
      if (typeof shot?.data !== 'string' || shot.data.length === 0) {
        error = `Page.captureScreenshot returned non-string data (${typeof shot?.data})`;
        break;
      }
      if (shot.data.length <= MAX_OBSERVATION_SCREENSHOT_BASE64_CHARS) {
        screenshotBase64 = shot.data;
        error = undefined;
        break;
      }
      error = 'Page.captureScreenshot returned oversized image';
    }
  } catch (err) {
    error = `Page.captureScreenshot failed: ${cdpActionErrorMessage(err)}`;
  }

  return sanitizeVisionObservationCapture({
    screenshotBase64,
    viewportWidth,
    viewportHeight,
    url,
    title,
    ...(error ? { error } : {}),
  });
}

async function readTabMetadata(tabId: number): Promise<{ url: string; title: string }> {
  try {
    const tab = await withDeadline(
      chrome.tabs.get(tabId),
      TAB_METADATA_TIMEOUT_MS,
      'tab_metadata_timeout',
    );
    return {
      url: getTabUrlForCdp(tab),
      title: typeof tab?.title === 'string' ? tab.title : '',
    };
  } catch {
    return { url: '', title: '' };
  }
}
