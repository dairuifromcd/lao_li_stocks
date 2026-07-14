import type { AppState, Candle, MarketDataMap, MarketDataRecord } from './types';
import { createDefaultState, sanitizeState } from './strategy';
import { normalizeTicker } from './utils';

const STATE_KEY = 'lao-li-stocks:v1:state';
const API_KEY = 'lao-li-stocks:v1:alpha-vantage-key';
const MARKET_CACHE_KEY = 'lao-li-stocks:v1:market-cache';

export function loadAppState(): AppState {
  const parsed = readJson<Partial<AppState>>(STATE_KEY);
  if (!parsed) {
    return createDefaultState();
  }

  return sanitizeState(parsed);
}

export function saveAppState(state: AppState): void {
  writeJson(STATE_KEY, {
    ...sanitizeState(state),
    lastSavedAt: new Date().toISOString(),
  });
}

export function loadApiKey(): string {
  return localStorage.getItem(API_KEY) ?? '';
}

export function saveApiKey(value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    localStorage.removeItem(API_KEY);
    return;
  }

  localStorage.setItem(API_KEY, trimmed);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY);
}

export function loadMarketCache(): MarketDataMap {
  const parsed = readJson<Record<string, unknown>>(MARKET_CACHE_KEY);
  if (!parsed) {
    return {};
  }

  return Object.entries(parsed).reduce<MarketDataMap>((cache, [rawSymbol, value]) => {
    if (!isMarketDataRecord(value)) {
      return cache;
    }

    const symbol = normalizeTicker(value.symbol || rawSymbol);
    if (symbol) {
      cache[symbol] = { ...value, symbol };
    }
    return cache;
  }, {});
}

export function saveMarketCache(cache: MarketDataMap): void {
  writeJson(MARKET_CACHE_KEY, cache);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function isMarketDataRecord(value: unknown): value is MarketDataRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<MarketDataRecord>;
  return (
    (record.source === 'alpha-vantage' || record.source === 'cache') &&
    typeof record.symbol === 'string' &&
    typeof record.refreshedAt === 'string' &&
    typeof record.tradingDate === 'string' &&
    Array.isArray(record.candles) &&
    record.candles.length > 0 &&
    record.candles.every(isCandle)
  );
}

function isCandle(value: unknown): value is Candle {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candle = value as Partial<Candle>;
  return (
    typeof candle.date === 'string' &&
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(
      (numberValue) => typeof numberValue === 'number' && Number.isFinite(numberValue),
    )
  );
}
