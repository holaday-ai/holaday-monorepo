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
