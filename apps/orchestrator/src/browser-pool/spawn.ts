/**
 * Subprocess spawners for the browser pool.
 *
 * Each helper fires one of the four sidecar processes an isolated
 * user session needs (Xvfb, Brave, x11vnc, websockify) and returns
 * a handle the BrowserPool can track + kill later. All four run
 * `detached: true` so the orchestrator can signal the entire
 * process group (`kill(-pid)`) on release — Brave in particular
 * spawns a tree of renderers + a crashpad handler, and without a
 * group signal they outlive their parent.
 *
 * stderr is piped into the orchestrator's pino logger rather than
 * inherited — a chatty Brave must not pollute PM2's captured stdout.
 * stdin is /dev/null so no accidental terminal control sequences
 * land on the child.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';
import { chromium } from 'playwright';

export interface SpawnedProcess {
  pid: number;
  /** Raw ChildProcess for advanced callers; prefer the convenience methods. */
  child: ChildProcess;
  /**
   * Send SIGTERM to the whole process group. Returns true if the
   * signal was delivered (or the process was already gone), false on
   * unexpected error. Idempotent — safe to call multiple times.
   */
  kill(signal?: NodeJS.Signals): boolean;
}

/** Base options every spawn shares — detached, piped streams, no stdin. */
function baseSpawnOptions(logLabel: string): SpawnOptions {
  return {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOLADAY_SPAWN_LABEL: logLabel },
  };
}

function wrap(child: ChildProcess, logger: Logger, label: string): SpawnedProcess {
  if (!child.pid) {
    throw new Error(`spawn ${label}: process has no pid (spawn failed)`);
  }
  const pid = child.pid;
  // Drain stderr line-by-line into the logger at warn level — noisy
  // but invaluable when Brave's sandbox dies mid-task. A silent
  // SIGSEGV with no trace is the worst debug experience.
  child.stderr?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8').trimEnd();
    if (text) logger.warn({ pid, label }, text);
  });
  child.stdout?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8').trimEnd();
    if (text) logger.debug({ pid, label }, text);
  });
  child.on('error', (err) => {
    logger.warn({ pid, label, err: err.message }, 'child process errored');
  });
  child.on('exit', (code, signal) => {
    logger.info({ pid, label, code, signal }, 'child process exited');
  });
  // Let the orchestrator exit cleanly even if a child is still
  // running — the pool's shutdown hook signals them first, but
  // unref() is a safety net in case something goes sideways.
  child.unref();

  return {
    pid,
    child,
    kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
      try {
        // `-pid` signals the group leader's whole session. Brave's
        // tree of renderers + GPU + crashpad all land on that pgid.
        process.kill(-pid, signal);
        return true;
      } catch (err: unknown) {
        // ESRCH = process gone already (we succeeded racing a crash).
        // EPERM  = signal blocked — very surprising for root, log it.
        const errno = (err as NodeJS.ErrnoException).code;
        if (errno === 'ESRCH') return true;
        logger.warn({ pid, label, signal, err: String(err) }, 'kill() failed');
        return false;
      }
    },
  };
}

/**
 * Launch an Xvfb display.
 *
 * `-nolisten tcp` keeps the X server bound to the unix socket only;
 * Brave connects via DISPLAY=:N which uses /tmp/.X11-unix/XN. The
 * `-ac` flag disables host-based access control — we rely on the
 * socket perms for isolation.
 */
export function spawnXvfb(
  display: number,
  screen: string,
  logger: Logger,
): SpawnedProcess {
  const args = [
    `:${display}`,
    '-screen',
    '0',
    screen,
    '-nolisten',
    'tcp',
    '-ac',
  ];
  const label = `xvfb:${display}`;
  const child = spawn('Xvfb', args, baseSpawnOptions(label));
  return wrap(child, logger, label);
}

export interface SpawnBraveOptions {
  display: number;
  cdpPort: number;
  userDataDir: string;
  /** Defaults to 1280,800 — matches the Xvfb screen geometry. */
  windowSize?: string;
  /** Loopback-only SSRF-safe forward proxy owned by BrowserPool. */
  proxyServer?: string;
}

/**
 * Launch Brave pointed at a specific Xvfb display + user-data-dir.
 *
 * Flags mirror the single-instance /opt/holaday-headed/start.sh
 * wrapper (sans openbox + xdotool post-launch nudges, which the
 * kiosk + --window-size flags already cover for a freshly-spawned
 * window). `--disable-features` list is long but targeted — each
 * entry maps to a piece of Brave chrome we've seen reserve viewport
 * in production screenshots.
 */
export function spawnBrave(
  opts: SpawnBraveOptions,
  logger: Logger,
): SpawnedProcess {
  mkdirSync(opts.userDataDir, { recursive: true });
  const args = buildBraveArgs(opts);
  const label = `brave:${opts.cdpPort}`;
  const options = {
    ...baseSpawnOptions(label),
    env: {
      ...process.env,
      DISPLAY: `:${opts.display}`,
      HOLADAY_SPAWN_LABEL: label,
    },
  } satisfies SpawnOptions;
  const child = spawn('/usr/bin/brave-browser', args, options);
  return wrap(child, logger, label);
}

export function buildBraveArgs(opts: SpawnBraveOptions): string[] {
  const windowSize = opts.windowSize ?? '1280,800';
  // Round-2 change: dropped --kiosk + --start-fullscreen + --disable-infobars.
  // Users now see Brave's normal chrome (address bar + tab bar) in the
  // VNC stream — the address bar is essential context ("what site am
  // I on?") and multi-tab is needed for action tasks.
  //
  // Added:
  //   --homepage=about:blank      so the new-tab default isn't Google
  //   --disable-features=ExternalProtocolDialog   stops "Open xdg-open?" popups
  //   --deny-permission-prompts   auto-rejects geolocation / notifications
  return [
    `--remote-debugging-port=${opts.cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${opts.userDataDir}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--disable-restore-session-state',
    // ExternalProtocolDialog + ExternalProtocolPrompts (plural) —
    // different Chromium versions name the feature differently;
    // include both so the "Open xdg-open?" popup is suppressed on
    // every Brave we might run against.
    '--disable-features=CalculateNativeWinOcclusion,ChromeWhatsNewUI,InfiniteSessionRestore,Translate,BravePrivateProductAnalytics,BraveWelcomePage,BraveRewards,BraveAIChat,BraveTalk,BraveVPN,ImportData,BraveNTPBrandedWallpaper,ExternalProtocolDialog,ExternalProtocolPrompts',
    '--disable-background-networking',
    '--disable-quic',
    '--disable-sync',
    '--disable-translate',
    '--deny-permission-prompts',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--homepage=about:blank',
    '--lang=zh-CN',
    `--window-size=${windowSize}`,
    '--window-position=0,0',
    '--start-maximized',
    ...(opts.proxyServer
      ? [
          `--proxy-server=${opts.proxyServer}`,
          // Chromium normally bypasses proxies for localhost. Disable that
          // implicit exception so private targets always reach our guard.
          '--proxy-bypass-list=<-loopback>',
        ]
      : []),
    'about:blank',
  ];
}

/**
 * Local development uses Playwright's bundled Chromium directly. This keeps
 * the BrowserPool/CDP contract identical to production without requiring the
 * Linux-only Xvfb, Brave, x11vnc, and websockify sidecars on macOS.
 */
export function buildNativeChromiumArgs(opts: SpawnBraveOptions): string[] {
  return [
    '--headless=new',
    ...buildBraveArgs(opts).filter((arg) => arg !== '--start-maximized'),
  ];
}

export function spawnNativeChromium(
  opts: SpawnBraveOptions,
  logger: Logger,
): SpawnedProcess {
  mkdirSync(opts.userDataDir, { recursive: true });
  const args = buildNativeChromiumArgs(opts);
  const label = `chromium:${opts.cdpPort}`;
  const child = spawn(chromium.executablePath(), args, baseSpawnOptions(label));
  return wrap(child, logger, label);
}

/**
 * x11vnc on a given display + RFB port. Bound to loopback only — the
 * outside world reaches the VNC stream via websockify (which we also
 * bind to loopback; nginx or the orchestrator WS proxy terminates
 * public traffic).
 */
export function spawnX11vnc(
  display: number,
  rfbPort: number,
  logger: Logger,
): SpawnedProcess {
  const args = [
    '-display',
    `:${display}`,
    '-forever',
    '-nopw',
    '-shared',
    '-noxdamage',
    '-listen',
    '127.0.0.1',
    '-rfbport',
    String(rfbPort),
  ];
  const label = `x11vnc:${rfbPort}`;
  const child = spawn('x11vnc', args, baseSpawnOptions(label));
  return wrap(child, logger, label);
}

/**
 * websockify bridging a public WS port to x11vnc's RFB.
 *
 * Bound to 127.0.0.1 — external traffic arrives via the orchestrator's
 * WS proxy (phase-8.2) or an nginx upstream (phase-8.3 if we decide
 * we want it). Either way, a zero-auth websockify must not be
 * reachable from the Internet directly.
 */
export function spawnWebsockify(
  wsPort: number,
  rfbPort: number,
  logger: Logger,
): SpawnedProcess {
  const args = [`127.0.0.1:${wsPort}`, `127.0.0.1:${rfbPort}`];
  const label = `websockify:${wsPort}`;
  const child = spawn('websockify', args, baseSpawnOptions(label));
  return wrap(child, logger, label);
}

/**
 * Poll the CDP /json/version endpoint until Brave is accepting
 * connections, or the timeout elapses. Brave typically takes
 * 500-1500ms cold-start; headful Brave with our no-sandbox + fresh
 * profile is on the slower end, so the default is 10s.
 *
 * Returns the version string on success; throws otherwise. Uses the
 * plain global fetch (Node 20+) and an AbortController for the
 * per-request timeout.
 */
export async function waitForCdpReady(
  cdpPort: number,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2_000);
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const body = (await res.json()) as { Browser?: string };
        return body.Browser ?? 'unknown';
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `waitForCdpReady(${cdpPort}): timed out after ${timeoutMs}ms (last err: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    })`,
  );
}
