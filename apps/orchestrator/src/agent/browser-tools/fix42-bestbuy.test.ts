import { describe, expect, it } from 'vitest';
import { bestBuySensorShape } from './cloud-observation.js';

/**
 * FIX-42 #2: Deploy-42 new-bestbuy / reg-new-bestbuy paused on the BestBuy bot-manager sensor
 * posting to 5 segments, one with a dash (`json{body} 4233B`, typing into the search box).
 * Evidence: the same shape went out 31 times in the background across the acceptance records.
 */
const SENSOR_BODY = `{"body":"${'a1B2'.repeat(1058)}"}`;
const D42 = 'https://www.bestbuy.com/b7-ENUDhYbI1cpWgkajc/GJEfLSQa3L/QGlgenIRVwc/dH0wKkY/mOCApAQ';

describe('FIX-42 #2 · the BestBuy sensor on 5 segments with a dash', () => {
  it('Deploy-42 path and body (4233 B {"body":…}) are the sensor', () => {
    expect(SENSOR_BODY.length).toBeGreaterThan(4200);
    expect(bestBuySensorShape(new URL(D42), 'POST', SENSOR_BODY)).toBe(true);
  });

  it('Deploy-34 path (a segment starting with a dash) is the sensor', () => {
    expect(
      bestBuySensorShape(
        new URL('https://www.bestbuy.com/UwDIPyzV11/p0Vavwpy92/GzamhpEV/EBt0AQ/L0o/-O0U'),
        'POST',
        SENSOR_BODY,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'look-alike host',
      'https://www.bestbuy.com.evil.io/b7-ENUDhYbI1cpWgkajc/GJEfLSQa3L/QGlgenIRVwc/dH0wKkY/mOCApAQ',
      SENSOR_BODY,
    ],
    [
      'another bestbuy host',
      'https://api.bestbuy.com/b7-ENUDhYbI1cpWgkajc/GJEfLSQa3L/QGlgenIRVwc/dH0wKkY/mOCApAQ',
      SENSOR_BODY,
    ],
    [
      '4 segments',
      'https://www.bestbuy.com/b7-ENUDhYbI1cpWgkajc/GJEfLSQa3L/QGlgenIRVwc/dH0wKkY',
      SENSOR_BODY,
    ],
    ['a query string', `${D42}?action=addToCart`, SENSOR_BODY],
    ['dashed words', 'https://www.bestbuy.com/add-to-cart/Ab1Cd/Ef2Gh/Ij3Kl/Mn4Op', SENSOR_BODY],
    ['a cart word', 'https://www.bestbuy.com/Cart9Ab/Ab1Cd/Ef2Gh/Ij3Kl/Mn4Op', SENSOR_BODY],
    ['a login word', 'https://www.bestbuy.com/Login7X/Ab1Cd/Ef2Gh/Ij3Kl/Mn4Op', SENSOR_BODY],
    [
      'a dash-only segment',
      'https://www.bestbuy.com/b7-ENUDhYbI1cpWgkajc/--/QGlgenIRVwc/dH0wKkY/mOCApAQ',
      SENSOR_BODY,
    ],
    ['add to cart body', D42, '{"items":[{"skuId":"6505727"}]}'],
    ['sign-in body', D42, '{"token":"x","password":"y"}'],
    ['two keys', D42, `{"body":"${'x'.repeat(4300)}","sku":"1"}`],
    ['a short body', D42, '{"body":"x"}'],
    ['another key', D42, `{"payload":"${'x'.repeat(4300)}"}`],
  ])('reverse: %s still pauses', (_label, url, body) => {
    expect(bestBuySensorShape(new URL(url), 'POST', body)).toBe(false);
  });

  it('reverse: a GET is no sensor post', () => {
    expect(bestBuySensorShape(new URL(D42), 'GET', SENSOR_BODY)).toBe(false);
  });
});

/** DEPLOY-43 复审 #1 / #2: the coordinator's fix-42/review1-fixtures/bb305.mjs, case for case. */
describe('DEPLOY-43 复审 · bb305 fixture (bestBuySensorShape)', () => {
  const S = JSON.stringify({ body: 'a1B2'.repeat(1058) });
  const SD = JSON.stringify({ sensor_data: 'x'.repeat(1200) });
  it.each([
    ['D42 real', '/b7-ENUDhYbI1cpWgkajc/GJEfLSQa3L/QGlgenIRVwc/dH0wKkY/mOCApAQ', true],
    ['coord real-ish', '/b7-Xyz12/AbC34/dEf56/GhI78/jKl90', true],
    ['add-to-cart', '/add-to-cart/AbC1/DeF2/GhI3/JkL4', false],
    ['site/checkout-v2', '/site/checkout-v2/Ab1/Cd2/Ef3', false],
    ['a1B-cart', '/a1B-cart/X9y/Z8w/Q7e/R6t', false],
    ['identity seg', '/Ab1-Cd2/identity/Ef3/Gh4/Ij5', false],
    ['save-for-later1', '/save-for-later1/Ab1C/De2F/Gh3I/Jk4L', false],
    ['Add2-Wish4List', '/Add2-Wish4List/Ab1C/De2F/Gh3I/Jk4L', false],
    ['profile word mixed', '/Profile9/Ab1C/De2F/Gh3I/Jk4L', false],
    ['remove word', '/Remove1X/Ab1C/De2F/Gh3I/Jk4L', false],
    ['dash leading (Deploy-34 shape)', '/-O0U/Ab1C/De2F/Gh3I/Jk4L', true],
    ['dash only seg', '/--/Ab1C/De2F/Gh3I/Jk4L', false],
    ['dashes a-b mixed', '/a-B/Ab1C/De2F/Gh3I/Jk4L', false],
    ['4 segs', '/Ab1C/De2F/Gh3I/Jk4L', false],
    ['ORDER uppercase', '/ORDER1/Ab1C/De2F/Gh3I/Jk4L', false],
  ])('%s → %s (body and sensor_data)', (_label, path, expected) => {
    const url = new URL(`https://www.bestbuy.com${path}`);
    expect(bestBuySensorShape(url, 'POST', S)).toBe(expected);
    expect(bestBuySensorShape(url, 'POST', SD)).toBe(expected);
  });

  const D = new URL('https://www.bestbuy.com/b7-Xyz12/AbC34/dEf56/GhI78/jKl90');
  it.each([
    ['short', JSON.stringify({ body: 'x' })],
    ['two keys', JSON.stringify({ body: 'x'.repeat(2000), sku: '1' })],
    ['payload key', JSON.stringify({ payload: 'x'.repeat(2000) })],
    [
      'nested string json',
      JSON.stringify({
        body: JSON.stringify({ action: 'addToCart', sku: '1', pad: 'x'.repeat(1000) }),
      }),
    ],
    ['array', JSON.stringify([{ body: 'x'.repeat(2000) }])],
    ['dup keys', `{"sku":"1","body":"${'x'.repeat(1200)}"}`],
    ['dup same key', `{"body":"x","body":"${'y'.repeat(1200)}"}`],
    [
      'key=value pairs',
      JSON.stringify({ body: `action=addToCart&sku=6505727&qty=1&pad=${'x'.repeat(1200)}` }),
    ],
    [
      'a JSON array string',
      JSON.stringify({ body: JSON.stringify([{ skuId: '1' }, 'x'.repeat(1200)]) }),
    ],
  ])('body %s → false', (_label, body) => {
    expect(bestBuySensorShape(D, 'POST', body)).toBe(false);
  });
  it('an opaque sensor string with base64 padding still passes', () => {
    expect(
      bestBuySensorShape(D, 'POST', JSON.stringify({ body: `${'Ab9+/'.repeat(300)}==` })),
    ).toBe(true);
  });
});
