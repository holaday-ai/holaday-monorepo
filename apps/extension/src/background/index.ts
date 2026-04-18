/**
 * MV3 service worker entry point.
 * - Listens for popup messages (login token push, manual reconnect).
 * - Holds the single WS connection to the orchestrator (one session per
 *   extension install; manages all tabs the user opens).
 *
 * PoC A1 acceptance: successful 'server.welcome' frame after `connect()`.
 */

import { getAccessToken } from '../shared/storage.js';
import { connect, disconnect, onServerMessage } from './ws-client.js';

let lastWelcomeAt: number | null = null;

onServerMessage((msg) => {
  if (msg.type === 'server.welcome') {
    lastWelcomeAt = Date.now();
    console.info('[holaday] welcome', msg);
  } else if (msg.type === 'server.error') {
    console.warn('[holaday] server error', msg);
  } else {
    console.debug('[holaday] msg', msg);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const token = await getAccessToken();
  if (token) connect(token);
});

chrome.runtime.onStartup.addListener(async () => {
  const token = await getAccessToken();
  if (token) connect(token);
});

// Popup → SW messages (Phase 0 control plane).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'holaday.connect' && typeof msg.token === 'string') {
    connect(msg.token);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'holaday.disconnect') {
    disconnect();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'holaday.status') {
    sendResponse({ lastWelcomeAt });
    return true;
  }
  return false;
});
