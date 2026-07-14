import type {
  AppState,
  Candle,
  EarningsCalendarCache,
  EarningsEvent,
  MarketDataMap,
  MarketDataRecord,
  SignalHistoryItem,
  SignalSnapshot,
  WeeklyDataMap,
  WeeklyDataRecord,
} from './types';
import { createDefaultState, sanitizeState } from './strategy';
import { normalizeTicker } from './utils';

const STATE_KEY = 'lao-li-stocks:v1:state';
const API_KEY = 'lao-li-stocks:v1:alpha-vantage-key';
const MARKET_CACHE_KEY = 'lao-li-stocks:v1:market-cache';
const WEEKLY_CACHE_KEY = 'lao-li-stocks:v1:weekly-cache';
const EARNINGS_CALENDAR_KEY = 'lao-li-stocks:v1:earnings-calendar';
const SIGNAL_HISTORY_KEY = 'lao-li-stocks:v1:signal-history';

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

export function loadWeeklyCache(): WeeklyDataMap {
  const parsed = readJson<Record<string, unknown>>(WEEKLY_CACHE_KEY);
  if (!parsed) {
    return {};
  }
  return Object.entries(parsed).reduce<WeeklyDataMap>((cache, [rawSymbol, value]) => {
    if (!isWeeklyDataRecord(value)) {
      return cache;
    }
    const symbol = normalizeTicker(value.symbol || rawSymbol);
    if (symbol) {
      cache[symbol] = { ...value, symbol };
    }
    return cache;
  }, {});
}

export function saveWeeklyCache(cache: WeeklyDataMap): void {
  writeJson(WEEKLY_CACHE_KEY, cache);
}

export function loadEarningsCalendar(): EarningsCalendarCache | null {
  const parsed = readJson<unknown>(EARNINGS_CALENDAR_KEY);
  return isEarningsCalendarCache(parsed) ? parsed : null;
}

export function saveEarningsCalendar(cache: EarningsCalendarCache): void {
  writeJson(EARNINGS_CALENDAR_KEY, cache);
}

export function loadSignalHistory(): SignalSnapshot[] {
  const parsed = readJson<unknown>(SIGNAL_HISTORY_KEY);
  return Array.isArray(parsed) ? parsed.filter(isSignalSnapshot) : [];
}

export function saveSignalHistory(history: SignalSnapshot[]): void {
  writeJson(SIGNAL_HISTORY_KEY, history.slice(-180));
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

function isWeeklyDataRecord(value: unknown): value is WeeklyDataRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<WeeklyDataRecord>;
  return (
    record.source === 'alpha-vantage'
    && typeof record.symbol === 'string'
    && typeof record.refreshedAt === 'string'
    && typeof record.tradingDate === 'string'
    && Array.isArray(record.candles)
    && record.candles.length > 0
    && record.candles.every(isCandle)
  );
}

function isEarningsCalendarCache(value: unknown): value is EarningsCalendarCache {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const cache = value as Partial<EarningsCalendarCache>;
  return typeof cache.refreshedAt === 'string'
    && Array.isArray(cache.events)
    && cache.events.every(isEarningsEvent);
}

function isEarningsEvent(value: unknown): value is EarningsEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const event = value as Partial<EarningsEvent>;
  return typeof event.symbol === 'string'
    && typeof event.name === 'string'
    && typeof event.reportDate === 'string';
}

function isSignalSnapshot(value: unknown): value is SignalSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const snapshot = value as Partial<SignalSnapshot>;
  return typeof snapshot.tradingDate === 'string'
    && typeof snapshot.recordedAt === 'string'
    && Boolean(snapshot.settings)
    && Array.isArray(snapshot.items)
    && snapshot.items.every(isSignalHistoryItem);
}

function isSignalHistoryItem(value: unknown): value is SignalHistoryItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<SignalHistoryItem>;
  return typeof item.symbol === 'string'
    && typeof item.action === 'string'
    && typeof item.label === 'string'
    && typeof item.passedConditions === 'number'
    && typeof item.totalConditions === 'number';
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
