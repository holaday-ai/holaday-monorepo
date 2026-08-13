import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDailyAstrologyReading,
  clearDivineApiCacheForTest,
  divineApiStatus,
  getAstrologyRanking,
  getDailyAstrologyReading,
  getDailyTarotReading,
  getMonthlyAstrologyReading,
  getWeeklyAstrologyReading,
  getYearlyAstrologyReading,
  getYesNoTarotReading,
  hasAstrologyApiCredentials,
  hasDivineApiCredentials,
  zodiacFromBirthday,
} from './service.js';

describe('astrology service', () => {
  afterEach(() => {
    clearDivineApiCacheForTest();
    vi.useRealTimers();
  });

  it('derives zodiac signs from birthday boundaries', () => {
    expect(zodiacFromBirthday('1996-03-21')).toBe('aries');
    expect(zodiacFromBirthday('1996-04-20')).toBe('taurus');
    expect(zodiacFromBirthday('1996-12-22')).toBe('capricorn');
    expect(zodiacFromBirthday('1996-02-19')).toBe('pisces');
  });

  it('uses the mock provider when DivineAPI credentials are absent', () => {
    const reading = buildDailyAstrologyReading(
      { birthday: '1996-03-21' },
      {
        env: {},
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('mock');
    expect(reading.apiConfigured).toBe(false);
    expect(reading.zodiacLabel).toBe('白羊座');
    expect(reading.weekly).toHaveLength(7);
  });

  it('reports DivineAPI readiness without exposing credentials', () => {
    expect(
      hasDivineApiCredentials({
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
      }),
    ).toBe(true);
    expect(
      hasAstrologyApiCredentials({
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
      }),
    ).toBe(true);

    const reading = buildDailyAstrologyReading(
      { birthday: '1996-01-25', zodiacSign: 'aquarius' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
        },
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('mock');
    expect(reading.apiConfigured).toBe(true);
    expect(reading.zodiacSign).toBe('aquarius');

    expect(
      divineApiStatus({
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_CACHE_TTL_MS: '60000',
        DIVINE_API_CAPABILITIES_CHECKED_AT: '2026-08-12T00:00:00.000Z',
      }),
    ).toMatchObject({
      provider: 'divineapi',
      apiConfigured: true,
      cacheTtlMs: 60000,
      cacheEntries: 0,
      endpoints: {
        dailyHoroscope: '/api/v5/daily-horoscope',
        dailyTarot: '/api/v2/daily-tarot',
        weeklyHoroscope: '/api/v5/weekly-horoscope',
        yesNoTarot: '/api/v2/yes-or-no-tarot',
      },
    });
  });

  it('does not call a provider endpoint that is absent from the capability allowlist', async () => {
    let called = false;
    const reading = await getDailyTarotReading(
      { zodiacSign: 'leo' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_CAPABILITIES: 'daily-horoscope',
        },
        fetchImpl: (async () => {
          called = true;
          throw new Error('disabled endpoint must not be called');
        }) as typeof fetch,
      },
    );

    expect(called).toBe(false);
    expect(reading.provider).toBe('mock');
  });

  it('treats an HTTP-200 business denial as a local fallback', async () => {
    const env = {
      DIVINE_API_KEY: 'key',
      DIVINE_ACCESS_TOKEN: 'token',
      DIVINE_API_BASE_URL: 'https://example.test',
      DIVINE_API_CAPABILITIES: 'daily-horoscope',
      DIVINE_API_CAPABILITIES_CHECKED_AT: '2026-08-12T00:00:00.000Z',
    };
    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      {
        env,
        fetchImpl: (async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              success: 2,
              msg: 'You are not authorized to access this API',
            }),
          }) as Response) as typeof fetch,
      },
    );

    expect(reading.provider).toBe('mock');
    expect(divineApiStatus(env).capabilities).toContainEqual({
      capability: 'daily-horoscope',
      available: false,
      checkedAt: '2026-08-12T00:00:00.000Z',
      reason: 'not-authorized',
    });
  });

  it('uses a recently expired validated response after a transient provider failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    let callCount = 0;
    const env = {
      DIVINE_API_KEY: 'key',
      DIVINE_ACCESS_TOKEN: 'token',
      DIVINE_API_BASE_URL: 'https://example.test',
      DIVINE_API_CAPABILITIES: 'daily-horoscope',
      DIVINE_API_CACHE_TTL_MS: '1000',
      DIVINE_API_STALE_IF_ERROR_MS: '5000',
    };
    const fetchImpl = (async () => {
      callCount += 1;
      if (callCount > 1) throw new Error('provider unavailable');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            date: '2026-08-12',
            prediction: {
              personal: 'Last verified provider result.',
              health: 'Protect a calm pace.',
              profession: 'Finish the most useful task first.',
              emotions: 'Name the feeling before reacting.',
              travel: 'Leave a little extra time.',
              luck: ['Lucky Numbers : 1, 8'],
            },
            special: {
              horoscope_percentage: {
                personal: 80,
                health: 80,
                profession: 80,
                emotions: 80,
                travel: 80,
                luck: 80,
              },
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const first = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      { env, fetchImpl },
    );
    vi.advanceTimersByTime(2000);
    const stale = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      { env, fetchImpl },
    );
    vi.advanceTimersByTime(5000);
    const expired = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      { env, fetchImpl },
    );

    expect(first.headline).toBe('Last verified provider result.');
    expect(stale.provider).toBe('divineapi');
    expect(stale.freshness).toBe('stale');
    expect(stale.headline).toBe('Last verified provider result.');
    expect(expired.provider).toBe('mock');
  });

  it('rejects a success envelope that omits required horoscope dimensions', async () => {
    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'en' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'daily-horoscope',
        },
        fetchImpl: (async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              success: 1,
              data: { prediction: { personal: 'Only one field is present.' } },
            }),
          }) as Response) as typeof fetch,
      },
    );

    expect(reading.source).toBe('local-fallback');
  });

  it('reports every known capability without exposing provider secrets', () => {
    const status = divineApiStatus({
      DIVINE_API_KEY: 'secret-key',
      DIVINE_ACCESS_TOKEN: 'secret-token',
      DIVINE_API_CAPABILITIES: 'daily-horoscope,weekly-horoscope',
      DIVINE_API_CAPABILITIES_CHECKED_AT: '2026-08-12T00:00:00.000Z',
    });

    expect(status.capabilities).toHaveLength(10);
    expect(status.capabilities).toContainEqual({
      capability: 'daily-horoscope',
      available: true,
      checkedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(status.capabilities).toContainEqual({
      capability: 'daily-tarot',
      available: false,
      checkedAt: '2026-08-12T00:00:00.000Z',
      reason: 'not-configured',
    });
    expect(JSON.stringify(status)).not.toContain('secret-key');
    expect(JSON.stringify(status)).not.toContain('secret-token');
  });

  it('maps the official weekly horoscope response and reuses its cache', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            week: 'August 10 - August 16',
            weekly_horoscope: {
              personal: 'Make room for one honest conversation.',
              health: 'Choose a calmer pace.',
              profession: 'Finish the important draft first.',
              emotions: 'Name the feeling before reacting.',
              travel: 'Keep the plan flexible.',
              luck: [
                'Colors of the week : Gold, Purple',
                'Lucky Numbers of the week : 3, 7, 9',
                'Lucky Alphabets you will be in sync with : L, M',
                'Cosmic Tip : Small experiments are favored.',
                'Tips for Singles : Leave room for one honest invitation.',
                'Tips for Couples : Share one useful reflection.',
              ],
            },
            special: {
              lucky_color_codes: ['#FFB86B', '#9ED8FF'],
              horoscope_percentage: {
                personal: 80,
                health: 70,
                profession: 90,
                emotions: 75,
                travel: 60,
                luck: 85,
              },
            },
          },
        }),
      } as Response;
    }) as typeof fetch;
    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CACHE_TTL_MS: '60000',
        DIVINE_API_CAPABILITIES: 'weekly-horoscope',
      },
      fetchImpl,
      now: new Date('2026-08-11T00:00:00.000Z'),
    };

    const first = await getWeeklyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'en' },
      options,
    );
    const second = await getWeeklyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'en' },
      options,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.test/api/v5/weekly-horoscope');
    expect(calls[0]?.body).toContain('week=current');
    expect(calls[0]?.body).not.toContain('h_week=');
    expect(first).toEqual(second);
    expect(first.provider).toBe('divineapi');
    expect(first.weekLabel).toBe('August 10 - August 16');
    expect(first.profession).toBe('Finish the important draft first.');
    expect(first.luckyColors).toEqual(['#FFB86B', '#9ED8FF']);
    expect(first.dimensions).toHaveLength(6);
    expect(first.dimensions.find((item) => item.key === 'profession')?.score).toBe(90);
  });

  it('maps monthly and yearly responses into the shared period contract', async () => {
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const isMonthly = String(url).endsWith('/monthly-horoscope');
      const body = String(init?.body);
      expect(body).toContain(isMonthly ? 'month=next' : 'year=current');
      expect(body).toContain('sign=taurus');
      const selector = isMonthly ? 'monthly_horoscope' : 'yearly_horoscope';
      const rangeField = isMonthly ? { month: 'September 2026' } : { year: '2026' };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            sign: 'Taurus',
            ...rangeField,
            [selector]: {
              personal: 'Build one stable personal rhythm.',
              health: 'Protect recovery time.',
              profession: 'Finish the durable foundation first.',
              emotions: 'Name the feeling before responding.',
              travel: 'Keep plans flexible.',
              luck: [
                'Colors of the period : Green, Blue',
                'Lucky Numbers of the period : 2, 6',
                'Lucky Alphabets you will be in sync with : T, V',
                'Cosmic Tip : Consistency creates room for good timing.',
                'Tips for Singles : Keep one invitation simple.',
                'Tips for Couples : Share one practical plan.',
              ],
            },
            special: {
              lucky_color_codes: ['#55AA77', '#5588CC'],
              horoscope_percentage: {
                personal: 72,
                health: 74,
                profession: 88,
                emotions: 69,
                travel: 65,
                luck: 81,
              },
            },
          },
        }),
      } as Response;
    }) as typeof fetch;
    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CAPABILITIES: 'monthly-horoscope,yearly-horoscope',
      },
      fetchImpl,
      now: new Date('2026-08-12T00:00:00.000Z'),
    };
    const profile = {
      birthday: '1996-03-21',
      zodiacSign: 'aries' as const,
      zodiacSignOverride: 'taurus' as const,
      locale: 'en',
    };

    const monthly = await getMonthlyAstrologyReading(profile, 'next', options);
    const yearly = await getYearlyAstrologyReading(profile, options);

    expect(monthly).toMatchObject({
      period: 'monthly',
      source: 'divineapi',
      freshness: 'fresh',
      rangeKey: 'next',
      rangeLabel: 'September 2026',
      zodiacSign: 'taurus',
      luckyNumbers: ['2', '6'],
      luckyLetters: ['T', 'V'],
    });
    expect(yearly).toMatchObject({
      period: 'yearly',
      source: 'divineapi',
      rangeKey: 'current',
      rangeLabel: '2026',
      zodiacSign: 'taurus',
    });
    expect(monthly.dimensions.find((item) => item.key === 'profession')?.score).toBe(88);
    expect(yearly.cosmicTip).toBe('Consistency creates room for good timing.');
  });

  it('returns local Chinese content without calling the English host when Translator is unavailable', async () => {
    let called = false;
    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://english.example.test',
          DIVINE_API_CAPABILITIES: 'daily-horoscope',
        },
        fetchImpl: (async () => {
          called = true;
          throw new Error('English endpoint must not receive lan=zh');
        }) as typeof fetch,
      },
    );

    expect(called).toBe(false);
    expect(reading.source).toBe('local-fallback');
    expect(reading.summary).toContain('今天');
  });

  it('routes Chinese horoscope requests through the configured Translator host', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://english.example.test',
          DIVINE_API_TRANSLATOR_BASE_URL: 'https://translator.example.test',
          DIVINE_API_CAPABILITIES: 'daily-horoscope,translator',
        },
        fetchImpl: (async (url, init) => {
          calls.push({ url: String(url), body: String(init?.body) });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: 1,
              data: {
                sign: 'Aries',
                date: '2026-08-12',
                prediction: {
                  personal: '今天把最重要的一步说清楚。',
                  health: '给身体留出恢复时间。',
                  profession: '先完成关键草稿。',
                  emotions: '感受清楚后再回应。',
                  travel: '给行程留一点弹性。',
                  luck: ['Lucky Numbers : 1, 8'],
                },
                special: { horoscope_percentage: { personal: 82 } },
              },
            }),
          } as Response;
        }) as typeof fetch,
      },
    );

    expect(calls).toEqual([
      {
        url: 'https://translator.example.test/api/v5/daily-horoscope',
        body: expect.stringContaining('lan=zh'),
      },
    ]);
    expect(reading.source).toBe('divineapi');
  });

  it('bounds a hanging provider request and returns local content', async () => {
    vi.useFakeTimers();
    const providerSignals: AbortSignal[] = [];
    const readingPromise = getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_TRANSLATOR_BASE_URL: 'https://translator.example.test',
          DIVINE_API_CAPABILITIES: 'daily-horoscope,translator',
          DIVINE_API_REQUEST_TIMEOUT_MS: '50',
        },
        fetchImpl: (async (_url, init) => {
          if (init?.signal) providerSignals.push(init.signal);
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Provider request aborted', 'AbortError')),
              { once: true },
            );
          });
        }) as typeof fetch,
      },
    );

    await vi.advanceTimersByTimeAsync(50);
    const reading = await readingPromise;

    expect(providerSignals[0]?.aborted).toBe(true);
    expect(reading.source).toBe('local-fallback');
    expect(reading.summary).toContain('今天');
  });

  it('returns a complete same-date ranking only from twelve provider-backed scores', async () => {
    const signs = [
      'aries',
      'taurus',
      'gemini',
      'cancer',
      'leo',
      'virgo',
      'libra',
      'scorpio',
      'sagittarius',
      'capricorn',
      'aquarius',
      'pisces',
    ] as const;
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      const sign = body.get('sign') as (typeof signs)[number];
      const score = 60 + signs.indexOf(sign);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            sign,
            date: '2026-08-12',
            prediction: {
              personal: `${sign} personal`,
              health: `${sign} health`,
              profession: `${sign} profession`,
              emotions: `${sign} emotions`,
              travel: `${sign} travel`,
              luck: [`Lucky Numbers : ${score}`],
            },
            special: {
              horoscope_percentage: {
                personal: score,
                health: score,
                profession: score,
                emotions: score,
                travel: score,
                luck: score,
              },
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const result = await getAstrologyRanking('en', {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CAPABILITIES: 'daily-horoscope',
      },
      fetchImpl,
      now: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(12);
    expect(result.items[0]).toMatchObject({
      zodiacSign: 'pisces',
      score: 71,
      dateLabel: '2026-08-12',
    });
    expect(result.items[11]).toMatchObject({ zodiacSign: 'aries', score: 60 });
  });

  it('maps yes/no tarot without sending a user question and falls back safely', async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      bodies.push(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              card: 'The Sun',
              category: 'Major Arcana',
              yes_no: 'YES',
              result: 'Move forward with a clear and simple first step.',
              image: 'https://example.test/the-sun.jpg',
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const reading = await getYesNoTarotReading(
      { zodiacSign: 'leo', locale: 'en' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'yes-no-tarot',
          DIVINE_API_CACHE_TTL_MS: '0',
        },
        fetchImpl,
        now: new Date('2026-08-11T00:00:00.000Z'),
      },
    );

    expect(reading).toMatchObject({
      provider: 'divineapi',
      answer: 'yes',
      card: 'The Sun',
      category: 'Major Arcana',
      result: 'Move forward with a clear and simple first step.',
    });
    expect(bodies[0]).not.toMatch(/question|Move forward/);

    const fallback = await getYesNoTarotReading(
      { zodiacSign: 'leo' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'yes-no-tarot',
        },
        fetchImpl: (async () => {
          throw new Error('provider unavailable');
        }) as typeof fetch,
        now: new Date('2026-08-12T00:00:00.000Z'),
      },
    );
    expect(fallback.provider).toBe('mock');
    expect(['yes', 'no', 'maybe']).toContain(fallback.answer);
    expect(fallback.result.length).toBeGreaterThan(10);
  });

  it('maps DivineAPI daily horoscope responses onto the reading shape', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              personal: 'A clear daily summary from DivineAPI.',
              health: 'Protect a steady rhythm.',
              profession: 'Prioritize one important work task.',
              emotions: 'Give yourself room to respond.',
              travel: 'Keep the route simple.',
              luck: ['Lucky Numbers : 2, 7'],
            },
            lucky_color: 'Blue',
          },
        }),
      } as Response;
    }) as typeof fetch;

    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'en' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'daily-horoscope',
        },
        fetchImpl,
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('divineapi');
    expect(reading.headline).toBe('A clear daily summary from DivineAPI.');
    expect(reading.workNote).toBe('Prioritize one important work task.');
    expect(reading.luckyColor).toBe('Blue');
    expect(calls[0]?.url).toBe('https://example.test/api/v5/daily-horoscope');
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer token',
    });
    expect(String(calls[0]?.init?.body)).toContain('sign=aries');
  });

  it('maps DivineAPI daily tarot responses with mock fallback shape', async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            card_name: 'The Sun',
            card_type: 'Major Arcana',
            prediction: 'Good momentum for a bright, simple action.',
          },
        }),
      }) as Response) as typeof fetch;

    const reading = await getDailyTarotReading(
      { zodiacSign: 'leo' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'daily-tarot',
        },
        fetchImpl,
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('divineapi');
    expect(reading.title).toBe('The Sun');
    expect(reading.subtitle).toBe('Major Arcana');
    expect(reading.body).toBe('Good momentum for a bright, simple action.');
  });

  it('caches identical DivineAPI calls to avoid repeated provider usage', async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              personal: `Cached daily summary ${callCount}.`,
              health: 'Protect a steady rhythm.',
              profession: 'Prioritize one important work task.',
              emotions: 'Give yourself room to respond.',
              travel: 'Keep the route simple.',
              luck: ['Lucky Numbers : 2, 7'],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CACHE_TTL_MS: '60000',
        DIVINE_API_CAPABILITIES: 'daily-horoscope',
      },
      fetchImpl,
      now: new Date('2026-06-25T00:00:00.000Z'),
    };

    const first = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'en' },
      options,
    );
    const second = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'en' },
      options,
    );

    expect(callCount).toBe(1);
    expect(first.headline).toBe('Cached daily summary 1.');
    expect(second.headline).toBe('Cached daily summary 1.');
    expect(divineApiStatus(options.env).cacheEntries).toBe(1);
  });

  it('can disable DivineAPI cache with a zero TTL', async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              personal: `Uncached daily summary ${callCount}.`,
              health: 'Protect a steady rhythm.',
              profession: 'Prioritize one important work task.',
              emotions: 'Give yourself room to respond.',
              travel: 'Keep the route simple.',
              luck: ['Lucky Numbers : 2, 7'],
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CACHE_TTL_MS: '0',
        DIVINE_API_CAPABILITIES: 'daily-horoscope',
      },
      fetchImpl,
      now: new Date('2026-06-25T00:00:00.000Z'),
    };

    const first = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      options,
    );
    const second = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      options,
    );

    expect(callCount).toBe(2);
    expect(first.headline).toBe('Uncached daily summary 1.');
    expect(second.headline).toBe('Uncached daily summary 2.');
    expect(divineApiStatus(options.env).cacheEntries).toBe(0);
  });
});
