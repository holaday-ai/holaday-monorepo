import { describe, expect, it } from 'vitest';
import { passiveTelemetryRequest } from './cloud-observation.js';

/** ACCEPT-283-R5: telemetry that paused read-only tasks (R4 round 2 core-04-a / core-08-a). */
const passive = (url: string, type = 'fetch') => passiveTelemetryRequest(new URL(url), type);

describe('passive telemetry', () => {
  it('known analytics and media statistics, by fetch/XHR as well as beacon', () => {
    for (const url of [
      'https://analytics.google.com/g/collect?v=2&tid=G-X',
      'https://www.google-analytics.com/g/collect',
      'https://www.google-analytics.com/collect',
      'https://www.google.com/measurement/conversion/?random=1',
      'https://www.youtube.com/api/stats/qoe?cpn=x',
      'https://www.youtube.com/api/stats/atr',
      'https://www.youtube.com/youtubei/v1/log_event?alt=json',
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      'https://www.youtube.com/youtubei/v1/next',
      'https://rr6---sn-ojq4f5-5t.googlevideo.com/videoplayback?expire=1',
    ])
      expect(passive(url), url).toBe(true);
  });
  it('beacons to telemetry paths on any site (Bing, Google)', () => {
    expect(passive('https://www.bing.com/fd/ls/lsp.aspx', 'ping')).toBe(true);
    expect(passive('https://www.google.com/gen_204?atyp=i', 'ping')).toBe(true);
    expect(passive('https://shop.test/collect', 'ping')).toBe(true);
    expect(passive('https://shop.test/collect', 'fetch')).toBe(false);
  });
  it('never covers a write: other paths of the same hosts, look-alike hosts, transactions', () => {
    for (const url of [
      'https://www.youtube.com/youtubei/v1/subscription/subscribe',
      'https://www.youtube.com/youtubei/v1/comment/create_comment',
      'https://www.youtube.com/youtubei/v1/like/like',
      'https://www.youtube.com/youtubei/v1/browse/edit_playlist',
      'https://docs.google.com/forms/d/x/formResponse',
      'https://www.google.com/measurement/conversion/delete',
      'https://evil.test/g/collect',
      'https://analytics.google.com.evil.test/g/collect',
      'https://www.youtube.com/api/stats/qoe?action=purchase',
    ])
      expect(passive(url), url).toBe(false);
    expect(passive('https://shop.test/collect/submit-order', 'ping')).toBe(false);
  });
});
