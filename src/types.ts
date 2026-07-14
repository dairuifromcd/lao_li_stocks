export type StockStatus = 'active' | 'sealed' | 'no_action';

export type RecommendationAction =
  | 'technical_ready'
  | 'approaching'
  | 'waiting_confirmation'
  | 'breakdown'
  | 'pressure_watch'
  | 'hold';

export type ObservationLevelKind = 'low' | 'deep' | 'pressure';

export type ObservationTimeframe = 'daily' | 'weekly';

export type ObservationLevelSource = 'manual' | 'automatic';

export type DataQuality = 'complete' | 'limited' | 'unavailable';

export type ConditionKey =
  | 'data'
  | 'level'
  | 'location'
  | 'confirmation'
  | 'market'
  | 'event'
  | 'room';

export type TrendState = 'healthy' | 'neutral' | 'weak' | 'unavailable';

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

export interface WeeklyDataRecord {
  symbol: string;
  candles: Candle[];
  refreshedAt: string;
  tradingDate: string;
  source: 'alpha-vantage';
}

export type WeeklyDataMap = Record<string, WeeklyDataRecord>;

export interface EarningsEvent {
  symbol: string;
  name: string;
  reportDate: string;
  fiscalDateEnding?: string;
  estimate?: number;
  currency?: string;
}

export interface EarningsCalendarCache {
  refreshedAt: string;
  events: EarningsEvent[];
}

export interface WeeklyTrend {
  symbol: string;
  latestDate: string | null;
  latestClose: number | null;
  ma40: number | null;
  return13WeekPercent: number | null;
  state: TrendState;
}

export interface MarketEnvironment {
  market: WeeklyTrend;
  sector: WeeklyTrend;
  sectorSymbol: string;
  passed: boolean;
  detail: string;
}

export interface RecommendationContext {
  weeklyTrend?: WeeklyTrend;
  marketEnvironment?: MarketEnvironment;
  earningsCalendarAvailable?: boolean;
  nextEarnings?: EarningsEvent;
}

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
  brokenSupport: number | null;
  supportTouchCount: number;
  deepSupportTouchCount: number;
  resistanceTouchCount: number;
  resistanceKind: 'swing_high' | 'broken_support' | null;
  atr14: number | null;
  ma60Trend: 'rising' | 'flat' | 'falling' | 'unavailable';
  priceStabilized: boolean;
  volumeSignal: 'weakening_selling' | 'expanding_on_rise' | 'neutral';
  insufficientData: string[];
}

export interface AppliedObservationLevel {
  kind: ObservationLevelKind;
  price: number;
  source: ObservationLevelSource;
  basis: string;
  timeframe?: ObservationTimeframe;
  confirmedAt?: string;
  invalidationPrice?: number;
  touchCount?: number;
}

export interface ConditionCheck {
  key: ConditionKey;
  label: string;
  passed: boolean;
  detail: string;
}

export interface Recommendation {
  symbol: string;
  action: RecommendationAction;
  label: string;
  reasons: string[];
  blockers: string[];
  warnings: string[];
  levels: TechnicalLevels | null;
  triggeredLevel: AppliedObservationLevel | null;
  manualLevelCount: number;
  conditionChecks: ConditionCheck[];
  confirmationCount: number;
  invalidationPrice: number | null;
  roomRatio: number | null;
  dataQuality: DataQuality;
  weeklyTrend: WeeklyTrend | null;
  marketEnvironment: MarketEnvironment | null;
  nextEarnings: EarningsEvent | null;
}

export interface SignalSummary {
  trackedCount: number;
  reviewCount: number;
  readyCount: number;
  waitingCount: number;
  riskCount: number;
  warningCount: number;
}

export interface SignalHistoryItem {
  symbol: string;
  action: RecommendationAction;
  label: string;
  currentPrice: number | null;
  support: number | null;
  resistance: number | null;
  passedConditions: number;
  totalConditions: number;
  nextEarningsDate: string | null;
}

export interface SignalSnapshot {
  tradingDate: string;
  recordedAt: string;
  settings: StrategySettings;
  items: SignalHistoryItem[];
}
