import type { Candle, MarketDataMap, MarketDataRecord } from './types';
import { normalizeTicker } from './utils';

export interface RefreshResult {
  cache: MarketDataMap;
  refreshed: string[];
  skipped: string[];
  errors: string[];
}

export interface RefreshOptions {
  minimumRequestIntervalMs?: number;
  rateLimitRetryDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  nowMs?: () => number;
  scheduler?: AlphaRequestScheduler;
  maxRequests?: number;
}

export interface AlphaRequestScheduler {
  readonly requestCount: number;
  readonly maxRequests: number;
  schedule<T>(operation: () => Promise<T>): Promise<T>;
}

interface AlphaVantageDailyResponse {
  'Time Series (Daily)'?: Record<string, Record<string, string>>;
  'Error Message'?: string;
  Note?: string;
  Information?: string;
}

export class AlphaVantageRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlphaVantageRateLimitError';
  }
}

export class AlphaVantageRequestBudgetError extends Error {
  constructor() {
    super('Alpha Vantage 免费请求预算已用完');
    this.name = 'AlphaVantageRequestBudgetError';
  }
}

export function createAlphaVantageRequestScheduler(
  options: Omit<RefreshOptions, 'scheduler'> = {},
): AlphaRequestScheduler {
  const minimumRequestIntervalMs = options.minimumRequestIntervalMs ?? 1200;
  const wait = options.wait ?? delay;
  const nowMs = options.nowMs ?? Date.now;
  const maxRequests = options.maxRequests ?? Number.POSITIVE_INFINITY;
  let lastRequestStartedAt: number | null = null;
  let requestCount = 0;

  return {
    get requestCount() {
      return requestCount;
    },
    maxRequests,
    async schedule<T>(operation: () => Promise<T>): Promise<T> {
      if (requestCount >= maxRequests) {
        throw new AlphaVantageRequestBudgetError();
      }
      if (lastRequestStartedAt !== null) {
        const elapsed = nowMs() - lastRequestStartedAt;
        if (elapsed < minimumRequestIntervalMs) {
          await wait(minimumRequestIntervalMs - elapsed);
        }
      }
      lastRequestStartedAt = nowMs();
      requestCount += 1;
      return operation();
    },
  };
}

export async function refreshMarketData(
  symbols: string[],
  apiKey: string,
  existingCache: MarketDataMap,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const cache: MarketDataMap = { ...existingCache };
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const refreshDate = toDateKey(now);
  const rateLimitRetryDelayMs = options.rateLimitRetryDelayMs ?? 1600;
  const wait = options.wait ?? delay;
  const scheduler = options.scheduler ?? createAlphaVantageRequestScheduler(options);

  if (!apiKey.trim()) {
    return {
      cache,
      refreshed,
      skipped: symbols.map(normalizeTicker),
      errors: ['缺少 Alpha Vantage API key'],
    };
  }

  const requestCandles = async (symbol: string): Promise<Candle[]> => {
    return scheduler.schedule(() => fetchDailyCandles(symbol, apiKey, fetchImpl));
  };

  for (const rawSymbol of symbols) {
    const symbol = normalizeTicker(rawSymbol);
    const cached = cache[symbol];

    if (cached && toDateKey(new Date(cached.refreshedAt)) === refreshDate) {
      skipped.push(symbol);
      continue;
    }

    try {
      let candles: Candle[];
      try {
        candles = await requestCandles(symbol);
      } catch (error) {
        if (!(error instanceof AlphaVantageRateLimitError)) {
          throw error;
        }

        await wait(rateLimitRetryDelayMs);
        candles = await requestCandles(symbol);
      }
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
      errors.push(`${symbol}: ${formatRefreshError(error)}`);
      if (
        error instanceof AlphaVantageRateLimitError
        || error instanceof AlphaVantageRequestBudgetError
      ) {
        break;
      }
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
  outputSize: 'compact' | 'full' = 'compact',
): Promise<Candle[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'TIME_SERIES_DAILY');
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
    const message = payload.Note ?? payload.Information ?? 'API rate limited';
    if (isRateLimitMessage(message)) {
      throw new AlphaVantageRateLimitError(message);
    }
    throw new Error(message);
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
      volume: Number(values['6. volume'] ?? values['5. volume']),
    }))
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-320);
}

export function getLatestRefresh(records: MarketDataRecord[]): string | undefined {
  const sorted = records.map((record) => record.refreshedAt).sort();
  return sorted[sorted.length - 1];
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRateLimitMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('rate limit') ||
    normalized.includes('requests per second') ||
    normalized.includes('spread') && normalized.includes('request')
  );
}

function formatRefreshError(error: unknown): string {
  if (error instanceof AlphaVantageRequestBudgetError) {
    return '已达到本次免费请求预算，剩余数据将在下次刷新时补齐';
  }
  if (error instanceof AlphaVantageRateLimitError) {
    return 'Alpha Vantage 免费额度限制，请稍后再试；系统不会继续循环请求';
  }
  return error instanceof Error ? error.message : '刷新失败';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
