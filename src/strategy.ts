import type {
  AppState,
  Candle,
  MarketDataMap,
  Recommendation,
  RecommendationAction,
  SignalSummary,
  StrategySettings,
  TechnicalLevels,
  WatchStock,
} from './types';
import { formatCurrency, normalizeTicker, roundMoney } from './utils';

const ACTION_LABELS: Record<RecommendationAction, string> = {
  entry: '接近开仓区',
  add_watch: '接近加仓区',
  hold: '继续观察',
  trim_watch: '接近压力区',
};

const DEFAULT_SETTINGS: StrategySettings = {
  entryBufferPercent: 3.5,
  addDiscountPercent: 7,
  resistanceBufferPercent: 2,
  minimumCandles: 60,
};

export function calculateMovingAverage(candles: Candle[], windowSize: number): number | null {
  if (candles.length < windowSize) {
    return null;
  }

  const slice = candles.slice(-windowSize);
  const total = slice.reduce((sum, candle) => sum + candle.close, 0);
  return roundMoney(total / windowSize);
}

export function calculateTechnicalLevels(candles: Candle[]): TechnicalLevels | null {
  const sortedCandles = sortCandles(candles);
  const latest = sortedCandles[sortedCandles.length - 1];

  if (!latest) {
    return null;
  }

  const recentCandles = sortedCandles.slice(-90);
  const currentPrice = latest.close;
  const support = findSupport(recentCandles, currentPrice);
  const resistance = findResistance(recentCandles, currentPrice);
  const ma20 = calculateMovingAverage(sortedCandles, 20);
  const ma60 = calculateMovingAverage(sortedCandles, 60);
  const ma120 = calculateMovingAverage(sortedCandles, 120);
  const ma250 = calculateMovingAverage(sortedCandles, 250);

  return {
    currentPrice,
    tradingDate: latest.date,
    candleCount: sortedCandles.length,
    ma20,
    ma60,
    ma120,
    ma250,
    support,
    resistance,
    volumeSignal: calculateVolumeSignal(sortedCandles),
    insufficientData: [
      ma20 === null ? 'MA20' : '',
      ma60 === null ? 'MA60' : '',
      ma120 === null ? 'MA120' : '',
      ma250 === null ? 'MA250' : '',
    ].filter(Boolean),
  };
}

export function generateRecommendations(
  state: AppState,
  marketData: MarketDataMap,
): Recommendation[] {
  return state.watchlist.map((stock) => {
    const record = marketData[stock.symbol];
    const levels = record ? calculateTechnicalLevels(record.candles) : null;
    return generateRecommendation(stock, state.settings, levels, record?.refreshedAt);
  });
}

export function generateRecommendation(
  stock: WatchStock,
  settings: StrategySettings,
  levels: TechnicalLevels | null,
  refreshedAt?: string,
): Recommendation {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const reasons: string[] = [];

  if (!levels) {
    warnings.push('没有可用行情数据');
    return createRecommendation(stock, 'hold', 0, reasons, blockers, warnings, null);
  }

  if (levels.insufficientData.length > 0) {
    warnings.push(`指标数据不足：${levels.insufficientData.join(', ')}`);
  }

  if (levels.candleCount < settings.minimumCandles) {
    warnings.push(`K线数量少于最低要求：${levels.candleCount}/${settings.minimumCandles}`);
  }

  if (!refreshedAt) {
    warnings.push('行情刷新时间未知');
  }

  if (stock.status === 'sealed') {
    blockers.push('该股票已封仓');
    return createRecommendation(stock, 'hold', 0.2, reasons, blockers, warnings, levels);
  }

  if (stock.status === 'no_action') {
    blockers.push('该股票被标记为暂无操作');
    return createRecommendation(stock, 'hold', 0.2, reasons, blockers, warnings, levels);
  }

  const nearSupport = isNearSupport(levels, settings.entryBufferPercent);
  const addZone = isAddWatchZone(levels, settings.addDiscountPercent);
  const nearResistance = isNearResistance(levels, settings.resistanceBufferPercent);
  const belowMediumAverage = isBelowRelevantAverage(levels);

  if (nearResistance && levels.resistance !== null) {
    reasons.push(`价格接近压力位 ${formatCurrency(levels.resistance)}`);
    return createRecommendation(stock, 'trim_watch', 0.7, reasons, blockers, warnings, levels);
  }

  if (addZone) {
    if (levels.support !== null) {
      reasons.push(`价格跌破或贴近深度支撑区 ${formatCurrency(levels.support)}`);
    }
    if (belowMediumAverage) {
      reasons.push('价格处于中长期均线下方');
    }
    if (levels.volumeSignal === 'weakening_selling') {
      reasons.push('下跌段成交量收缩，抛压可能减弱');
    }
    return createRecommendation(
      stock,
      'add_watch',
      calculateSignalConfidence(levels, nearSupport, belowMediumAverage),
      reasons,
      blockers,
      warnings,
      levels,
    );
  }

  if (nearSupport || belowMediumAverage) {
    if (nearSupport && levels.support !== null) {
      reasons.push(`价格接近支撑位 ${formatCurrency(levels.support)}`);
    }
    if (belowMediumAverage) {
      reasons.push('价格接近中长期均线区域');
    }
    if (levels.volumeSignal === 'weakening_selling') {
      reasons.push('下跌段成交量收缩，抛压可能减弱');
    }
    return createRecommendation(
      stock,
      'entry',
      calculateSignalConfidence(levels, nearSupport, belowMediumAverage),
      reasons,
      blockers,
      warnings,
      levels,
    );
  }

  reasons.push('价格未进入预设技术区间');
  return createRecommendation(stock, 'hold', 0.42, reasons, blockers, warnings, levels);
}

export function buildSignalSummary(recommendations: Recommendation[]): SignalSummary {
  return {
    trackedCount: recommendations.length,
    actionableCount: recommendations.filter((item) => item.action !== 'hold').length,
    entryCount: recommendations.filter((item) => item.action === 'entry').length,
    addWatchCount: recommendations.filter((item) => item.action === 'add_watch').length,
    trimWatchCount: recommendations.filter((item) => item.action === 'trim_watch').length,
    warningCount: recommendations.filter((item) => item.warnings.length > 0).length,
  };
}

export function createDefaultState(): AppState {
  return {
    watchlist: [
      {
        symbol: 'NVDA',
        name: 'NVIDIA',
        sector: 'Semiconductors',
        thesis: 'AI 训练和推理生态仍是核心驱动。',
        status: 'active',
      },
      {
        symbol: 'MSFT',
        name: 'Microsoft',
        sector: 'Software',
        thesis: '云业务和 Copilot 渗透率提供长期复利。',
        status: 'active',
      },
      {
        symbol: 'SOFI',
        name: 'SoFi',
        sector: 'Financial Technology',
        thesis: '高波动成长股，只允许观察小级别技术位。',
        status: 'active',
      },
    ],
    settings: DEFAULT_SETTINGS,
  };
}

export function sanitizeState(state: Partial<AppState>): AppState {
  const fallback = createDefaultState();
  const rawWatchlist = Array.isArray(state.watchlist) ? state.watchlist : fallback.watchlist;
  const rawSettings = state.settings ?? fallback.settings;

  return {
    watchlist: rawWatchlist.map((stock) => {
      const symbol = normalizeTicker(String(stock.symbol ?? ''));
      return {
        symbol,
        name: String(stock.name ?? symbol).trim() || symbol,
        sector: String(stock.sector ?? 'Unassigned').trim() || 'Unassigned',
        thesis: String(stock.thesis ?? '').trim(),
        status:
          stock.status === 'sealed' || stock.status === 'no_action' || stock.status === 'active'
            ? stock.status
            : 'active',
      };
    }).filter((stock) => stock.symbol.length > 0),
    settings: {
      entryBufferPercent: clamp(
        rawSettings.entryBufferPercent ?? DEFAULT_SETTINGS.entryBufferPercent,
        0.1,
        20,
      ),
      addDiscountPercent: clamp(
        rawSettings.addDiscountPercent ?? DEFAULT_SETTINGS.addDiscountPercent,
        0.1,
        40,
      ),
      resistanceBufferPercent: clamp(
        rawSettings.resistanceBufferPercent ?? DEFAULT_SETTINGS.resistanceBufferPercent,
        0.1,
        20,
      ),
      minimumCandles: Math.floor(
        clamp(rawSettings.minimumCandles ?? DEFAULT_SETTINGS.minimumCandles, 20, 250),
      ),
    },
    lastSavedAt: state.lastSavedAt,
  };
}

function createRecommendation(
  stock: WatchStock,
  action: RecommendationAction,
  confidence: number,
  reasons: string[],
  blockers: string[],
  warnings: string[],
  levels: TechnicalLevels | null,
): Recommendation {
  return {
    symbol: stock.symbol,
    action,
    label: ACTION_LABELS[action],
    confidence,
    reasons,
    blockers,
    warnings,
    levels,
  };
}

function sortCandles(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.date.localeCompare(b.date));
}

function findSupport(candles: Candle[], currentPrice: number): number | null {
  const swingLows = candles
    .slice(2, -2)
    .filter((candle, index) => {
      const i = index + 2;
      return (
        candle.low <= candles[i - 1].low &&
        candle.low <= candles[i - 2].low &&
        candle.low <= candles[i + 1].low &&
        candle.low <= candles[i + 2].low
      );
    })
    .map((candle) => candle.low)
    .filter((low) => low <= currentPrice * 1.01)
    .sort((a, b) => b - a);

  if (swingLows[0] !== undefined) {
    return roundMoney(swingLows[0]);
  }

  const low = Math.min(...candles.map((candle) => candle.low));
  return Number.isFinite(low) ? roundMoney(low) : null;
}

function findResistance(candles: Candle[], currentPrice: number): number | null {
  const swingHighs = candles
    .slice(2, -2)
    .filter((candle, index) => {
      const i = index + 2;
      return (
        candle.high >= candles[i - 1].high &&
        candle.high >= candles[i - 2].high &&
        candle.high >= candles[i + 1].high &&
        candle.high >= candles[i + 2].high
      );
    })
    .map((candle) => candle.high)
    .filter((high) => high >= currentPrice * 0.99)
    .sort((a, b) => a - b);

  if (swingHighs[0] !== undefined) {
    return roundMoney(swingHighs[0]);
  }

  const high = Math.max(...candles.map((candle) => candle.high));
  return Number.isFinite(high) ? roundMoney(high) : null;
}

function calculateVolumeSignal(candles: Candle[]): TechnicalLevels['volumeSignal'] {
  if (candles.length < 25) {
    return 'neutral';
  }

  const lastFive = average(candles.slice(-5).map((candle) => candle.volume));
  const previousTwenty = average(candles.slice(-25, -5).map((candle) => candle.volume));
  const latestClose = candles[candles.length - 1]?.close ?? 0;
  const closeFiveDaysAgo = candles[candles.length - 6]?.close ?? latestClose;

  if (latestClose < closeFiveDaysAgo && lastFive < previousTwenty * 0.85) {
    return 'weakening_selling';
  }

  if (lastFive > previousTwenty * 1.25) {
    return 'expanding';
  }

  return 'neutral';
}

function isNearSupport(levels: TechnicalLevels, entryBufferPercent: number): boolean {
  if (levels.support === null) {
    return false;
  }

  return levels.currentPrice <= levels.support * (1 + entryBufferPercent / 100);
}

function isAddWatchZone(levels: TechnicalLevels, addDiscountPercent: number): boolean {
  if (levels.support === null) {
    return false;
  }

  return levels.currentPrice <= levels.support * (1 - addDiscountPercent / 100);
}

function isBelowRelevantAverage(levels: TechnicalLevels): boolean {
  const averages = [levels.ma60, levels.ma120, levels.ma250].filter(
    (value): value is number => value !== null,
  );

  return averages.some((averageValue) => levels.currentPrice <= averageValue * 1.02);
}

function isNearResistance(levels: TechnicalLevels, resistanceBufferPercent: number): boolean {
  if (levels.resistance === null) {
    return false;
  }

  return levels.currentPrice >= levels.resistance * (1 - resistanceBufferPercent / 100);
}

function calculateSignalConfidence(
  levels: TechnicalLevels,
  nearSupport: boolean,
  belowMediumAverage: boolean,
): number {
  let confidence = 0.45;

  if (nearSupport) {
    confidence += 0.22;
  }

  if (belowMediumAverage) {
    confidence += 0.16;
  }

  if (levels.volumeSignal === 'weakening_selling') {
    confidence += 0.12;
  }

  return roundMoney(Math.min(confidence, 0.92));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
