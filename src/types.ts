export type StockStatus = 'active' | 'sealed' | 'no_action';

export type RecommendationAction = 'entry' | 'add_watch' | 'hold' | 'trim_watch';

export type ObservationLevelKind = 'low' | 'deep' | 'pressure';

export type ObservationTimeframe = 'daily' | 'weekly';

export type ObservationLevelSource = 'manual' | 'automatic';

export interface ManualObservationLevel {
  price: number;
  basis: string;
  timeframe: ObservationTimeframe;
  invalidationPrice?: number;
  confirmedAt?: string;
}

export type ManualObservationLevels = Partial<
  Record<ObservationLevelKind, ManualObservationLevel>
>;

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchStock {
  symbol: string;
  name: string;
  sector: string;
  thesis: string;
  status: StockStatus;
  manualLevels?: ManualObservationLevels;
}

export interface StrategySettings {
  entryBufferPercent: number;
  addDiscountPercent: number;
  resistanceBufferPercent: number;
  minimumCandles: number;
}

export interface AppState {
  watchlist: WatchStock[];
  settings: StrategySettings;
  lastSavedAt?: string;
}

export interface MarketDataRecord {
  symbol: string;
  candles: Candle[];
  refreshedAt: string;
  tradingDate: string;
  source: 'alpha-vantage' | 'cache';
}

export type MarketDataMap = Record<string, MarketDataRecord>;

export interface TechnicalLevels {
  currentPrice: number;
  tradingDate: string;
  candleCount: number;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma250: number | null;
  support: number | null;
  deepSupport: number | null;
  resistance: number | null;
  volumeSignal: 'weakening_selling' | 'expanding' | 'neutral';
  insufficientData: string[];
}

export interface AppliedObservationLevel {
  kind: ObservationLevelKind;
  price: number;
  source: ObservationLevelSource;
  basis: string;
  timeframe?: ObservationTimeframe;
  confirmedAt?: string;
}

export interface Recommendation {
  symbol: string;
  action: RecommendationAction;
  label: string;
  confidence: number;
  reasons: string[];
  blockers: string[];
  warnings: string[];
  levels: TechnicalLevels | null;
  triggeredLevel: AppliedObservationLevel | null;
  manualLevelCount: number;
}

export interface SignalSummary {
  trackedCount: number;
  actionableCount: number;
  entryCount: number;
  addWatchCount: number;
  trimWatchCount: number;
  warningCount: number;
}
