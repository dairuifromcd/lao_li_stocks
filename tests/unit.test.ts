import { describe, expect, it } from 'vitest';
import {
  fetchDailyCandles,
  parseAlphaVantageDaily,
  refreshMarketData,
} from '../src/marketData';
import { recordSignalSnapshot } from '../src/history';
import { calculateWeeklyTrend } from '../src/marketContext';
import {
  calculateMovingAverage,
  calculateTechnicalLevels,
  generateRecommendation,
  sanitizeState,
} from '../src/strategy';
import {
  parseAlphaVantageWeeklyAdjusted,
  parseEarningsCalendar,
} from '../src/supplementalData';
import type {
  Candle,
  RecommendationContext,
  StrategySettings,
  TechnicalLevels,
  WatchStock,
  WeeklyDataRecord,
  WeeklyTrend,
} from '../src/types';
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

  it('stops the batch when the configured request budget is reached', async () => {
    let requestCount = 0;
    const result = await refreshMarketData(
      ['NVDA', 'MSFT', 'SOFI'],
      'test-key',
      {},
      async () => {
        requestCount += 1;
        return rawDailyResponse();
      },
      new Date('2026-07-14T00:00:00Z'),
      { minimumRequestIntervalMs: 0, maxRequests: 2 },
    );

    expect(requestCount).toBe(2);
    expect(result.refreshed).toEqual(['NVDA', 'MSFT']);
    expect(result.errors[0]).toContain('免费请求预算');
  });

  it('stops after one retry when the free-tier limit persists', async () => {
    let requestCount = 0;
    const fetchMock: typeof fetch = async () => {
      requestCount += 1;
      return rateLimitResponse();
    };

    const result = await refreshMarketData(
      ['NVDA', 'MSFT', 'SOFI'],
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

  it('converts weekly OHLC prices with the adjusted-close factor', () => {
    const candles = parseAlphaVantageWeeklyAdjusted({
      'Weekly Adjusted Time Series': {
        '2026-07-10': {
          '1. open': '90',
          '2. high': '110',
          '3. low': '80',
          '4. close': '100',
          '5. adjusted close': '50',
          '6. volume': '5000',
        },
      },
    });

    expect(candles[0]).toMatchObject({
      open: 45,
      high: 55,
      low: 40,
      close: 50,
      volume: 5000,
    });
  });

  it('parses quoted company names from the earnings calendar', () => {
    const events = parseEarningsCalendar(
      'symbol,name,reportDate,fiscalDateEnding,estimate,currency\nNVDA,"NVIDIA, Corp.",2026-08-19,2026-07-31,1.23,USD',
    );

    expect(events).toEqual([{
      symbol: 'NVDA',
      name: 'NVIDIA, Corp.',
      reportDate: '2026-08-19',
      fiscalDateEnding: '2026-07-31',
      estimate: 1.23,
      currency: 'USD',
    }]);
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

  it('marks technical conditions ready only when all seven checks pass', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels(),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('technical_ready');
    expect(recommendation.triggeredLevel?.source).toBe('automatic');
    expect(recommendation.conditionChecks).toHaveLength(7);
    expect(recommendation.conditionChecks.every((check) => check.passed)).toBe(true);
    expect(recommendation.roomRatio).toBeGreaterThanOrEqual(2);
  });

  it('waits when fewer than two confirmation factors pass', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({
        priceStabilized: false,
        volumeSignal: 'neutral',
        ma60: 105,
        ma60Trend: 'falling',
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('waiting_confirmation');
    expect(recommendation.confirmationCount).toBe(0);
    expect(recommendation.conditionChecks.find((check) => check.key === 'confirmation')?.passed).toBe(false);
  });

  it('waits when the room-to-risk ratio is below two', () => {
    const recommendation = generateRecommendation(
      makeStock({ symbol: 'SOFI' }),
      makeSettings(),
      makeLevels({
        currentPrice: 18.13,
        support: 17.93,
        resistance: 18.6,
        atr14: 0.2,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('waiting_confirmation');
    expect(recommendation.roomRatio).toBeLessThan(2);
    expect(recommendation.conditionChecks.find((check) => check.key === 'room')?.passed).toBe(false);
  });

  it.each([
    ['NVDA', 203.53, 208.78],
    ['MSFT', 390.99, 411.41],
  ])('treats %s support above current price as broken resistance', (symbol, currentPrice, brokenSupport) => {
    const recommendation = generateRecommendation(
      makeStock({ symbol }),
      makeSettings(),
      makeLevels({
        currentPrice,
        support: null,
        deepSupport: null,
        resistance: brokenSupport,
        brokenSupport,
        resistanceKind: 'broken_support',
        resistanceTouchCount: 3,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('breakdown');
    expect(recommendation.label).toContain('等待收复');
    expect(recommendation.conditionChecks.find((check) => check.key === 'level')?.passed).toBe(false);
  });

  it('emits a pressure observation near valid resistance', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({ currentPrice: 109, support: 98, resistance: 110 }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('pressure_watch');
    expect(recommendation.reasons.join(' ')).toContain('压力观察区');
    expect(recommendation.reasons.join(' ')).toContain('下方自动支撑仍为');
  });

  it('blocks technical readiness when both market and sector trends are weak', () => {
    const context = makeContext({
      marketEnvironment: {
        market: makeWeeklyTrend('SPY', 'weak'),
        sector: makeWeeklyTrend('SOXX', 'weak'),
        sectorSymbol: 'SOXX',
        passed: false,
        detail: 'SPY 偏弱；SOXX 偏弱',
      },
    });
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels(),
      '2026-06-19',
      context,
    );

    expect(recommendation.action).toBe('waiting_confirmation');
    expect(recommendation.conditionChecks.find((check) => check.key === 'market')?.passed).toBe(false);
  });

  it('blocks technical readiness within seven days of known earnings', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels(),
      '2026-06-19',
      makeContext({
        nextEarnings: {
          symbol: 'NVDA',
          name: 'NVIDIA',
          reportDate: '2026-06-25',
        },
      }),
    );

    expect(recommendation.action).toBe('waiting_confirmation');
    expect(recommendation.conditionChecks.find((check) => check.key === 'event')?.passed).toBe(false);
    expect(recommendation.warnings.join(' ')).toContain('距离财报仅 6 天');
  });

  it('blocks technical readiness when adjusted weekly history is incomplete', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels(),
      '2026-06-19',
      makeContext({ weeklyTrend: makeWeeklyTrend('NVDA', 'unavailable') }),
    );

    expect(recommendation.action).toBe('waiting_confirmation');
    expect(recommendation.conditionChecks.find((check) => check.key === 'data')).toMatchObject({
      passed: false,
      detail: '缺少至少 40 根已完成的复权周线',
    });
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
        resistance: 120,
        ma60: 99,
        ma120: 120,
        ma250: 125,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('technical_ready');
    expect(recommendation.triggeredLevel).toMatchObject({
      kind: 'low',
      price: 100,
      source: 'manual',
    });
    expect(recommendation.reasons.join(' ')).toContain('周线平台与 MA120 重合');
  });

  it('does not invent an automatic deep level from a percentage projection', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({
        currentPrice: 92.5,
        support: null,
        deepSupport: null,
        brokenSupport: 100,
        resistance: 130,
      }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('breakdown');
    expect(recommendation.triggeredLevel?.kind).not.toBe('deep');
  });

  it('keeps an invalidated manual level visible as a broken structure', () => {
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
      makeLevels({ currentPrice: 90, support: 90, resistance: 130 }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('breakdown');
    expect(recommendation.triggeredLevel?.source).toBe('manual');
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

  it('keeps calculated support below current and resistance above current', () => {
    const levels = calculateTechnicalLevels(makeOscillatingCandles());

    expect(levels).not.toBeNull();
    expect(levels?.support).not.toBeNull();
    expect(levels?.resistance).not.toBeNull();
    expect(levels?.support ?? Infinity).toBeLessThanOrEqual(levels?.currentPrice ?? 0);
    expect(levels?.resistance ?? 0).toBeGreaterThanOrEqual(levels?.currentPrice ?? Infinity);
    expect(levels?.supportTouchCount).toBeGreaterThanOrEqual(2);
    expect(levels?.resistanceTouchCount).toBeGreaterThanOrEqual(2);
  });

  it('sanitizes legacy state and drops the old projection parameter', () => {
    const sanitized = sanitizeState({
      watchlist: [makeStock()],
      settings: { ...makeSettings(), addDiscountPercent: 7 } as StrategySettings,
    });

    expect(sanitized.watchlist[0]?.manualLevels).toEqual({});
    expect('addDiscountPercent' in sanitized.settings).toBe(false);
  });
});

describe('weekly trend and signal history', () => {
  it('excludes the still-forming current week from the MA40 trend', () => {
    const completed = makeWeeklyCandles(41, new Date('2025-10-03T00:00:00Z'));
    const partial = {
      ...completed[completed.length - 1],
      date: '2026-07-17',
      close: 1,
    };
    const record: WeeklyDataRecord = {
      symbol: 'NVDA',
      candles: [...completed, partial],
      refreshedAt: '2026-07-16T00:00:00Z',
      tradingDate: partial.date,
      source: 'alpha-vantage',
    };

    const trend = calculateWeeklyTrend(record, '2026-07-16');

    expect(trend.latestDate).toBe(completed[completed.length - 1]?.date);
    expect(trend.latestClose).not.toBe(1);
    expect(trend.ma40).not.toBeNull();
  });

  it('replaces a same-day snapshot and retains at most 180 dates', () => {
    const settings = makeSettings();
    let history = recordSignalSnapshot(
      [],
      [generateRecommendation(makeStock(), settings, makeLevels(), '2026-06-19')],
      settings,
      new Date('2026-06-19T01:00:00Z'),
    );
    history = recordSignalSnapshot(
      history,
      [generateRecommendation(makeStock(), settings, makeLevels({ currentPrice: 101 }), '2026-06-19')],
      settings,
      new Date('2026-06-19T02:00:00Z'),
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.items[0]?.currentPrice).toBe(101);

    for (let index = 0; index < 181; index += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      history = recordSignalSnapshot(
        history,
        [generateRecommendation(
          makeStock(),
          settings,
          makeLevels({ tradingDate: date }),
          `${date}T00:00:00Z`,
        )],
        settings,
        new Date(`${date}T01:00:00Z`),
      );
    }
    expect(history).toHaveLength(180);
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
    ma60: 99,
    ma120: 108,
    ma250: 112,
    support: 98,
    deepSupport: 86,
    resistance: 110,
    brokenSupport: null,
    supportTouchCount: 3,
    deepSupportTouchCount: 2,
    resistanceTouchCount: 3,
    resistanceKind: 'swing_high',
    atr14: 1,
    ma60Trend: 'flat',
    priceStabilized: true,
    volumeSignal: 'weakening_selling',
    insufficientData: [],
    ...overrides,
  };
}

function makeOscillatingCandles(): Candle[] {
  return Array.from({ length: 90 }, (_, index) => {
    const close = 100 + Math.sin(index / 3) * 3;
    return {
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
      open: close - 0.2,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index,
    };
  });
}

function makeWeeklyTrend(symbol: string, state: WeeklyTrend['state']): WeeklyTrend {
  if (state === 'unavailable') {
    return {
      symbol,
      latestDate: null,
      latestClose: null,
      ma40: null,
      return13WeekPercent: null,
      state,
    };
  }
  return {
    symbol,
    latestDate: '2026-06-12',
    latestClose: 100,
    ma40: 105,
    return13WeekPercent: -10,
    state,
  };
}

function makeContext(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    weeklyTrend: makeWeeklyTrend('NVDA', 'healthy'),
    marketEnvironment: {
      market: makeWeeklyTrend('SPY', 'healthy'),
      sector: makeWeeklyTrend('SOXX', 'healthy'),
      sectorSymbol: 'SOXX',
      passed: true,
      detail: 'SPY 健康；SOXX 健康',
    },
    earningsCalendarAvailable: true,
    ...overrides,
  };
}

function makeWeeklyCandles(count: number, start: Date): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index * 7);
    const close = 80 + index;
    return {
      date: date.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1000 + index,
    };
  });
}
