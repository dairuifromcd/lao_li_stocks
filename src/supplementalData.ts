import {
  AlphaVantageRateLimitError,
  AlphaVantageRequestBudgetError,
  createAlphaVantageRequestScheduler,
} from './marketData';
import type {
  AlphaRequestScheduler,
  RefreshOptions,
} from './marketData';
import type {
  Candle,
  EarningsCalendarCache,
  EarningsEvent,
  WeeklyDataMap,
} from './types';
import { normalizeTicker, roundMoney } from './utils';

interface AlphaVantageWeeklyResponse {
  'Weekly Adjusted Time Series'?: Record<string, Record<string, string>>;
  'Error Message'?: string;
  Note?: string;
  Information?: string;
}

export interface SupplementalRefreshResult {
  weeklyCache: WeeklyDataMap;
  earningsCalendar: EarningsCalendarCache | null;
  weeklyRefreshed: string[];
  weeklySkipped: string[];
  earningsRefreshed: boolean;
  errors: string[];
}

export async function refreshSupplementalData(
  symbols: string[],
  apiKey: string,
  existingWeeklyCache: WeeklyDataMap,
  existingEarningsCalendar: EarningsCalendarCache | null,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  options: RefreshOptions = {},
): Promise<SupplementalRefreshResult> {
  const weeklyCache = { ...existingWeeklyCache };
  let earningsCalendar = existingEarningsCalendar;
  const weeklyRefreshed: string[] = [];
  const weeklySkipped: string[] = [];
  const errors: string[] = [];
  const scheduler = options.scheduler ?? createAlphaVantageRequestScheduler(options);
  const wait = options.wait ?? delay;
  const retryDelay = options.rateLimitRetryDelayMs ?? 1600;
  let requestsBlocked = false;

  if (!apiKey.trim()) {
    return {
      weeklyCache,
      earningsCalendar,
      weeklyRefreshed,
      weeklySkipped: symbols.map(normalizeTicker),
      earningsRefreshed: false,
      errors: ['缺少 Alpha Vantage API key'],
    };
  }

  let earningsRefreshed = false;
  if (!isEarningsCalendarFresh(earningsCalendar, now)) {
    try {
      const events = await requestWithOneRetry(
        scheduler,
        () => fetchEarningsCalendar(apiKey, fetchImpl),
        wait,
        retryDelay,
      );
      earningsCalendar = { refreshedAt: now.toISOString(), events };
      earningsRefreshed = true;
    } catch (error) {
      errors.push(`财报日历: ${formatSupplementalError(error)}`);
      requestsBlocked = error instanceof AlphaVantageRateLimitError
        || error instanceof AlphaVantageRequestBudgetError;
    }
  }

  for (const rawSymbol of [...new Set(symbols.map(normalizeTicker).filter(Boolean))]) {
    if (requestsBlocked) {
      break;
    }
    const symbol = normalizeTicker(rawSymbol);
    const cached = weeklyCache[symbol];
    if (cached && weekKey(new Date(cached.refreshedAt)) === weekKey(now)) {
      weeklySkipped.push(symbol);
      continue;
    }

    try {
      const candles = await requestWithOneRetry(
        scheduler,
        () => fetchWeeklyAdjustedCandles(symbol, apiKey, fetchImpl),
        wait,
        retryDelay,
      );
      const latest = candles[candles.length - 1];
      if (!latest) {
        errors.push(`${symbol} 周线: 没有返回数据`);
        continue;
      }
      weeklyCache[symbol] = {
        symbol,
        candles,
        refreshedAt: now.toISOString(),
        tradingDate: latest.date,
        source: 'alpha-vantage',
      };
      weeklyRefreshed.push(symbol);
    } catch (error) {
      errors.push(`${symbol} 周线: ${formatSupplementalError(error)}`);
      if (
        error instanceof AlphaVantageRateLimitError
        || error instanceof AlphaVantageRequestBudgetError
      ) {
        break;
      }
    }
  }

  return {
    weeklyCache,
    earningsCalendar,
    weeklyRefreshed,
    weeklySkipped,
    earningsRefreshed,
    errors,
  };
}

export async function fetchWeeklyAdjustedCandles(
  symbol: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Candle[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'TIME_SERIES_WEEKLY_ADJUSTED');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseAlphaVantageWeeklyAdjusted(
    (await response.json()) as AlphaVantageWeeklyResponse,
  );
}

export function parseAlphaVantageWeeklyAdjusted(
  payload: AlphaVantageWeeklyResponse,
): Candle[] {
  throwForAlphaVantageError(payload);
  const series = payload['Weekly Adjusted Time Series'];
  if (!series) {
    throw new Error('无法解析 Alpha Vantage 周线复权数据');
  }

  return Object.entries(series)
    .map(([date, values]) => {
      const rawClose = Number(values['4. close']);
      const adjustedClose = Number(values['5. adjusted close']);
      const factor = rawClose > 0 ? adjustedClose / rawClose : Number.NaN;
      return {
        date,
        open: roundMoney(Number(values['1. open']) * factor),
        high: roundMoney(Number(values['2. high']) * factor),
        low: roundMoney(Number(values['3. low']) * factor),
        close: roundMoney(adjustedClose),
        volume: Number(values['6. volume']),
      };
    })
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-320);
}

export async function fetchEarningsCalendar(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EarningsEvent[]> {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'EARNINGS_CALENDAR');
  url.searchParams.set('horizon', '3month');
  url.searchParams.set('apikey', apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseEarningsCalendar(await response.text());
}

export function parseEarningsCalendar(csvText: string): EarningsEvent[] {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('{')) {
    const payload = JSON.parse(trimmed) as AlphaVantageWeeklyResponse;
    throwForAlphaVantageError(payload);
    throw new Error('无法解析 Alpha Vantage 财报日历');
  }

  const rows = parseCsv(trimmed);
  const header = rows[0]?.map((value) => value.trim()) ?? [];
  const index = (name: string) => header.indexOf(name);
  const symbolIndex = index('symbol');
  const reportDateIndex = index('reportDate');
  if (symbolIndex < 0 || reportDateIndex < 0) {
    throw new Error('财报日历缺少必要字段');
  }

  return rows.slice(1).flatMap((row) => {
    const symbol = normalizeTicker(row[symbolIndex] ?? '');
    const reportDate = row[reportDateIndex]?.trim() ?? '';
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return [];
    }
    const estimateText = row[index('estimate')]?.trim() ?? '';
    const estimateValue = estimateText ? Number(estimateText) : Number.NaN;
    return [{
      symbol,
      name: row[index('name')]?.trim() ?? symbol,
      reportDate,
      ...(row[index('fiscalDateEnding')]?.trim()
        ? { fiscalDateEnding: row[index('fiscalDateEnding')]?.trim() }
        : {}),
      ...(Number.isFinite(estimateValue) ? { estimate: estimateValue } : {}),
      ...(row[index('currency')]?.trim()
        ? { currency: row[index('currency')]?.trim() }
        : {}),
    }];
  });
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      if (row.some((item) => item.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((item) => item.length > 0)) {
    rows.push(row);
  }
  return rows;
}

async function requestWithOneRetry<T>(
  scheduler: AlphaRequestScheduler,
  operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void>,
  retryDelay: number,
): Promise<T> {
  try {
    return await scheduler.schedule(operation);
  } catch (error) {
    if (!(error instanceof AlphaVantageRateLimitError)) {
      throw error;
    }
    await wait(retryDelay);
    return scheduler.schedule(operation);
  }
}

function throwForAlphaVantageError(payload: AlphaVantageWeeklyResponse): void {
  if (payload['Error Message']) {
    throw new Error(payload['Error Message']);
  }
  const message = payload.Note ?? payload.Information;
  if (!message) {
    return;
  }
  const normalized = message.toLowerCase();
  if (
    normalized.includes('rate limit')
    || normalized.includes('requests per second')
    || normalized.includes('spread') && normalized.includes('request')
  ) {
    throw new AlphaVantageRateLimitError(message);
  }
  throw new Error(message);
}

function isEarningsCalendarFresh(
  cache: EarningsCalendarCache | null,
  now: Date,
): boolean {
  if (!cache) {
    return false;
  }
  const refreshedAt = new Date(cache.refreshedAt).getTime();
  return Number.isFinite(refreshedAt)
    && now.getTime() - refreshedAt < 7 * 24 * 60 * 60 * 1000;
}

function weekKey(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy.toISOString().slice(0, 10);
}

function formatSupplementalError(error: unknown): string {
  if (error instanceof AlphaVantageRequestBudgetError) {
    return '已达到本次免费请求预算，剩余数据将在下次刷新时补齐';
  }
  if (error instanceof AlphaVantageRateLimitError) {
    return 'Alpha Vantage 免费额度限制，请稍后再试';
  }
  return error instanceof Error ? error.message : '刷新失败';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
