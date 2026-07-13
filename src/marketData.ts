import type { Candle, MarketDataMap, MarketDataRecord } from './types';
import { normalizeTicker, roundMoney } from './utils';

interface RefreshResult {
  cache: MarketDataMap;
  refreshed: string[];
  skipped: string[];
  errors: string[];
}

interface AlphaVantageDailyResponse {
  'Time Series (Daily)'?: Record<string, Record<string, string>>;
  'Error Message'?: string;
  Note?: string;
  Information?: string;
}

export async function refreshMarketData(
  symbols: string[],
  apiKey: string,
  existingCache: MarketDataMap,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<RefreshResult> {
  const cache: MarketDataMap = { ...existingCache };
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const refreshDate = toDateKey(now);

  if (!apiKey.trim()) {
    return {
      cache,
      refreshed,
      skipped: symbols.map(normalizeTicker),
      errors: ['缺少 Alpha Vantage API key'],
    };
  }

  for (const rawSymbol of symbols) {
    const symbol = normalizeTicker(rawSymbol);
    const cached = cache[symbol];

    if (cached && toDateKey(new Date(cached.refreshedAt)) === refreshDate) {
      skipped.push(symbol);
      continue;
    }

    try {
      const candles = await fetchDailyCandles(symbol, apiKey, fetchImpl);
      const latest = candles[candles.length - 1];

      if (!latest) {
        errors.push(`${symbol}: 没有返回日线数据`);
        continue;
      }

      cache[symbol] = {
        symbol,
        candles,
        refreshedAt: now.toISOString(),
        tradingDate: latest.date,
        source: 'alpha-vantage',
      };
      refreshed.push(symbol);
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : '刷新失败'}`);
    }
  }

  return { cache, refreshed, skipped, errors };
}

export async function testAlphaVantageKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!apiKey.trim()) {
    return false;
  }

  const candles = await fetchDailyCandles('IBM', apiKey, fetchImpl, 'compact');
  return candles.length > 0;
}

export async function fetchDailyCandles(
  symbol: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  outputSize: 'compact' | 'full' = 'full',
): Promise<Candle[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'TIME_SERIES_DAILY_ADJUSTED');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('outputsize', outputSize);
  url.searchParams.set('apikey', apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as AlphaVantageDailyResponse;
  return parseAlphaVantageDaily(payload);
}

export function parseAlphaVantageDaily(payload: AlphaVantageDailyResponse): Candle[] {
  if (payload['Error Message']) {
    throw new Error(payload['Error Message']);
  }

  if (payload.Note || payload.Information) {
    throw new Error(payload.Note ?? payload.Information ?? 'API rate limited');
  }

  const series = payload['Time Series (Daily)'];
  if (!series) {
    throw new Error('无法解析 Alpha Vantage 日线数据');
  }

  return Object.entries(series)
    .map(([date, values]) => ({
      date,
      open: Number(values['1. open']),
      high: Number(values['2. high']),
      low: Number(values['3. low']),
      close: Number(values['5. adjusted close'] ?? values['4. close']),
      volume: Number(values['6. volume']),
    }))
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-320);
}

export function createDemoMarketData(symbols: string[], now = new Date()): MarketDataMap {
  return symbols.reduce<MarketDataMap>((cache, rawSymbol) => {
    const symbol = normalizeTicker(rawSymbol);
    const candles = createDemoCandles(symbol, now);
    const latest = candles[candles.length - 1];

    if (latest) {
      cache[symbol] = {
        symbol,
        candles,
        refreshedAt: now.toISOString(),
        tradingDate: latest.date,
        source: 'demo',
      };
    }

    return cache;
  }, {});
}

export function mergeDemoData(symbols: string[], cache: MarketDataMap, now = new Date()): MarketDataMap {
  const demo = createDemoMarketData(symbols, now);
  return symbols.reduce<MarketDataMap>((next, rawSymbol) => {
    const symbol = normalizeTicker(rawSymbol);
    next[symbol] = cache[symbol] ?? demo[symbol];
    return next;
  }, {});
}

export function getLatestRefresh(records: MarketDataRecord[]): string | undefined {
  const sorted = records.map((record) => record.refreshedAt).sort();
  return sorted[sorted.length - 1];
}

function createDemoCandles(symbol: string, now: Date): Candle[] {
  const count = 280;
  const seed = symbolSeed(symbol);
  const base = demoBasePrice(symbol, seed);
  const candles: Candle[] = [];

  for (let index = 0; index < count; index += 1) {
    const daysAgo = count - index - 1;
    const date = new Date(now);
    date.setDate(now.getDate() - daysAgo);

    const trend = 0.72 + index * 0.00145;
    const wave = Math.sin((index + seed) / 13) * 0.055;
    const latePullback = index > count - 22 ? (index - (count - 22)) * 0.0058 : 0;
    const close = base * Math.max(0.38, trend + wave - latePullback);
    const open = close * (1 + Math.sin((index + seed) / 7) * 0.006);
    const high = Math.max(open, close) * 1.018;
    const low = Math.min(open, close) * 0.982;
    const volumeBase = 2_000_000 + seed * 31_000;
    const volumeFade = index > count - 10 ? 0.68 : 1;

    candles.push({
      date: date.toISOString().slice(0, 10),
      open: roundMoney(open),
      high: roundMoney(high),
      low: roundMoney(low),
      close: roundMoney(close),
      volume: Math.round(volumeBase * (1 + Math.sin(index / 9) * 0.22) * volumeFade),
    });
  }

  return candles;
}

function demoBasePrice(symbol: string, seed: number): number {
  const known: Record<string, number> = {
    AAPL: 275,
    AMD: 150,
    GOOG: 353,
    META: 700,
    MSFT: 430,
    NFLX: 790,
    NVDA: 220,
    SOFI: 18,
    TSLA: 400,
  };

  return known[symbol] ?? 80 + (seed % 140);
}

function symbolSeed(symbol: string): number {
  return symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
