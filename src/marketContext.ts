import type {
  EarningsCalendarCache,
  MarketDataMap,
  MarketEnvironment,
  RecommendationContext,
  WatchStock,
  WeeklyDataMap,
  WeeklyDataRecord,
  WeeklyTrend,
} from './types';
import { roundMoney } from './utils';

const MARKET_BENCHMARK = 'SPY';

export function getSectorBenchmark(sector: string): string {
  const normalized = sector.trim().toLowerCase();
  if (normalized.includes('semiconductor')) return 'SOXX';
  if (normalized.includes('software') || normalized.includes('technology')) return 'XLK';
  if (normalized.includes('financial') || normalized.includes('fintech')) return 'XLF';
  if (normalized.includes('health') || normalized.includes('biotech')) return 'XLV';
  if (normalized.includes('staple')) return 'XLP';
  if (normalized.includes('consumer') || normalized.includes('retail')) return 'XLY';
  if (normalized.includes('industrial') || normalized.includes('transport')) return 'XLI';
  if (normalized.includes('energy') || normalized.includes('oil') || normalized.includes('gas')) return 'XLE';
  if (normalized.includes('utility')) return 'XLU';
  if (normalized.includes('real estate')) return 'XLRE';
  if (normalized.includes('material') || normalized.includes('mining')) return 'XLB';
  if (
    normalized.includes('communication')
    || normalized.includes('media')
    || normalized.includes('telecom')
  ) return 'XLC';
  return MARKET_BENCHMARK;
}

export function getRequiredBenchmarkSymbols(watchlist: WatchStock[]): string[] {
  return [...new Set([
    MARKET_BENCHMARK,
    ...watchlist.map((stock) => getSectorBenchmark(stock.sector)),
  ])];
}

export function buildRecommendationContext(
  stock: WatchStock,
  marketData: MarketDataMap,
  weeklyData: WeeklyDataMap,
  earningsCalendar: EarningsCalendarCache | null,
): RecommendationContext {
  const tradingDate = marketData[stock.symbol]?.tradingDate ?? '';
  const sectorSymbol = getSectorBenchmark(stock.sector);
  const weeklyTrend = calculateWeeklyTrend(weeklyData[stock.symbol], tradingDate);
  const marketTrend = calculateWeeklyTrend(weeklyData[MARKET_BENCHMARK], tradingDate);
  const sectorTrend = calculateWeeklyTrend(weeklyData[sectorSymbol], tradingDate);
  const marketEnvironment = evaluateMarketEnvironment(marketTrend, sectorTrend, sectorSymbol);
  const nextEarnings = earningsCalendar?.events
    .filter((event) => event.symbol === stock.symbol && event.reportDate >= tradingDate)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))[0];

  return {
    weeklyTrend,
    marketEnvironment,
    earningsCalendarAvailable: earningsCalendar !== null,
    ...(nextEarnings ? { nextEarnings } : {}),
  };
}

export function calculateWeeklyTrend(
  record: WeeklyDataRecord | undefined,
  currentTradingDate: string,
): WeeklyTrend {
  const symbol = record?.symbol ?? '';
  if (!record) {
    return unavailableTrend(symbol);
  }
  const candles = currentTradingDate
    ? record.candles.filter((candle) => weekKey(candle.date) !== weekKey(currentTradingDate))
    : record.candles;
  if (candles.length < 40) {
    return unavailableTrend(symbol);
  }

  const latest = candles[candles.length - 1];
  const ma40 = average(candles.slice(-40).map((candle) => candle.close));
  const previousWindow = candles.slice(0, -5).slice(-40);
  const previousMa40 = previousWindow.length === 40
    ? average(previousWindow.map((candle) => candle.close))
    : ma40;
  const comparison = candles[candles.length - 14];
  const return13WeekPercent = comparison
    ? (latest.close - comparison.close) / comparison.close * 100
    : null;
  const aboveAverage = latest.close >= ma40;
  const averageRising = ma40 >= previousMa40 * 0.995;
  const state = aboveAverage && averageRising
    ? 'healthy'
    : !aboveAverage && !averageRising
      ? 'weak'
      : 'neutral';

  return {
    symbol,
    latestDate: latest.date,
    latestClose: roundMoney(latest.close),
    ma40: roundMoney(ma40),
    return13WeekPercent: return13WeekPercent === null
      ? null
      : roundMoney(return13WeekPercent),
    state,
  };
}

function evaluateMarketEnvironment(
  market: WeeklyTrend,
  sector: WeeklyTrend,
  sectorSymbol: string,
): MarketEnvironment {
  const available = market.state !== 'unavailable' && sector.state !== 'unavailable';
  const passed = available && (sectorSymbol === MARKET_BENCHMARK
    ? market.state !== 'weak'
    : !(market.state === 'weak' && sector.state === 'weak'));
  const detail = !available
    ? `缺少 ${MARKET_BENCHMARK} 或 ${sectorSymbol} 的完整周线`
    : `${MARKET_BENCHMARK} ${trendLabel(market.state)}；${sectorSymbol} ${trendLabel(sector.state)}`;
  return { market, sector, sectorSymbol, passed, detail };
}

function unavailableTrend(symbol: string): WeeklyTrend {
  return {
    symbol,
    latestDate: null,
    latestClose: null,
    ma40: null,
    return13WeekPercent: null,
    state: 'unavailable',
  };
}

function trendLabel(state: WeeklyTrend['state']): string {
  if (state === 'healthy') return '健康';
  if (state === 'weak') return '偏弱';
  if (state === 'neutral') return '中性';
  return '不可用';
}

function weekKey(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) {
    return dateValue;
  }
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
