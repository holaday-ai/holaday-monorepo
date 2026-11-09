/**
 * FIX-60 BOSS 决定 (2026-11-09): an account that never chose a region gets one from the entry its
 * first task came in through — the mainland edge (Aliyun, hd-app.orangebench.tech) → cn, the
 * international entry (Cloudflare → holaday.ai) → intl — and keeps it from then on.
 *
 * Only what the servers themselves establish is read, never what the client says:
 *
 *  - The orchestrator listens behind the Vultr nginx on loopback (4001/4002 are firewalled at the
 *    IP). A request whose socket peer is not loopback did not come through that nginx: unknown.
 *  - That nginx writes `X-Real-IP: $remote_addr` with `proxy_set_header`, which replaces any
 *    X-Real-IP the client sent. So X-Real-IP is the address that connected to the Vultr nginx.
 *    The Aliyun edge connects from its own address (MODEL_DATA_REGION_CN_EDGE_IPS); Cloudflare
 *    connects from Cloudflare's. A client cannot make that address the Aliyun box.
 *  - The entry is cn only when that address is the Aliyun edge. It is intl only when it is not and
 *    the browser-facing host is the international one (holaday.ai). Anything else — a request
 *    that names the mainland host but did not come from the edge, no X-Real-IP, a local run — is
 *    unknown, and the caller uses MODEL_DATA_REGION_DEFAULT.
 *
 * Headers a client can set (X-Forwarded-For, CF-IPCountry, Host on its own, any X-Holaday-*)
 * never decide cn or intl by themselves.
 */
import type { ModelDataRegion } from './model-data-region.js';

export type EntryRegionReason =
  /** Came from the Aliyun edge address. */
  | 'cn_edge'
  /** Came through the Vultr nginx from elsewhere, for the international host. */
  | 'intl_entry'
  /** Did not come through the local nginx (socket peer is not loopback). */
  | 'not_via_local_proxy'
  /** Came through the local nginx without exactly one X-Real-IP. */
  | 'no_peer_address'
  /** Named the mainland host but did not come from the edge address. */
  | 'cn_host_untrusted_peer'
  /** Any other host (direct IP, local name). */
  | 'unknown_host';

export interface EntryRegionDecision {
  region: ModelDataRegion | null;
  reason: EntryRegionReason;
}

export interface EntryRegionEnvironment {
  /** Comma-separated addresses the Aliyun edge connects to the Vultr nginx from. */
  MODEL_DATA_REGION_CN_EDGE_IPS: string;
  /** Comma-separated browser-facing hosts of the international entry. */
  MODEL_DATA_REGION_INTL_HOSTS: string;
  /** Comma-separated browser-facing hosts of the mainland entry (only used to explain unknowns). */
  MODEL_DATA_REGION_CN_HOSTS: string;
}

export interface EntryRequest {
  socketAddress: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function list(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function single(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(',')) return null;
  return trimmed;
}

function normaliseAddress(address: string): string {
  const lower = address.toLowerCase();
  return lower.startsWith('::ffff:') && lower.includes('.') ? lower.slice(7) : lower;
}

function hostName(host: string | null): string | null {
  if (!host) return null;
  const lower = host.toLowerCase();
  if (lower.startsWith('[')) return lower.slice(0, lower.indexOf(']') + 1);
  return lower.replace(/:\d+$/, '');
}

/** Which entry this request came through, from server-established signals only. */
export function entryModelDataRegion(
  request: EntryRequest,
  environment: EntryRegionEnvironment,
): EntryRegionDecision {
  if (!request.socketAddress || !LOOPBACK.has(request.socketAddress.toLowerCase())) {
    return { region: null, reason: 'not_via_local_proxy' };
  }
  const peer = single(request.headers['x-real-ip']);
  if (!peer) return { region: null, reason: 'no_peer_address' };
  if (list(environment.MODEL_DATA_REGION_CN_EDGE_IPS).has(normaliseAddress(peer))) {
    return { region: 'cn', reason: 'cn_edge' };
  }
  const host = hostName(single(request.headers.host));
  if (host && list(environment.MODEL_DATA_REGION_INTL_HOSTS).has(host)) {
    return { region: 'intl', reason: 'intl_entry' };
  }
  if (host && list(environment.MODEL_DATA_REGION_CN_HOSTS).has(host)) {
    return { region: null, reason: 'cn_host_untrusted_peer' };
  }
  return { region: null, reason: 'unknown_host' };
}

/** An Express-like request as the entry check reads it. */
export function entryRequestFrom(
  req:
    | {
        socket?: { remoteAddress?: string | undefined } | undefined;
        headers?: Record<string, string | string[] | undefined> | undefined;
      }
    | null
    | undefined,
): EntryRequest {
  return { socketAddress: req?.socket?.remoteAddress, headers: req?.headers ?? {} };
}
