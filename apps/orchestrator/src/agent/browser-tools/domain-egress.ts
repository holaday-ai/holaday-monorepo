import { createHash, randomUUID } from 'node:crypto';
import { type ClientRequest, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Page, Route } from 'playwright';
import { currentOperationLifetime } from '../../execution/owned-operation.js';
import {
  type BrowserNetworkPolicy,
  defaultBrowserNetworkPolicy,
} from '../browser-network-policy.js';

export interface DomainEgressConfig {
  enabled: boolean;
  domains: string[];
  proxyUrl: string;
  maxBytes?: number;
}
export function domainEgressConfig(): DomainEgressConfig {
  return {
    enabled: process.env.BROWSER_DOMAIN_PROXY_ENABLED === 'true',
    domains: (process.env.BROWSER_DOMAIN_PROXY_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    proxyUrl: process.env.BROWSER_DOMAIN_PROXY_URL ?? '',
  };
}
/** One immutable endpoint per task/session. No credentials, URLs or bodies enter telemetry. */
export async function installDomainEgress(
  page: Page,
  config = domainEgressConfig(),
  policy: Pick<BrowserNetworkPolicy, 'check'> = defaultBrowserNetworkPolicy,
  ownsPage?: (candidate: Page) => boolean,
  signal?: AbortSignal,
  sessionKey: string = randomUUID(),
) {
  const metrics = {
    proxyRequestBytes: 0,
    proxyResponseBytes: 0,
    proxyRequests: 0,
    directFallbacks: 0,
    blockedMedia: 0,
    failed: 0,
    unit: 'http_payload_bytes',
  };
  if (!config.enabled) return { metrics, interruption: () => null, dispose: async () => {} };
  const lifetime = currentOperationLifetime();
  let closed = false;
  const pending = new Set<ClientRequest>();
  const check = () => {
    signal?.throwIfAborted();
    if (closed) throw new Error('domain_proxy_closed');
    if (lifetime) lifetime.drain.assertDispatch(lifetime.owner);
  };
  const stop = () => {
    closed = true;
    for (const req of pending) req.destroy(new Error('domain_proxy_cancelled'));
  };
  signal?.addEventListener('abort', stop, { once: true });
  const template = config.proxyUrl;
  const proxyFor = (domain: string) => {
    const identity = createHash('sha256')
      .update(JSON.stringify([sessionKey, domain]))
      .digest('hex')
      .slice(0, 32);
    return new URL(template.replace(/\{session\}|%7Bsession%7D/gi, identity));
  };
  const proxy = proxyFor('validation');
  if (!['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname || !config.domains.length)
    throw new Error('domain_proxy_invalid_config');
  const domains = [...config.domains];
  const context = page.context();
  if (context.serviceWorkers().length) {
    signal?.removeEventListener('abort', stop);
    throw new Error('domain_proxy_service_worker_active');
  }
  const blockRegistration = () => {
    const service = navigator.serviceWorker;
    if (service)
      Object.defineProperty(service, 'register', {
        value: () => Promise.reject(new Error('Service workers disabled in proxy session')),
        configurable: false,
        writable: false,
      });
  };
  await context.addInitScript(blockRegistration);
  await page.evaluate(blockRegistration);
  const workerStarted = () => {
    metrics.failed++;
    stop();
  };
  context.on('serviceworker', workerStarted);
  const belongs = async (candidate: Page): Promise<boolean> => {
    if (candidate === page || ownsPage?.(candidate)) return true;
    const opener = await candidate.opener().catch(() => null);
    return opener ? belongs(opener) : false;
  };
  const handler = async (route: Route) => {
    const request = route.request();
    let owner: Page;
    try {
      owner = request.frame().page();
    } catch {
      return route.fallback();
    }
    if (!(await belongs(owner))) return route.fallback();
    const url = new URL(request.url());
    const domain = domains.find(
      (entry) => url.hostname === entry || url.hostname.endsWith(`.${entry}`),
    );
    if (!domain) return route.fallback();
    const proxy = proxyFor(domain);
    try {
      check();
    } catch {
      return route.abort('aborted');
    }
    const decision = await policy.check(url.href);
    try {
      check();
    } catch {
      return route.abort('aborted');
    }
    if (!decision.allowed || !decision.addresses[0]) {
      metrics.failed++;
      return route.abort('blockedbyclient');
    }
    if (
      request.resourceType() === 'media' ||
      /\.(?:mp4|m4v|webm|m3u8|mpd|ts|mp3|ogg)(?:$|\?)/i.test(url.pathname) ||
      /(?:^|\.)googlevideo\.com$/i.test(url.hostname)
    ) {
      metrics.blockedMedia++;
      return route.abort('blockedbyclient');
    }
    const body = request.postDataBuffer();
    const headers = await request.allHeaders();
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    delete headers.connection;
    delete headers['content-length'];
    headers.host = url.host;
    headers['accept-encoding'] = 'identity';
    const maxBytes = config.maxBytes ?? 5 * 1024 * 1024;
    if ((body?.length ?? 0) > maxBytes) {
      metrics.failed++;
      return route.abort('blockedbyclient');
    }
    let responseStarted = false;
    try {
      const response = await new Promise<{
        status: number;
        headers: Record<string, string>;
        body: Buffer;
      }>((resolve, reject) => {
        const secure = url.protocol === 'https:';
        // Destination is the policy-approved IP even inside CONNECT: upstream DNS cannot rebind it.
        const approvedHost = decision.addresses[0]!;
        const authority = approvedHost.includes(':') ? `[${approvedHost}]` : approvedHost;
        const auth =
          proxy.username || proxy.password
            ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`
            : undefined;
        check();
        const upstream = (
          secure ? httpsRequest : proxy.protocol === 'https:' ? httpsRequest : httpRequest
        )(
          secure
            ? {
                hostname: approvedHost,
                servername: url.hostname,
                port: Number(url.port || 443),
                path: url.pathname + url.search,
                method: request.method(),
                headers,
                agent: new HttpsProxyAgent(proxy),
                timeout: 10000,
              }
            : {
                hostname: proxy.hostname,
                port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
                path: `http://${authority}:${url.port || 80}${url.pathname}${url.search}`,
                method: request.method(),
                headers: { ...headers, ...(auth ? { 'proxy-authorization': auth } : {}) },
                agent: false,
                timeout: 10000,
              },
          (res) => {
            if ([407, 502, 503, 504].includes(res.statusCode ?? 0)) {
              res.destroy();
              reject(new Error('proxy_unavailable'));
              return;
            }
            responseStarted = true;
            if (
              /^(?:video|audio)\//i.test(String(res.headers['content-type'] ?? '')) ||
              Number(res.headers['content-length'] ?? 0) > maxBytes
            ) {
              metrics.blockedMedia++;
              res.destroy();
              reject(new Error('media_blocked'));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              metrics.proxyResponseBytes += chunk.length;
              if (size > maxBytes) res.destroy(new Error('response_too_large'));
              else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => {
              const resultHeaders: Record<string, string> = {};
              for (const [key, value] of Object.entries(res.headers))
                if (
                  value !== undefined &&
                  !['transfer-encoding', 'connection', 'content-length'].includes(key)
                )
                  resultHeaders[key] = Array.isArray(value) ? value.join('\n') : value;
              resolve({
                status: res.statusCode ?? 502,
                headers: resultHeaders,
                body: Buffer.concat(chunks),
              });
            });
          },
        );
        pending.add(upstream);
        upstream.once('close', () => pending.delete(upstream));
        metrics.proxyRequests++;
        upstream.on('timeout', () => upstream.destroy(new Error('proxy_timeout')));
        upstream.on('error', reject);
        if (body) {
          metrics.proxyRequestBytes += body.length;
          upstream.write(body);
        }
        upstream.end();
      });
      check();
      await route.fulfill(response);
    } catch {
      // Never replay a write after an ambiguous upstream outcome.
      if (
        !closed &&
        !signal?.aborted &&
        !responseStarted &&
        ['GET', 'HEAD'].includes(request.method())
      ) {
        metrics.directFallbacks++;
        await route.fallback();
      } else {
        metrics.failed++;
        await route.abort('failed');
      }
    }
  };
  const inFlight = new Set<Promise<void>>();
  const guardedHandler = (route: Route) => {
    const work = handler(route).catch(async () => {
      metrics.failed++;
      await route.abort('failed').catch(() => {});
    });
    inFlight.add(work);
    void work.then(() => inFlight.delete(work));
    return work;
  };
  try {
    await context.route('**/*', guardedHandler);
  } catch (error) {
    stop();
    context.off('serviceworker', workerStarted);
    signal?.removeEventListener('abort', stop);
    throw error;
  }
  return {
    metrics,
    interruption: () =>
      closed && !signal?.aborted
        ? { reason: 'proxy_stopped', message: '代理会话已停止，请重新开始任务。' }
        : null,
    dispose: async () => {
      stop();
      signal?.removeEventListener('abort', stop);
      context.off('serviceworker', workerStarted);
      await context.unroute('**/*', guardedHandler);
      await Promise.allSettled([...inFlight]);
    },
  };
}
