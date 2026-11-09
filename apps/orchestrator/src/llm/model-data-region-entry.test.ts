import { describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { entryModelDataRegion, entryRequestFrom } from './model-data-region-entry.js';
import { settleFirstTaskModelDataRegion } from './model-data-region-first-task.js';

const ENV = {
  MODEL_DATA_REGION_CN_EDGE_IPS: '47.99.169.186',
  MODEL_DATA_REGION_INTL_HOSTS: 'holaday.ai,www.holaday.ai',
  MODEL_DATA_REGION_CN_HOSTS: 'hd-app.orangebench.tech',
};
const CF_PEER = '172.70.214.33';

/** What the orchestrator sees: the Vultr nginx on loopback, with the X-Real-IP it wrote. */
function viaNginx(realIp: string | undefined, host: string, extra: Record<string, string> = {}) {
  return {
    socketAddress: '127.0.0.1',
    headers: { ...(realIp ? { 'x-real-ip': realIp } : {}), host, ...extra },
  };
}

describe('FIX-60 BOSS 决定: entry region from server-established signals', () => {
  it('the Aliyun edge (mainland entry) is cn', () => {
    expect(entryModelDataRegion(viaNginx('47.99.169.186', 'hd-app.orangebench.tech'), ENV)).toEqual(
      { region: 'cn', reason: 'cn_edge' },
    );
  });

  it('Cloudflare → holaday.ai (international entry) is intl', () => {
    expect(entryModelDataRegion(viaNginx(CF_PEER, 'holaday.ai'), ENV)).toEqual({
      region: 'intl',
      reason: 'intl_entry',
    });
    expect(entryModelDataRegion(viaNginx(CF_PEER, 'www.holaday.ai:443'), ENV).region).toBe('intl');
  });

  it('headers a client can set do not make the international entry cn', () => {
    const forged = viaNginx(CF_PEER, 'holaday.ai', {
      'x-forwarded-for': '47.99.169.186, 172.70.214.33',
      'cf-ipcountry': 'CN',
      'x-holaday-entry': 'cn',
      'x-holaday-region': 'cn',
    });
    expect(entryModelDataRegion(forged, ENV)).toEqual({ region: 'intl', reason: 'intl_entry' });
  });

  it('a request naming the mainland host but not coming from the edge is not cn', () => {
    // e.g. straight to the Vultr IP with `Host: hd-app.orangebench.tech`.
    expect(entryModelDataRegion(viaNginx('203.0.113.9', 'hd-app.orangebench.tech'), ENV)).toEqual({
      region: null,
      reason: 'cn_host_untrusted_peer',
    });
  });

  it('an X-Real-IP that did not come through the local nginx is not read', () => {
    const direct = {
      socketAddress: '203.0.113.9',
      headers: { 'x-real-ip': '47.99.169.186', host: 'hd-app.orangebench.tech' },
    };
    expect(entryModelDataRegion(direct, ENV)).toEqual({
      region: null,
      reason: 'not_via_local_proxy',
    });
    expect(entryModelDataRegion({ socketAddress: undefined, headers: {} }, ENV).region).toBeNull();
  });

  it('no or several X-Real-IP values are unknown', () => {
    expect(entryModelDataRegion(viaNginx(undefined, 'holaday.ai'), ENV)).toEqual({
      region: null,
      reason: 'no_peer_address',
    });
    expect(
      entryModelDataRegion(viaNginx('47.99.169.186, 172.70.214.33', 'hd-app.orangebench.tech'), ENV)
        .region,
    ).toBeNull();
    expect(
      entryModelDataRegion(
        {
          socketAddress: '127.0.0.1',
          headers: { 'x-real-ip': ['47.99.169.186', CF_PEER], host: 'hd-app.orangebench.tech' },
        },
        ENV,
      ).region,
    ).toBeNull();
  });

  it('an unknown host (local run, raw IP) is unknown', () => {
    expect(entryModelDataRegion(viaNginx('192.168.1.5', 'localhost:5173'), ENV)).toEqual({
      region: null,
      reason: 'unknown_host',
    });
  });

  it('IPv4-mapped IPv6 loopback and peer addresses are recognised', () => {
    expect(
      entryModelDataRegion(
        {
          socketAddress: '::ffff:127.0.0.1',
          headers: { 'x-real-ip': '::ffff:47.99.169.186', host: 'hd-app.orangebench.tech' },
        },
        ENV,
      ).region,
    ).toBe('cn');
  });

  it('reads an Express request, and a missing one as unknown', () => {
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': CF_PEER } };
    expect(entryRequestFrom(req)).toEqual({ socketAddress: '127.0.0.1', headers: req.headers });
    expect(entryRequestFrom(undefined)).toEqual({ socketAddress: undefined, headers: {} });
  });
});

describe('FIX-60 BOSS 决定: the first task settles the account region', () => {
  const OFF = {
    ...ENV,
    MODEL_DATA_REGION_SELECTION_ENABLED: false,
    MODEL_DATA_REGION_DEFAULT: 'cn' as const,
  };
  const db = {} as DB;

  function ensureFake() {
    return vi.fn(async (input: { region: 'cn' | 'intl' }) => ({
      region: input.region,
      assigned: true,
    }));
  }

  it('mainland entry → cn, written to the account', async () => {
    const ensure = ensureFake();
    const logger = { info: vi.fn(), warn: vi.fn() };
    await expect(
      settleFirstTaskModelDataRegion({
        db,
        actorExternalId: 'usr_cn',
        current: null,
        request: viaNginx('47.99.169.186', 'hd-app.orangebench.tech'),
        environment: OFF,
        logger,
        ensure,
      }),
    ).resolves.toBe('cn');
    expect(ensure).toHaveBeenCalledWith({ db, actorExternalId: 'usr_cn', region: 'cn' });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MODEL_DATA_REGION_ENTRY',
        userId: 'usr_cn',
        reason: 'cn_edge',
        assigned: true,
      }),
      expect.any(String),
    );
    // No address is logged.
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('47.99');
  });

  it('international entry → intl, written to the account', async () => {
    const ensure = ensureFake();
    await expect(
      settleFirstTaskModelDataRegion({
        db,
        actorExternalId: 'usr_intl',
        current: null,
        request: viaNginx(CF_PEER, 'holaday.ai'),
        environment: OFF,
        ensure,
      }),
    ).resolves.toBe('intl');
    expect(ensure).toHaveBeenCalledWith({ db, actorExternalId: 'usr_intl', region: 'intl' });
  });

  it('an entry that cannot be told uses MODEL_DATA_REGION_DEFAULT (and writes it)', async () => {
    for (const fallback of ['cn', 'intl'] as const) {
      const ensure = ensureFake();
      await expect(
        settleFirstTaskModelDataRegion({
          db,
          actorExternalId: 'usr_unknown',
          current: null,
          request: viaNginx('203.0.113.9', 'hd-app.orangebench.tech'),
          environment: { ...OFF, MODEL_DATA_REGION_DEFAULT: fallback },
          ensure,
        }),
      ).resolves.toBe(fallback);
      expect(ensure).toHaveBeenCalledWith(expect.objectContaining({ region: fallback }));
    }
  });

  it('forged headers on the international entry still give intl', async () => {
    const ensure = ensureFake();
    await expect(
      settleFirstTaskModelDataRegion({
        db,
        actorExternalId: 'usr_forged',
        current: null,
        request: viaNginx(CF_PEER, 'holaday.ai', {
          'x-forwarded-for': '47.99.169.186',
          'cf-ipcountry': 'CN',
        }),
        environment: OFF,
        ensure,
      }),
    ).resolves.toBe('intl');
  });

  it.each(['cn', 'intl'] as const)(
    'an account that has a region (%s) keeps it and nothing is written',
    async (existing) => {
      const ensure = ensureFake();
      await expect(
        settleFirstTaskModelDataRegion({
          db,
          actorExternalId: 'usr_has',
          current: existing,
          request: viaNginx(
            existing === 'cn' ? CF_PEER : '47.99.169.186',
            existing === 'cn' ? 'holaday.ai' : 'hd-app.orangebench.tech',
          ),
          environment: OFF,
          ensure,
        }),
      ).resolves.toBe(existing);
      expect(ensure).not.toHaveBeenCalled();
    },
  );

  it('with the choice switched on nothing is decided: the account is asked as before', async () => {
    const ensure = ensureFake();
    await expect(
      settleFirstTaskModelDataRegion({
        db,
        actorExternalId: 'usr_on',
        current: null,
        request: viaNginx('47.99.169.186', 'hd-app.orangebench.tech'),
        environment: { ...OFF, MODEL_DATA_REGION_SELECTION_ENABLED: true },
        ensure,
      }),
    ).resolves.toBeNull();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a concurrent first task that already wrote another region wins', async () => {
    const ensure = vi.fn(async () => ({ region: 'cn' as const, assigned: false }));
    await expect(
      settleFirstTaskModelDataRegion({
        db,
        actorExternalId: 'usr_race',
        current: null,
        request: viaNginx(CF_PEER, 'holaday.ai'),
        environment: OFF,
        ensure,
      }),
    ).resolves.toBe('cn');
  });

  it('a failed write still runs this task in the entry region, and says so', async () => {
    const ensure = vi.fn(async () => {
      throw new Error('db down');
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    await expect(
      settleFirstTaskModelDataRegion({
        db,
        actorExternalId: 'usr_fail',
        current: null,
        request: viaNginx(CF_PEER, 'holaday.ai'),
        environment: OFF,
        logger,
        ensure,
      }),
    ).resolves.toBe('intl');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MODEL_DATA_REGION_ENTRY_WRITE_FAILED', region: 'intl' }),
      expect.any(String),
    );
  });
});
