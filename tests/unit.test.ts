import { describe, expect, it } from 'vitest';
import { parseAlphaVantageDaily } from '../src/marketData';
import { calculateMovingAverage, generateRecommendation } from '../src/strategy';
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
});

describe('strategy engine', () => {
  it('calculates moving averages only when enough candles exist', () => {
    const candles = makeCandles(10, 100);

    expect(calculateMovingAverage(candles, 5)).toBe(107);
    expect(calculateMovingAverage(candles, 20)).toBeNull();
  });

  it('emits an entry signal near support', () => {
    const recommendation = generateRecommendation(makeStock(), makeSettings(), makeLevels(), '2026-06-19');

    expect(recommendation.action).toBe('entry');
    expect(recommendation.reasons.join(' ')).toContain('支撑位');
  });

  it('emits a trim watch signal near resistance', () => {
    const recommendation = generateRecommendation(
      makeStock(),
      makeSettings(),
      makeLevels({ currentPrice: 127.8, support: 100, resistance: 130 }),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('trim_watch');
    expect(recommendation.reasons.join(' ')).toContain('压力位');
  });

  it('blocks signals when a stock is sealed', () => {
    const recommendation = generateRecommendation(
      makeStock({ status: 'sealed' }),
      makeSettings(),
      makeLevels(),
      '2026-06-19',
    );

    expect(recommendation.action).toBe('hold');
    expect(recommendation.blockers).toContain('该股票已封仓');
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
    resistance: 130,
    volumeSignal: 'weakening_selling',
    insufficientData: [],
    ...overrides,
  };
}
