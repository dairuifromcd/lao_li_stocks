import { describe, expect, it } from 'vitest';
import {
  fetchDailyCandles,
  parseAlphaVantageDaily,
  refreshMarketData,
} from '../src/marketData';
import { calculateMovingAverage, generateRecommendation, sanitizeState } from '../src/strategy';
import type { Candle, StrategySettings, TechnicalLevels, WatchStock } from '../src/types';
import { normalizeTicker, roundToInt } from '../src/utils';

describe('utility helpers', () => {
  it('rounds and normalizes ticker symbols', () => {
    expect(roundToInt(1.2)).toBe(1);
    expect(roundToInt(1.5)).toBe(2);
    expect(normalizeTicker(' nvda ')).toBe('NVDA');
  });
});

describe('market data parsing', () => {
  it('parses Alpha Vantage daily adjusted data in ascending order', () => {
    const candles = parseAlphaVantageDaily({
      'Time Series (Daily)': {
        '2026-06-18': {
          '1. open': '10',
          '2. high': '12',
          '3. low': '9',
          '4. close': '11',
          '5. adjusted close': '10.5',
          '6. volume': '1000',
        },
        '2026-06-17': {
          '1. open': '8',
          '2. high': '9',
          '3. low': '7',
          '4. close': '8.5',
          '5. adjusted close': '8.25',
          '6. volume': '900',
        },
      },
    });

    expect(candles.map((candle) => candle.date)).toEqual(['2026-06-17', '2026-06-18']);
    expect(candles[candles.length - 1]?.close).toBe(10.5);
  });

  it('uses the free compact daily endpoint and parses raw close and volume', async () => {
    let requestedUrl = '';
    const fetchMock: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          'Time Series (Daily)': {
            '2026-07-13': {
              '1. open': '208.54',
              '2. high': '210.57',
              '3. low': '203.00',
              '4. close': '203.53',
              '5. volume': '121380205',
            },
          },
        }),
        { status: 200 },
      );
    };

    const candles = await fetchDailyCandles('NVDA', 'test-key', fetchMock);
    const url = new URL(requestedUrl);

    expect(url.searchParams.get('function')).toBe('TIME_SERIES_DAILY');
    expect(url.searchParams.get('outputsize')).toBe('compact');
    expect(candles[0]).toMatchObject({
      date: '2026-07-13',
      close: 203.53,
      volume: 121380205,
    });
  });

  it('spaces free-tier requests at least 1.2 seconds apart', async () => {
    let clock = 0;
    const requestStarts: number[] = [];
    const waits: number[] = [];
    const fetchMock: typeof fetch = async () => {
      requestStarts.push(clock);
      return rawDailyResponse();
    };

    const result = await refreshMarketData(
      ['NVDA', 'MSFT', 'SOFI'],
      'test-key',
      {},
      fetchMock,
      new Date('2026-07-14T00:00:00Z'),
      {
        minimumRequestIntervalMs: 1200,
        nowMs: () => clock,
        wait: async (milliseconds) => {
          waits.push(milliseconds);
          clock += milliseconds;
        },
      },
    );

    expect(requestStarts).toEqual([0, 1200, 2400]);
    expect(waits).toEqual([1200, 1200]);
    expect(result.refreshed).toEqual(['NVDA', 'MSFT', 'SOFI']);
    expect(result.errors).toEqual([]);
  });

  it('backs off and retries a burst rate limit only once', async () => {
    let clock = 0;
    let requestCount = 0;
    const waits: number[] = [];
    const fetchMock: typeof fetch = async () => {
      requestCount += 1;
      return requestCount === 1 ? rateLimitResponse() : rawDailyResponse();
    };

    const result = await refreshMarketData(
      ['NVDA'],
      'test-key',
      {},
      fetchMock,
      new Date('2026-07-14T00:00:00Z'),
      {
        minimumRequestIntervalMs: 0,
        rateLimitRetryDelayMs: 1600,
        nowMs: () => clock,
        wait: async (milliseconds) => {
          waits.push(milliseconds);
          clock += milliseconds;
        },
      },
    );

    expect(requestCount).toBe(2);
    expect(waits).toEqual([1600]);
    expect(result.refreshed).toEqual(['NVDA']);
    expect(result.errors).toEqual([]);
  });

  it('stops after one retry when the free-tier limit persists', async () => {
    let requestCount = 0;
    const fetchMock: typeof fetch = async () => {
      requestCount += 1;
      return rateLimitResponse();
    };

    const result = await refreshMarketData(
      ['NVDA'],
      'test-key',
      {},
      fetchMock,
      new Date('2026-07-14T00:00:00Z'),
      {
        minimumRequestIntervalMs: 0,
        rateLimitRetryDelayMs: 0,
        wait: async () => {},
      },
    );

    expect(requestCount).toBe(2);
    expect(result.refreshed).toEqual([]);
    expect(result.errors[0]).toContain('免费额度限制');
    expect(result.errors[0]).not.toContain('premium');
  });
});

function rawDailyResponse(): Response {
  return new Response(
    JSON.stringify({
      'Time Series (Daily)': {
        '2026-07-13': {
          '1. open': '208.54',
          '2. high': '210.57',
          '3. low': '203.00',
          '4. close': '203.53',
          '5. volume': '121380205',
        },
      },
    }),
    { status: 200 },
  );
}

function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      Information:
        'Please consider spreading out your free API requests more sparingly (1 request per second). Rate limit reached.',
    }),
    { status: 200 },
  );
}

describe('strategy engine', () => {
  it('calculates moving averages only when enough candles exist', () => {
    const candles = makeCandles(10, 100);

    expect(calculateMovingAverage(candles, 5)).toBe(107);
    expect(calculateMovingAverage(candles, 20)).toBeNull();
  });

  it('emits an entry signal near support', () => {
    const recommendation = generateRecommendation(makeStock(), makeSettings(), makeLevels(), '2026-06-19');

    expect(recommendation.action).toBe('entry');
    expect(recommendation.triggeredLevel?.source).toBe('automatic');
    expect(recommendation.reasons.join(' ')).toContain('自动识别');
  });

  it('emits a trim watch signal near resistance', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({ currentPrice: 127.8, support: 100, resistance: 130 }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('trim_watch');
    expect(recommendation.reasons.join(' ')).toContain('压力观察区');
  });

  it('blocks signals when a stock is sealed', () => {
    const recommendation = generateRecommendation(
      makeStock({ status: 'sealed' }),
      makeSettings(),
      makeLevels(),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('hold');
    expect(recommendation.blockers).toContain('该股票已暂停跟踪');
  });

  it('uses an optional manual low level before automatic levels', () => {
    const recommendation = generateRecommendation(
      makeStock({
        manualLevels: {
          low: {
            price: 100,
            basis: '周线平台与 MA120 重合',
            timeframe: 'weekly',
            invalidationPrice: 94,
            confirmedAt: '2026-06-18',
          },
        },
      }),
      makeSettings(),
      makeLevels({
        currentPrice: 100.5,
        support: 80,
        deepSupport: 70,
        resistance: 101,
        ma60: 115,
        ma120: 120,
        ma250: 125,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('entry');
    expect(recommendation.triggeredLevel).toMatchObject({
      kind: 'low',
      price: 100,
      source: 'manual',
    });
    expect(recommendation.reasons.join(' ')).toContain('周线平台与 MA120 重合');
  });

  it('falls back to an automatic deep level when no manual level is configured', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({
        currentPrice: 92.5,
        support: 100,
        deepSupport: 92,
        resistance: 130,
        ma60: null,
        ma120: null,
        ma250: null,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('add_watch');
    expect(recommendation.triggeredLevel).toMatchObject({
      kind: 'deep',
      price: 92,
      source: 'automatic',
    });
  });

  it('keeps an invalidated manual level for review without silently replacing it', () => {
    const recommendation = generateRecommendation(
      makeStock({
        manualLevels: {
          low: {
            price: 100,
            basis: '前期平台',
            timeframe: 'daily',
            invalidationPrice: 95,
          },
        },
      }),
      makeSettings(),
      makeLevels({
        currentPrice: 90,
        support: 90,
        deepSupport: 70,
        resistance: 130,
        ma60: null,
        ma120: null,
        ma250: null,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('hold');
    expect(recommendation.triggeredLevel).toBeNull();
    expect(recommendation.warnings.join(' ')).toContain('已越过失效价');
  });

  it('does not emit a low observation just because price is far below an average', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({
        currentPrice: 50,
        support: 40,
        deepSupport: 30,
        resistance: 90,
        ma60: 100,
        ma120: 110,
        ma250: 120,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('hold');
  });

  it('sanitizes legacy state while keeping manual levels optional', () => {
    const sanitized = sanitizeState({
      watchlist: [makeStock()],
      settings: makeSettings(),
    });

    expect(sanitized.watchlist[0]?.manualLevels).toEqual({});
  });
});

function makeCandles(count: number, start: number): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: start + index,
    high: start + index + 1,
    low: start + index - 1,
    close: start + index,
    volume: 1000,
  }));
}

function makeStock(overrides: Partial<WatchStock> = {}): WatchStock {
  return {
    symbol: 'NVDA',
    name: 'NVIDIA',
    sector: 'Semiconductors',
    thesis: 'AI infrastructure',
    status: 'active',
    ...overrides,
  };
}

function makeSettings(): StrategySettings {
  return {
    entryBufferPercent: 3.5,
    addDiscountPercent: 7,
    resistanceBufferPercent: 2,
    minimumCandles: 60,
  };
}

function makeLevels(overrides: Partial<TechnicalLevels> = {}): TechnicalLevels {
  return {
    currentPrice: 100,
    tradingDate: '2026-06-19',
    candleCount: 260,
    ma20: 104,
    ma60: 101,
    ma120: 108,
    ma250: 112,
    support: 98,
    deepSupport: 86,
    resistance: 130,
    volumeSignal: 'weakening_selling',
    insufficientData: [],
    ...overrides,
  };
}
