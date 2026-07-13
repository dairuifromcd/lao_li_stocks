import type { AppState, MarketDataMap } from './types';
import { createDefaultState, sanitizeState } from './strategy';

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
  return readJson<MarketDataMap>(MARKET_CACHE_KEY) ?? {};
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
