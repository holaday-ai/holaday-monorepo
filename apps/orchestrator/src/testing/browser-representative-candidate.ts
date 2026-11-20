import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../ws/server.js';

interface Bridge {
  origin: string;
  connections: Array<{ clientId?: string }>;
  received: Array<{ type: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  waitForConnection(count: number, timeout: number): Promise<unknown>;
  call(
    taskId: string,
    kind: string,
    args?: unknown,
    timeout?: number,
  ): Promise<Record<string, unknown>>;
}

/** Real product extension and native Chrome. The loopback WS host/auth are fixtures. */
export async function openRepresentativeChrome(artifacts: string) {
  const repo = fileURLToPath(new URL('../../../..', import.meta.url));
  const loaded = (await import(
    new URL('../../../extension/e2e/mock-orchestrator.mjs', import.meta.url).href
  )) as {
    MockOrchestrator: new () => Bridge;
  };
  const bridge = new loaded.MockOrchestrator();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ba-representative-chrome-')));
  await mkdir(artifacts, { recursive: true });
  await bridge.start();
  const extension = join(artifacts, 'extension');
  const buildEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/.test(name)),
  );
  const built = spawnSync(
    process.execPath,
    [
      join(repo, 'apps/extension/node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      extension,
      '--emptyOutDir',
    ],
    {
      cwd: join(repo, 'apps/extension'),
      encoding: 'utf8',
      env: {
        ...buildEnv,
        NODE_ENV: 'production',
        VITE_LOCAL_CHROME_QA: '1',
        VITE_WORKBENCH_URL: bridge.origin.replace('127.0.0.1', 'localhost'),
        VITE_ORCHESTRATOR_HTTP: bridge.origin,
        VITE_ORCHESTRATOR_WS: `${bridge.origin.replace('http:', 'ws:')}/ws`,
      },
    },
  );
  await writeFile(
    join(artifacts, 'extension-build.log'),
    (built.stdout ?? '') + (built.stderr ?? ''),
  );
  if (built.status !== 0) {
    await bridge.stop();
    await rm(root, { recursive: true, force: true });
    throw new Error('Representative extension build failed; inspect file-backed log');
  }
  const manifestPath = join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions.push('https://httpbin.org/*', 'https://the-internet.herokuapp.com/*');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let nativePid: number | undefined;
  const proof: Record<string, unknown> = {
    node: process.version,
    artifactOnlyPublicHostGrants: ['https://httpbin.org/*', 'https://the-internet.herokuapp.com/*'],
    manifestSHA256: createHash('sha256')
      .update(await readFile(manifestPath))
      .digest('hex'),
    boundary:
      'real product background/selected protocol/native Chrome; fixture loopback WS/auth,not full App or production authentication',
  };
  const commands: Record<string, unknown>[] = [];
  proof.commands = commands;
  const logs: string[] = [];
  proof.logs = logs;
  const close = async () => {
    try {
      if (context) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const closing = context.close().then(
          () => true,
          () => false,
        );
        const receipt = await Promise.race([
          closing,
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 10000);
          }),
        ]);
        if (timer) clearTimeout(timer);
        proof.contextCloseConfirmed = receipt;
        if (!receipt && nativePid) {
          const row = execFileSync('ps', ['-p', String(nativePid), '-o', 'command='], {
            encoding: 'utf8',
          });
          if (!row.includes(`--user-data-dir=${join(root, 'profile')}`))
            throw new Error('Owned browser identity changed;refusing termination');
          process.kill(nativePid, 'SIGTERM');
          proof.ownedCleanupSignal = 'SIGTERM after missing context close receipt';
          await closing;
        }
      }
      if (nativePid) {
        let gone = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            process.kill(nativePid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
            gone = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        proof.nativeProcessGone = gone;
        if (!gone) throw new Error('Owned representative browser is still running');
      }
    } finally {
      await bridge.stop();
      await writeFile(join(artifacts, 'native-proof.json'), JSON.stringify(proof, null, 2));
      await rm(root, { recursive: true, force: true });
    }
  };
  try {
    const profile = join(root, 'profile');
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [
        '--renderer-process-limit=2',
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    context.on('console', (message) => {
      if (logs.length < 100) logs.push(message.text().slice(0, 600));
    });
    const row = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .find((line) => line.includes(`--user-data-dir=${profile}`) && !line.includes('--type='));
    if (!row) throw new Error('Missing owned representative browser PID');
    nativePid = Number(row.trim().split(/\s+/)[0]);
    Object.assign(proof, { nativePid, chromium: context.browser()!.version() });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    const started = Date.now();
    await worker.evaluate(() => chrome.runtime.id);
    proof.workerReadyMs = Date.now() - started;
    const connected = bridge.waitForConnection(1, 20000);
    // Clean-install auth clearing may race readiness. Seed one stable synthetic token.
    for (
      let attempt = 0;
      attempt < 30 && !bridge.received.some((frame) => frame.type === 'client.hello');
      attempt++
    ) {
      await worker.evaluate(async () => {
        const key = 'holaday.access_token';
        if ((await chrome.storage.local.get(key))[key] !== 'representative-synthetic-token')
          await chrome.storage.local.set({ [key]: 'representative-synthetic-token' });
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await connected;
    const clientId = bridge.connections.at(-1)?.clientId;
    if (!clientId) throw new Error('No representative extension client');
    const userPage = await context.newPage();
    await userPage.goto(`${bridge.origin}/page.html`);
    await userPage.locator('#query').fill('ordinary user input preserved');
    await writeFile(join(artifacts, 'native-proof.json'), JSON.stringify(proof, null, 2));
    return {
      context,
      worker,
      userPage,
      proof,
      close,
      async target(url: string) {
        const page = await context!.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const tabId = await worker.evaluate(
          async (href) => (await chrome.tabs.query({})).find((tab) => tab.url === href)?.id,
          page.url(),
        );
        if (!tabId) throw new Error('Representative target tab unavailable');
        const listed = await bridge.call(`selection-${randomUUID()}`, 'tabs');
        const tabs = (
          listed.result as { tabs?: Array<{ tabId: number; selectionId: string }> } | undefined
        )?.tabs;
        const selected = tabs?.find((tab) => tab.tabId === tabId);
        if (!selected?.selectionId) throw new Error('Missing extension-issued selection receipt');
        await userPage.bringToFront();
        return {
          page,
          target: { tabId, expectedUrl: page.url(), selectionId: selected.selectionId },
          clientId,
        };
      },
      async normalFocus() {
        return worker.evaluate(async (href) => {
          const tabs = await chrome.tabs.query({});
          const normal = tabs.find((tab) => tab.url === href)?.id;
          const active = tabs.find((tab) => tab.active)?.id;
          return {
            normalTabId: normal,
            activeTabId: active,
            preserved: normal !== undefined && normal === active,
          };
        }, userPage.url());
      },
      async send(_user: string, call: ExtensionToolCallOptions): Promise<ExtensionToolCallOutcome> {
        const receipt: Record<string, unknown> = {
          operation: call.args?.session?.op,
          kind: call.kind,
          selectedClientMatches: call.extensionClientId === clientId,
        };
        commands.push(receipt);
        try {
          if (call.extensionClientId !== clientId)
            throw new Error('Wrong representative extension client');
          const reply = await bridge.call(call.taskId, call.kind, call.args, call.timeoutMs);
          receipt.reply = reply;
          return { ...reply, extensionClientId: clientId } as ExtensionToolCallOutcome;
        } catch (error) {
          receipt.error = error instanceof Error ? error.message : 'unknown';
          throw error;
        } finally {
          await writeFile(join(artifacts, 'native-proof.json'), JSON.stringify(proof, null, 2));
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
