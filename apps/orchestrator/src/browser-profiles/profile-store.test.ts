import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BrowserProfileStore,
  type StoredCookie,
  browserProfileStore,
  filterProfile,
  restoreBrowserProfile,
  saveBrowserProfile,
} from './profile-store.js';

/** CAPTCHA-REDUCE-1: pass a verification once, keep the clearance per user. */
const future = Math.floor(Date.now() / 1000) + 86_400;
const cookie = (
  name: string,
  value: string,
  domain = '.example.test',
  expires = future,
): StoredCookie => ({
  name,
  value,
  domain,
  path: '/',
  expires,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
});
const profile = {
  cookies: [
    cookie('cf_clearance', 'clear-me'),
    cookie('GOOGLE_ABUSE_EXEMPTION', 'ok', '.google.com'),
    cookie('session_id', 'login-secret'),
    cookie('NID', 'session-only', '.google.com', -1),
  ],
  origins: [{ origin: 'https://example.test', localStorage: [{ name: 'k', value: 'v' }] }],
};

describe('profile store', () => {
  const make = (now = () => Date.now()) =>
    new BrowserProfileStore({
      dir: mkdtempSync(join(tmpdir(), 'profiles-')),
      key: randomBytes(32),
      now,
    });
  it('keeps only verification clearance by default, never sign-in sessions', () => {
    expect(filterProfile(profile).cookies.map((c) => c.name)).toEqual([
      'cf_clearance',
      'GOOGLE_ABUSE_EXEMPTION',
    ]);
    expect(filterProfile(profile).origins).toEqual([]);
  });
  it('keeps a clearance name only on the domains that issue it', () => {
    const kept = filterProfile({
      cookies: [
        cookie('NID', 'g', '.google.com'),
        cookie('CONSENT', 'g', '.google.co.uk'),
        cookie('SOCS', 'y', '.youtube.com'),
        cookie('MUID', 'b', '.bing.com'),
        cookie('cf_clearance', 'c', 'shop.example.test'),
        // Same names on other domains are another site's cookies, not clearance.
        cookie('NID', 'session', '.example.test'),
        cookie('CONSENT', 'x', 'google.com.evil.test'),
        cookie('MUID', 'x', '.notbing.com'),
        cookie('GOOGLE_ABUSE_EXEMPTION', 'x', '.example.test'),
      ],
      origins: [],
    }).cookies.map((c) => `${c.name}@${c.domain}`);
    expect(kept).toEqual([
      'NID@.google.com',
      'CONSENT@.google.co.uk',
      'SOCS@.youtube.com',
      'MUID@.bing.com',
      'cf_clearance@shop.example.test',
    ]);
  });
  it('encrypts at rest and reads back for the same user only', async () => {
    const store = make();
    await store.save('usr_a', profile);
    const dir = (store as unknown as { options: { dir: string } }).options.dir;
    const [file] = readdirSync(dir);
    expect(readFileSync(join(dir, file!), 'utf8')).not.toContain('clear-me');
    expect((await store.load('usr_a'))?.cookies.map((c) => c.name)).toEqual([
      'cf_clearance',
      'GOOGLE_ABUSE_EXEMPTION',
    ]);
    expect(await store.load('usr_b')).toBeNull();
    // A file moved under another user's name does not decrypt for them.
    await store.save('usr_b', { cookies: [], origins: [] });
    const files = readdirSync(dir);
    const other = files.find((f) => f !== file)!;
    renameSync(join(dir, file!), join(dir, other));
    expect(await store.load('usr_b')).toBeNull();
  });
  it('expires an idle profile and clears on request', async () => {
    let now = Date.now();
    const store = make(() => now);
    await store.save('usr_a', profile);
    now += 23 * 3_600_000;
    expect(await store.load('usr_a')).not.toBeNull();
    now += 8 * 86_400_000;
    expect(await store.load('usr_a')).toBeNull();
    await store.save('usr_a', profile);
    await store.clear('usr_a');
    expect(await store.load('usr_a')).toBeNull();
  });
  it('a clear wins over a task that was already running (settings or account closure)', async () => {
    let now = Date.now();
    const store = make(() => now);
    const taskStarted = now;
    now += 1000;
    await store.clear('usr_a');
    now += 1000;
    await store.save('usr_a', profile, taskStarted);
    expect(await store.load('usr_a')).toBeNull();
    // A task that starts after the clear saves normally; expiry is not a clear.
    await store.save('usr_a', profile, now);
    expect(await store.load('usr_a')).not.toBeNull();
    const later = now;
    now += 8 * 86_400_000;
    expect(await store.load('usr_a')).toBeNull();
    await store.save('usr_a', profile, later);
    expect(await store.load('usr_a')).not.toBeNull();
  });
  it('is off unless enabled with a 32-byte key', () => {
    expect(browserProfileStore({})).toBeNull();
    expect(
      browserProfileStore({
        BROWSER_PROFILE_STORE_ENABLED: 'true',
        BROWSER_PROFILE_STORE_KEY: 'short',
      }),
    ).toBeNull();
  });
  it('has no wider scope: SCOPE=all is ignored with a warning and still keeps clearance only', async () => {
    const warnings: string[] = [];
    const store = browserProfileStore(
      {
        BROWSER_PROFILE_STORE_ENABLED: 'true',
        BROWSER_PROFILE_STORE_KEY: randomBytes(32).toString('base64'),
        BROWSER_PROFILE_STORE_DIR: mkdtempSync(join(tmpdir(), 'profiles-')),
        BROWSER_PROFILE_STORE_SCOPE: 'all',
      },
      (message) => warnings.push(message),
    );
    expect(warnings).toEqual([
      'BROWSER_PROFILE_STORE_SCOPE only supports "clearance"; the configured value is ignored',
    ]);
    await store!.save('usr_a', profile);
    const loaded = await store!.load('usr_a');
    expect(loaded?.cookies.map((c) => c.name)).toEqual(['cf_clearance', 'GOOGLE_ABUSE_EXEMPTION']);
    expect(loaded?.origins).toEqual([]);
  });
});

describe('a passed verification carries over to the next task (real Chromium)', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    // A site that walls every visitor without its clearance cookie; passing the
    // challenge (the user's click) sets it.
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      if (req.url === '/pass') {
        res.setHeader('set-cookie', 'cf_clearance=passed; Max-Age=86400; Path=/; HttpOnly');
        res.end('<h1>passed</h1>');
        return;
      }
      res.end(
        /cf_clearance=passed/.test(req.headers.cookie ?? '') ? '<h1>content</h1>' : '<h1>wall</h1>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const visit = async (store: BrowserProfileStore, user: string, pass = false) => {
    const context = await browser.newContext();
    await restoreBrowserProfile(context, store, user);
    const page = await context.newPage();
    if (pass) await page.goto(`${base}/pass`);
    await page.goto(`${base}/item`);
    const text = await page.locator('h1').innerText();
    await saveBrowserProfile(context, store, user);
    await context.close();
    return text;
  };
  it('walls once, then not again for the same user within the day; other users still see it', async () => {
    let now = Date.now();
    const store = new BrowserProfileStore({
      dir: mkdtempSync(join(tmpdir(), 'profiles-')),
      key: randomBytes(32),
      now: () => now,
    });
    expect(await visit(store, 'usr_a')).toBe('wall');
    expect(await visit(store, 'usr_a', true)).toBe('content');
    now += 20 * 3_600_000;
    expect(await visit(store, 'usr_a')).toBe('content');
    expect(await visit(store, 'usr_b')).toBe('wall');
    await store.clear('usr_a');
    expect(await visit(store, 'usr_a')).toBe('wall');
  });
});
