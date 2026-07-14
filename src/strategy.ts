import type {
  AppState,
  AppliedObservationLevel,
  Candle,
  ManualObservationLevel,
  ManualObservationLevels,
  MarketDataMap,
  ObservationLevelKind,
  Recommendation,
  RecommendationAction,
  SignalSummary,
  StrategySettings,
  TechnicalLevels,
  WatchStock,
} from './types';
import { formatCurrency, normalizeTicker, roundMoney } from './utils';

const ACTION_LABELS: Record<RecommendationAction, string> = {
  entry: '进入低位观察区',
  add_watch: '进入深度观察区',
  hold: '继续观察',
  trim_watch: '进入压力观察区',
};

const LEVEL_LABELS: Record<ObservationLevelKind, string> = {
  low: '低位观察区',
  deep: '深度观察区',
  pressure: '压力观察区',
};

const LEVEL_PRIORITY: Record<ObservationLevelKind, number> = {
  low: 1,
  deep: 2,
  pressure: 3,
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
  const [support, deepSupport] = findSupportLevels(recentCandles, currentPrice);
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
    deepSupport,
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
  const manualLevelCount = countManualLevels(stock.manualLevels);

  if (!levels) {
    warnings.push('没有可用行情数据');
    return createRecommendation(
      stock,
      'hold',
      0,
      reasons,
      blockers,
      warnings,
      null,
      null,
      manualLevelCount,
    );
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
    blockers.push('该股票已暂停跟踪');
    return createRecommendation(
      stock,
      'hold',
      0.2,
      reasons,
      blockers,
      warnings,
      levels,
      null,
      manualLevelCount,
    );
  }

  if (stock.status === 'no_action') {
    blockers.push('该股票设置为仅显示行情');
    return createRecommendation(
      stock,
      'hold',
      0.2,
      reasons,
      blockers,
      warnings,
      levels,
      null,
      manualLevelCount,
    );
  }

  const manualCandidates = buildManualCandidates(stock.manualLevels, levels, warnings);
  const manualMatch = findMatchingLevel(manualCandidates, levels.currentPrice, settings);
  const automaticCandidates = buildAutomaticCandidates(stock.manualLevels, levels, settings);
  const automaticMatch = manualMatch
    ? null
    : findMatchingLevel(automaticCandidates, levels.currentPrice, settings);
  const matchedLevel = manualMatch ?? automaticMatch;

  if (matchedLevel) {
    reasons.push(
      `价格进入${matchedLevel.source === 'manual' ? '手动设置的' : '自动识别的'}${LEVEL_LABELS[matchedLevel.kind]} ${formatCurrency(matchedLevel.price)}`,
    );

    if (matchedLevel.basis) {
      reasons.push(`价位依据：${matchedLevel.basis}`);
    }

    if (matchedLevel.source === 'manual' && matchedLevel.timeframe) {
      const timeframe = matchedLevel.timeframe === 'weekly' ? '周线' : '日线';
      reasons.push(
        matchedLevel.confirmedAt
          ? `${timeframe}价位，确认于 ${matchedLevel.confirmedAt}`
          : `${timeframe}价位，尚未填写确认日期`,
      );
    }

    if (
      matchedLevel.kind !== 'pressure' &&
      levels.volumeSignal === 'weakening_selling'
    ) {
      reasons.push('下跌段成交量收缩，抛压可能减弱');
    }

    if (matchedLevel.kind === 'pressure' && levels.volumeSignal === 'expanding') {
      reasons.push('压力区附近成交量放大，需要人工复核突破有效性');
    }

    return createRecommendation(
      stock,
      actionForLevel(matchedLevel.kind),
      calculateSignalConfidence(matchedLevel, levels, warnings),
      reasons,
      blockers,
      warnings,
      levels,
      matchedLevel,
      manualLevelCount,
    );
  }

  reasons.push(
    manualLevelCount > 0
      ? '未进入有效的手动观察区；未配置的类别继续使用自动技术参考'
      : '价格未进入自动识别的技术区间',
  );
  return createRecommendation(
    stock,
    'hold',
    0.42,
    reasons,
    blockers,
    warnings,
    levels,
    null,
    manualLevelCount,
  );
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
    watchlist: rawWatchlist
      .map((stock) => {
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
          manualLevels: sanitizeManualLevels(stock.manualLevels),
        };
      })
      .filter((stock) => stock.symbol.length > 0),
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
  triggeredLevel: AppliedObservationLevel | null,
  manualLevelCount: number,
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
    triggeredLevel,
    manualLevelCount,
  };
}

function sanitizeManualLevels(value: unknown): ManualObservationLevels {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const raw = value as Partial<Record<ObservationLevelKind, unknown>>;
  const levels: ManualObservationLevels = {};

  (['low', 'deep', 'pressure'] as ObservationLevelKind[]).forEach((kind) => {
    const level = sanitizeManualLevel(raw[kind]);
    if (level) {
      levels[kind] = level;
    }
  });

  return levels;
}

function sanitizeManualLevel(value: unknown): ManualObservationLevel | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<ManualObservationLevel>;
  const price = positiveNumber(raw.price);
  if (price === null) {
    return null;
  }

  const invalidationPrice = positiveNumber(raw.invalidationPrice);
  const confirmedAt = String(raw.confirmedAt ?? '').trim();

  return {
    price,
    basis: String(raw.basis ?? '').trim(),
    timeframe: raw.timeframe === 'weekly' ? 'weekly' : 'daily',
    ...(invalidationPrice === null ? {} : { invalidationPrice }),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(confirmedAt) ? { confirmedAt } : {}),
  };
}

function countManualLevels(levels: ManualObservationLevels | undefined): number {
  return (['low', 'deep', 'pressure'] as ObservationLevelKind[]).filter(
    (kind) => levels?.[kind],
  ).length;
}

function buildManualCandidates(
  manualLevels: ManualObservationLevels | undefined,
  levels: TechnicalLevels,
  warnings: string[],
): AppliedObservationLevel[] {
  return (['low', 'deep', 'pressure'] as ObservationLevelKind[]).flatMap((kind) => {
    const level = manualLevels?.[kind];
    if (!level) {
      return [];
    }

    if (!level.basis) {
      warnings.push(`${LEVEL_LABELS[kind]}缺少价位依据`);
    }

    if (!isInvalidationDirectionValid(kind, level)) {
      warnings.push(`${LEVEL_LABELS[kind]}的失效价方向不合理，请重新确认`);
      return [];
    }

    if (hasManualLevelInvalidated(kind, level, levels.currentPrice)) {
      warnings.push(
        `${LEVEL_LABELS[kind]} ${formatCurrency(level.price)} 已越过失效价 ${formatCurrency(level.invalidationPrice ?? 0)}，请重新确认`,
      );
      return [];
    }

    return [
      {
        kind,
        price: level.price,
        source: 'manual',
        basis: level.basis,
        timeframe: level.timeframe,
        confirmedAt: level.confirmedAt,
      },
    ];
  });
}

function buildAutomaticCandidates(
  manualLevels: ManualObservationLevels | undefined,
  levels: TechnicalLevels,
  settings: StrategySettings,
): AppliedObservationLevel[] {
  const candidates: AppliedObservationLevel[] = [];

  if (!manualLevels?.pressure && levels.resistance !== null) {
    candidates.push({
      kind: 'pressure',
      price: levels.resistance,
      source: 'automatic',
      basis: '近90个交易日的摆动高点',
    });
  }

  if (!manualLevels?.deep && levels.support !== null) {
    candidates.push({
      kind: 'deep',
      price:
        levels.deepSupport ??
        roundMoney(levels.support * (1 - settings.addDiscountPercent / 100)),
      source: 'automatic',
      basis: levels.deepSupport
        ? '第一支撑下方的下一层摆动低点'
        : `第一支撑下方 ${settings.addDiscountPercent}% 的投影参考`,
    });
  }

  if (!manualLevels?.low) {
    if (levels.support !== null) {
      candidates.push({
        kind: 'low',
        price: levels.support,
        source: 'automatic',
        basis: '近90个交易日的摆动低点',
      });
    }

    const averages: Array<[string, number | null]> = [
      ['MA60', levels.ma60],
      ['MA120', levels.ma120],
      ['MA250', levels.ma250],
    ];
    averages.forEach(([label, price]) => {
      if (price !== null) {
        candidates.push({
          kind: 'low',
          price,
          source: 'automatic',
          basis: `${label} 中长期均线`,
        });
      }
    });
  }

  return candidates;
}

function findMatchingLevel(
  candidates: AppliedObservationLevel[],
  currentPrice: number,
  settings: StrategySettings,
): AppliedObservationLevel | null {
  return (
    candidates
      .filter((candidate) => {
        const buffer =
          candidate.kind === 'pressure'
            ? settings.resistanceBufferPercent
            : settings.entryBufferPercent;
        return isWithinBuffer(currentPrice, candidate.price, buffer);
      })
      .sort((a, b) => {
        const priorityDifference = LEVEL_PRIORITY[b.kind] - LEVEL_PRIORITY[a.kind];
        if (priorityDifference !== 0) {
          return priorityDifference;
        }
        return distancePercent(currentPrice, a.price) - distancePercent(currentPrice, b.price);
      })[0] ?? null
  );
}

function actionForLevel(kind: ObservationLevelKind): RecommendationAction {
  if (kind === 'pressure') {
    return 'trim_watch';
  }
  if (kind === 'deep') {
    return 'add_watch';
  }
  return 'entry';
}

function isInvalidationDirectionValid(
  kind: ObservationLevelKind,
  level: ManualObservationLevel,
): boolean {
  if (level.invalidationPrice === undefined) {
    return true;
  }
  return kind === 'pressure'
    ? level.invalidationPrice > level.price
    : level.invalidationPrice < level.price;
}

function hasManualLevelInvalidated(
  kind: ObservationLevelKind,
  level: ManualObservationLevel,
  currentPrice: number,
): boolean {
  if (level.invalidationPrice === undefined) {
    return false;
  }
  return kind === 'pressure'
    ? currentPrice > level.invalidationPrice
    : currentPrice < level.invalidationPrice;
}

function isWithinBuffer(currentPrice: number, levelPrice: number, bufferPercent: number): boolean {
  return distancePercent(currentPrice, levelPrice) <= bufferPercent;
}

function distancePercent(currentPrice: number, levelPrice: number): number {
  return Math.abs(currentPrice - levelPrice) / levelPrice * 100;
}

function sortCandles(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.date.localeCompare(b.date));
}

function findSupportLevels(candles: Candle[], currentPrice: number): [number | null, number | null] {
  const swingLows = distinctLevels(
    candles
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
      .map((candle) => candle.low),
  );

  const nearbyBrokenSupport = swingLows
    .filter((low) => low > currentPrice && low <= currentPrice * 1.12)
    .sort((a, b) => a - b)[0];
  const nearestLowerSupport = swingLows
    .filter((low) => low <= currentPrice * 1.01)
    .sort((a, b) => b - a)[0];
  const fallbackLow = Math.min(...candles.map((candle) => candle.low));
  const support = nearbyBrokenSupport ?? nearestLowerSupport ?? fallbackLow;

  if (!Number.isFinite(support)) {
    return [null, null];
  }

  const deepSupport = swingLows
    .filter((low) => low < support * 0.95)
    .sort((a, b) => b - a)[0];

  return [
    roundMoney(support),
    deepSupport === undefined ? null : roundMoney(deepSupport),
  ];
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

function distinctLevels(values: number[]): number[] {
  return [...values]
    .sort((a, b) => b - a)
    .filter((value, index, sorted) => {
      const previous = sorted[index - 1];
      return previous === undefined || Math.abs(previous - value) / previous >= 0.02;
    });
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

function calculateSignalConfidence(
  matchedLevel: AppliedObservationLevel,
  levels: TechnicalLevels,
  warnings: string[],
): number {
  let confidence = matchedLevel.source === 'manual' ? 0.72 : 0.52;

  if (matchedLevel.source === 'manual' && matchedLevel.basis) {
    confidence += 0.08;
  }

  if (matchedLevel.kind !== 'pressure' && levels.volumeSignal === 'weakening_selling') {
    confidence += 0.1;
  }

  if (matchedLevel.kind === 'pressure' && levels.volumeSignal === 'expanding') {
    confidence += 0.06;
  }

  confidence -= Math.min(warnings.length * 0.03, 0.12);
  return roundMoney(Math.min(0.92, Math.max(0.35, confidence)));
}

function positiveNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? roundMoney(numberValue) : null;
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
