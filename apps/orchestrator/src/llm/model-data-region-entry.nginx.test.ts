/**
 * FIX-60 BOSS 决定: the entry check trusts X-Real-IP only because the Vultr nginx writes it from
 * the connecting address (replacing whatever the client sent) and the Aliyun edge connects to the
 * Vultr IP itself. These read the checked-in configs so a change that breaks either is caught.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const vultr = readFileSync(`${root}ops/vultr-nginx/holaday.conf`, 'utf8');
const aliyun = readFileSync(`${root}ops/aliyun-edge/nginx-hd-app.conf`, 'utf8');

function location(conf: string, header: string): string {
  const start = conf.indexOf(header);
  if (start < 0) throw new Error(`no ${header}`);
  return conf.slice(start, conf.indexOf('\n    }', start));
}

describe('FIX-60 entry signal: the nginx configs it relies on', () => {
  it('the Vultr nginx writes X-Real-IP from the connecting address on every API route', () => {
    for (const header of ['location /api/ {', 'location /trpc/ {']) {
      expect(location(vultr, header)).toContain('proxy_set_header X-Real-IP $remote_addr;');
    }
  });

  it('the Vultr nginx does not take the address from a client header (no real_ip rewrite)', () => {
    expect(vultr).not.toMatch(/real_ip|set_real_ip_from/);
  });

  it('the Aliyun edge connects to the Vultr IP itself and keeps the mainland host', () => {
    const api = location(aliyun, 'location /api/ {');
    expect(api).toContain('proxy_pass https://207.148.70.106;');
    expect(api).toContain('proxy_set_header Host $host;');
    expect(aliyun).toContain('server_name hd-app.orangebench.tech;');
  });

  it('the defaults name that edge address and those hosts', () => {
    expect(env.MODEL_DATA_REGION_CN_EDGE_IPS.split(',')).toContain('47.99.169.186');
    expect(env.MODEL_DATA_REGION_CN_HOSTS.split(',')).toContain('hd-app.orangebench.tech');
    expect(env.MODEL_DATA_REGION_INTL_HOSTS.split(',')).toEqual(['holaday.ai', 'www.holaday.ai']);
  });
});
