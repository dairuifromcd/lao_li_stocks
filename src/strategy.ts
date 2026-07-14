import type {
  AppState,
  AppliedObservationLevel,
  Candle,
  ConditionCheck,
  DataQuality,
  ManualObservationLevel,
  ManualObservationLevels,
  MarketDataMap,
  ObservationLevelKind,
  Recommendation,
  RecommendationAction,
  RecommendationContext,
  SignalSummary,
  StrategySettings,
  TechnicalLevels,
  WatchStock,
  WeeklyDataMap,
  EarningsCalendarCache,
} from './types';
import { buildRecommendationContext } from './marketContext';
import { formatCurrency, normalizeTicker, roundMoney } from './utils';

const ACTION_LABELS: Record<RecommendationAction, string> = {
  technical_ready: '技术条件满足',
  approaching: '接近低位观察区',
  waiting_confirmation: '等待技术确认',
  breakdown: '结构失效，等待收复',
  pressure_watch: '进入压力观察区',
  hold: '继续观察',
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
  resistanceBufferPercent: 2,
  minimumCandles: 60,
};

interface PriceCluster {
  price: number;
  touches: number;
}

interface SwingPoint {
  price: number;
  candleIndex: number;
}

interface SupportEvaluation {
  checks: ConditionCheck[];
  confirmationCount: number;
  invalidationPrice: number | null;
  roomRatio: number | null;
  dataQuality: DataQuality;
}

export function calculateMovingAverage(candles: Candle[], windowSize: number): number | null {
  if (candles.length < windowSize) {
    return null;
  }

  const slice = candles.slice(-windowSize);
  return roundMoney(slice.reduce((sum, candle) => sum + candle.close, 0) / windowSize);
}

export function calculateTechnicalLevels(candles: Candle[]): TechnicalLevels | null {
  const sortedCandles = sortCandles(candles);
  const latest = sortedCandles[sortedCandles.length - 1];

  if (!latest) {
    return null;
  }

  const recentCandles = sortedCandles.slice(-90);
  const currentPrice = latest.close;
  const lowClusters = clusterPriceLevels(findSwingLevels(recentCandles, 'low'));
  const highClusters = clusterPriceLevels(findSwingLevels(recentCandles, 'high'));
  const validSupports = lowClusters
    .filter((cluster) => cluster.price <= currentPrice)
    .sort((a, b) => b.price - a.price);
  const supportCluster = validSupports[0] ?? null;
  const deepSupportCluster = supportCluster
    ? validSupports.find((cluster) => cluster.price < supportCluster.price * 0.96) ?? null
    : null;
  const brokenSupportCluster = lowClusters
    .filter((cluster) => cluster.price > currentPrice && cluster.price <= currentPrice * 1.12)
    .sort((a, b) => a.price - b.price)[0] ?? null;
  const swingResistanceCluster = highClusters
    .filter((cluster) => cluster.price >= currentPrice)
    .sort((a, b) => a.price - b.price)[0] ?? null;
  const resistanceCandidate = [
    brokenSupportCluster
      ? { cluster: brokenSupportCluster, kind: 'broken_support' as const }
      : null,
    swingResistanceCluster
      ? { cluster: swingResistanceCluster, kind: 'swing_high' as const }
      : null,
  ]
    .filter(
      (candidate): candidate is { cluster: PriceCluster; kind: 'broken_support' | 'swing_high' } =>
        candidate !== null,
    )
    .sort((a, b) => a.cluster.price - b.cluster.price)[0] ?? null;
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
    support: supportCluster?.price ?? null,
    deepSupport: deepSupportCluster?.price ?? null,
    resistance: resistanceCandidate?.cluster.price ?? null,
    brokenSupport: brokenSupportCluster?.price ?? null,
    supportTouchCount: supportCluster?.touches ?? 0,
    deepSupportTouchCount: deepSupportCluster?.touches ?? 0,
    resistanceTouchCount: resistanceCandidate?.cluster.touches ?? 0,
    resistanceKind: resistanceCandidate?.kind ?? null,
    atr14: calculateAtr(sortedCandles, 14),
    ma60Trend: calculateMovingAverageTrend(sortedCandles, 60),
    priceStabilized: calculatePriceStabilization(sortedCandles),
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
  weeklyData: WeeklyDataMap = {},
  earningsCalendar: EarningsCalendarCache | null = null,
): Recommendation[] {
  return state.watchlist.map((stock) => {
    const record = marketData[stock.symbol];
    const levels = record ? calculateTechnicalLevels(record.candles) : null;
    const context = buildRecommendationContext(
      stock,
      marketData,
      weeklyData,
      earningsCalendar,
    );
    return generateRecommendation(
      stock,
      state.settings,
      levels,
      record?.refreshedAt,
      context,
    );
  });
}

export function generateRecommendation(
  stock: WatchStock,
  settings: StrategySettings,
  levels: TechnicalLevels | null,
  refreshedAt?: string,
  context: RecommendationContext = {},
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
      reasons,
      blockers,
      warnings,
      null,
      null,
      manualLevelCount,
      unavailableConditions('没有可用行情数据', context, ''),
      0,
      null,
      null,
      'unavailable',
      context,
    );
  }

  const missingIndicators = effectiveInsufficientData(levels, context);
  if (missingIndicators.length > 0) {
    warnings.push(`指标数据不足：${missingIndicators.join(', ')}`);
  }
  if (
    context.weeklyTrend?.ma40 !== null
    && context.weeklyTrend?.ma40 !== undefined
    && levels.insufficientData.some((indicator) => indicator === 'MA120' || indicator === 'MA250')
  ) {
    reasons.push(`长期参考使用复权周线 MA40 ${formatCurrency(context.weeklyTrend.ma40)}`);
  }
  if (levels.candleCount < settings.minimumCandles) {
    warnings.push(`K线数量少于最低要求：${levels.candleCount}/${settings.minimumCandles}`);
  }
  if (!refreshedAt) {
    warnings.push('行情刷新时间未知');
  }
  appendEarningsReason(reasons, warnings, context, levels.tradingDate);

  if (stock.status === 'sealed' || stock.status === 'no_action') {
    blockers.push(stock.status === 'sealed' ? '该股票已暂停跟踪' : '该股票设置为仅显示行情');
    return createRecommendation(
      stock,
      'hold',
      reasons,
      blockers,
      warnings,
      levels,
      null,
      manualLevelCount,
      unavailableConditions('当前股票未启用策略判定', context, levels.tradingDate),
      0,
      null,
      null,
      determineDataQuality(levels, settings, refreshedAt, context),
      context,
    );
  }

  const manualCandidates = buildManualCandidates(stock.manualLevels, levels, warnings);
  const automaticCandidates = buildAutomaticCandidates(stock.manualLevels, levels);
  const manualMatch = findMatchingLevel(manualCandidates, levels.currentPrice, settings);
  const automaticMatch = manualMatch
    ? null
    : findMatchingLevel(automaticCandidates, levels.currentPrice, settings);
  const matchedLevel = manualMatch ?? automaticMatch;

  if (matchedLevel?.kind === 'pressure') {
    reasons.push(describeMatchedLevel(matchedLevel));
    if (levels.support !== null) {
      reasons.push(`压力优先；下方自动支撑仍为 ${formatCurrency(levels.support)}`);
    }
    if (levels.resistanceKind === 'broken_support' && matchedLevel.source === 'automatic') {
      reasons.push('该压力来自跌破后的原支撑，需先观察能否有效收复');
    }
    if (levels.volumeSignal === 'expanding_on_rise') {
      reasons.push('上涨日成交量放大，需人工确认突破能否延续');
    }

    return createRecommendation(
      stock,
      'pressure_watch',
      reasons,
      blockers,
      warnings,
      levels,
      matchedLevel,
      manualLevelCount,
      pressureConditions(levels, settings, refreshedAt, matchedLevel, context),
      countConfirmations(levels),
      null,
      null,
      determineDataQuality(levels, settings, refreshedAt, context),
      context,
    );
  }

  if (matchedLevel) {
    reasons.push(describeMatchedLevel(matchedLevel));
    appendManualAuditReason(reasons, matchedLevel);
    const pressureLevel = findRoomPressure(manualCandidates, automaticCandidates, levels.currentPrice);
    const evaluation = evaluateSupportConditions(
      matchedLevel,
      pressureLevel,
      levels,
      settings,
      refreshedAt,
      true,
      context,
    );
    appendConfirmationReasons(reasons, levels, evaluation.confirmationCount);

    if (evaluation.roomRatio !== null) {
      reasons.push(`上方空间与失效风险之比为 ${evaluation.roomRatio.toFixed(2)}`);
    }

    return createRecommendation(
      stock,
      evaluation.checks.every((check) => check.passed)
        ? 'technical_ready'
        : 'waiting_confirmation',
      reasons,
      blockers,
      warnings,
      levels,
      matchedLevel,
      manualLevelCount,
      evaluation.checks,
      evaluation.confirmationCount,
      evaluation.invalidationPrice,
      evaluation.roomRatio,
      evaluation.dataQuality,
      context,
    );
  }

  const supportCandidates = [...manualCandidates, ...automaticCandidates].filter(
    (candidate) => candidate.kind !== 'pressure',
  );
  const brokenLevel = findBrokenLevel(stock.manualLevels, levels);
  if (brokenLevel) {
    reasons.push(`现价低于原支撑 ${formatCurrency(brokenLevel.price)}，该价位不再作为低位支撑`);
    reasons.push('只有收盘重新站回原支撑后，才重新评估技术条件');
    return createRecommendation(
      stock,
      'breakdown',
      reasons,
      blockers,
      warnings,
      levels,
      brokenLevel,
      manualLevelCount,
      breakdownConditions(levels, settings, refreshedAt, brokenLevel, context),
      countConfirmations(levels),
      null,
      null,
      determineDataQuality(levels, settings, refreshedAt, context),
      context,
    );
  }

  const approachingLevel = findApproachingSupport(
    supportCandidates,
    levels.currentPrice,
    settings.entryBufferPercent,
  );

  if (approachingLevel) {
    const pressureLevel = findRoomPressure(manualCandidates, automaticCandidates, levels.currentPrice);
    const evaluation = evaluateSupportConditions(
      approachingLevel,
      pressureLevel,
      levels,
      settings,
      refreshedAt,
      false,
      context,
    );
    reasons.push(`现价正在接近 ${formatCurrency(approachingLevel.price)}，尚未进入观察缓冲区`);
    appendManualAuditReason(reasons, approachingLevel);
    return createRecommendation(
      stock,
      'approaching',
      reasons,
      blockers,
      warnings,
      levels,
      approachingLevel,
      manualLevelCount,
      evaluation.checks,
      evaluation.confirmationCount,
      evaluation.invalidationPrice,
      evaluation.roomRatio,
      evaluation.dataQuality,
      context,
    );
  }

  reasons.push(
    manualLevelCount > 0
      ? '未进入有效的手动观察区；未配置的类别继续使用自动技术参考'
      : '价格未进入经过至少两次测试的自动技术区间',
  );
  return createRecommendation(
    stock,
    'hold',
    reasons,
    blockers,
    warnings,
    levels,
    null,
    manualLevelCount,
    neutralConditions(levels, settings, refreshedAt, context),
    countConfirmations(levels),
    null,
    null,
    determineDataQuality(levels, settings, refreshedAt, context),
    context,
  );
}

export function buildSignalSummary(recommendations: Recommendation[]): SignalSummary {
  return {
    trackedCount: recommendations.length,
    reviewCount: recommendations.filter((item) => item.action !== 'hold').length,
    readyCount: recommendations.filter((item) => item.action === 'technical_ready').length,
    waitingCount: recommendations.filter(
      (item) => item.action === 'approaching' || item.action === 'waiting_confirmation',
    ).length,
    riskCount: recommendations.filter(
      (item) => item.action === 'breakdown' || item.action === 'pressure_watch',
    ).length,
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
  reasons: string[],
  blockers: string[],
  warnings: string[],
  levels: TechnicalLevels | null,
  triggeredLevel: AppliedObservationLevel | null,
  manualLevelCount: number,
  conditionChecks: ConditionCheck[],
  confirmationCount: number,
  invalidationPrice: number | null,
  roomRatio: number | null,
  dataQuality: DataQuality,
  context: RecommendationContext,
): Recommendation {
  return {
    symbol: stock.symbol,
    action,
    label: ACTION_LABELS[action],
    reasons,
    blockers,
    warnings,
    levels,
    triggeredLevel,
    manualLevelCount,
    conditionChecks,
    confirmationCount,
    invalidationPrice,
    roomRatio,
    dataQuality,
    weeklyTrend: context.weeklyTrend ?? null,
    marketEnvironment: context.marketEnvironment ?? null,
    nextEarnings: context.nextEarnings ?? null,
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

    return [{
      kind,
      price: level.price,
      source: 'manual',
      basis: level.basis,
      timeframe: level.timeframe,
      confirmedAt: level.confirmedAt,
      invalidationPrice: level.invalidationPrice,
    }];
  });
}

function buildAutomaticCandidates(
  manualLevels: ManualObservationLevels | undefined,
  levels: TechnicalLevels,
): AppliedObservationLevel[] {
  const candidates: AppliedObservationLevel[] = [];

  if (!manualLevels?.pressure && levels.resistance !== null) {
    candidates.push({
      kind: 'pressure',
      price: levels.resistance,
      source: 'automatic',
      basis:
        levels.resistanceKind === 'broken_support'
          ? '跌破后转为压力的原支撑'
          : '近90个交易日内至少两次独立测试的摆动高点',
      touchCount: levels.resistanceTouchCount,
    });
  }
  if (!manualLevels?.deep && levels.deepSupport !== null) {
    candidates.push({
      kind: 'deep',
      price: levels.deepSupport,
      source: 'automatic',
      basis: '第一支撑下方、至少两次独立测试的下一层摆动低点',
      touchCount: levels.deepSupportTouchCount,
    });
  }
  if (!manualLevels?.low && levels.support !== null) {
    candidates.push({
      kind: 'low',
      price: levels.support,
      source: 'automatic',
      basis: '近90个交易日内至少两次独立测试的摆动低点',
      touchCount: levels.supportTouchCount,
    });
  }

  return candidates;
}

function findMatchingLevel(
  candidates: AppliedObservationLevel[],
  currentPrice: number,
  settings: StrategySettings,
): AppliedObservationLevel | null {
  return candidates
    .filter((candidate) => {
      if (candidate.kind === 'pressure') {
        return currentPrice <= candidate.price
          && distancePercent(currentPrice, candidate.price) <= settings.resistanceBufferPercent;
      }
      return currentPrice >= candidate.price
        && distancePercent(currentPrice, candidate.price) <= settings.entryBufferPercent;
    })
    .sort((a, b) => {
      const priorityDifference = LEVEL_PRIORITY[b.kind] - LEVEL_PRIORITY[a.kind];
      return priorityDifference !== 0
        ? priorityDifference
        : distancePercent(currentPrice, a.price) - distancePercent(currentPrice, b.price);
    })[0] ?? null;
}

function findApproachingSupport(
  candidates: AppliedObservationLevel[],
  currentPrice: number,
  bufferPercent: number,
): AppliedObservationLevel | null {
  return candidates
    .filter((candidate) => {
      const distance = distancePercent(currentPrice, candidate.price);
      return currentPrice > candidate.price && distance > bufferPercent && distance <= bufferPercent * 2;
    })
    .sort((a, b) => distancePercent(currentPrice, a.price) - distancePercent(currentPrice, b.price))[0]
    ?? null;
}

function findRoomPressure(
  manualCandidates: AppliedObservationLevel[],
  automaticCandidates: AppliedObservationLevel[],
  currentPrice: number,
): AppliedObservationLevel | null {
  const manualPressure = manualCandidates
    .filter((candidate) => candidate.kind === 'pressure' && candidate.price > currentPrice)
    .sort((a, b) => a.price - b.price)[0];
  if (manualPressure) {
    return manualPressure;
  }
  return automaticCandidates
    .filter((candidate) => candidate.kind === 'pressure' && candidate.price > currentPrice)
    .sort((a, b) => a.price - b.price)[0] ?? null;
}

function findBrokenLevel(
  manualLevels: ManualObservationLevels | undefined,
  levels: TechnicalLevels,
): AppliedObservationLevel | null {
  const manualBroken = (['low', 'deep'] as ObservationLevelKind[])
    .flatMap((kind) => {
      const level = manualLevels?.[kind];
      if (!level || !isInvalidationDirectionValid(kind, level)) {
        return [];
      }
      return [{
        kind,
        price: level.price,
        source: 'manual' as const,
        basis: level.basis,
        timeframe: level.timeframe,
        confirmedAt: level.confirmedAt,
        invalidationPrice: level.invalidationPrice,
      }];
    })
    .filter(
      (candidate) =>
        candidate.price > levels.currentPrice && candidate.price <= levels.currentPrice * 1.12,
    )
    .sort((a, b) => a.price - b.price)[0];

  if (manualBroken) {
    return manualBroken;
  }
  return levels.brokenSupport === null
    ? null
    : {
        kind: 'low',
        price: levels.brokenSupport,
        source: 'automatic',
        basis: '近90个交易日内至少两次测试、现已跌破的原支撑',
        touchCount: levels.resistanceKind === 'broken_support'
          ? levels.resistanceTouchCount
          : undefined,
      };
}

function evaluateSupportConditions(
  supportLevel: AppliedObservationLevel,
  pressureLevel: AppliedObservationLevel | null,
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  inObservationZone: boolean,
  context: RecommendationContext,
): SupportEvaluation {
  const dataCheck = dataCondition(levels, settings, refreshedAt, context);
  const levelPassed = supportLevel.source === 'manual' || (supportLevel.touchCount ?? 0) >= 2;
  const confirmationCount = countConfirmations(levels);
  const invalidationPrice = calculateInvalidationPrice(supportLevel, levels, settings);
  const roomRatio = calculateRoomRatio(levels.currentPrice, pressureLevel?.price, invalidationPrice);

  return {
    checks: [
      dataCheck,
      {
        key: 'level',
        label: '有效支撑',
        passed: levelPassed,
        detail: supportLevel.source === 'manual'
          ? `手动价位 ${formatCurrency(supportLevel.price)}`
          : `${formatCurrency(supportLevel.price)}，测试 ${supportLevel.touchCount ?? 0} 次`,
      },
      {
        key: 'location',
        label: '位于观察区',
        passed: inObservationZone,
        detail: inObservationZone
          ? `现价在支撑上方 ${distancePercent(levels.currentPrice, supportLevel.price).toFixed(2)}%`
          : `尚未进入 ${settings.entryBufferPercent}% 缓冲区`,
      },
      {
        key: 'confirmation',
        label: '至少两项确认',
        passed: confirmationCount >= 2,
        detail: `${confirmationCount}/3：止跌、量能、MA60`,
      },
      marketCondition(context),
      eventCondition(context, levels.tradingDate),
      {
        key: 'room',
        label: '空间比至少 2',
        passed: roomRatio !== null && roomRatio >= 2,
        detail: roomRatio === null
          ? '缺少上方压力或有效失效价'
          : `${roomRatio.toFixed(2)}（上方空间/失效风险）`,
      },
    ],
    confirmationCount,
    invalidationPrice,
    roomRatio,
    dataQuality: determineDataQuality(levels, settings, refreshedAt, context),
  };
}

function pressureConditions(
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  pressureLevel: AppliedObservationLevel,
  context: RecommendationContext,
): ConditionCheck[] {
  return [
    dataCondition(levels, settings, refreshedAt, context),
    {
      key: 'level',
      label: '有效支撑',
      passed: false,
      detail: levels.support === null
        ? '当前评估的是上方压力，尚无低位支撑'
        : `压力优先；下方仍有支撑 ${formatCurrency(levels.support)}`,
    },
    {
      key: 'location',
      label: '位于观察区',
      passed: false,
      detail: `现价接近压力 ${formatCurrency(pressureLevel.price)}`,
    },
    {
      key: 'confirmation',
      label: '至少两项确认',
      passed: countConfirmations(levels) >= 2,
      detail: `${countConfirmations(levels)}/3：止跌、量能、MA60`,
    },
    marketCondition(context),
    eventCondition(context, levels.tradingDate),
    { key: 'room', label: '空间比至少 2', passed: false, detail: '压力区不评估低位空间比' },
  ];
}

function breakdownConditions(
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  brokenLevel: AppliedObservationLevel,
  context: RecommendationContext,
): ConditionCheck[] {
  return [
    dataCondition(levels, settings, refreshedAt, context),
    {
      key: 'level',
      label: '有效支撑',
      passed: false,
      detail: `${formatCurrency(brokenLevel.price)} 已在现价上方，转为待收复压力`,
    },
    { key: 'location', label: '位于观察区', passed: false, detail: '现价处于原支撑下方' },
    {
      key: 'confirmation',
      label: '至少两项确认',
      passed: countConfirmations(levels) >= 2,
      detail: `${countConfirmations(levels)}/3：止跌、量能、MA60`,
    },
    marketCondition(context),
    eventCondition(context, levels.tradingDate),
    { key: 'room', label: '空间比至少 2', passed: false, detail: '结构收复前不评估空间比' },
  ];
}

function neutralConditions(
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  context: RecommendationContext,
): ConditionCheck[] {
  return [
    dataCondition(levels, settings, refreshedAt, context),
    {
      key: 'level',
      label: '有效支撑',
      passed: levels.support !== null && levels.supportTouchCount >= 2,
      detail: levels.support === null
        ? '近90个交易日没有至少两次测试的支撑'
        : `${formatCurrency(levels.support)}，测试 ${levels.supportTouchCount} 次`,
    },
    { key: 'location', label: '位于观察区', passed: false, detail: '现价未进入有效支撑缓冲区' },
    {
      key: 'confirmation',
      label: '至少两项确认',
      passed: countConfirmations(levels) >= 2,
      detail: `${countConfirmations(levels)}/3：止跌、量能、MA60`,
    },
    marketCondition(context),
    eventCondition(context, levels.tradingDate),
    { key: 'room', label: '空间比至少 2', passed: false, detail: '进入观察区后计算' },
  ];
}

function unavailableConditions(
  detail: string,
  context: RecommendationContext,
  tradingDate: string,
): ConditionCheck[] {
  return [
    { key: 'data', label: '核心数据可用', passed: false, detail },
    { key: 'level', label: '有效支撑', passed: false, detail: '无法评估' },
    { key: 'location', label: '位于观察区', passed: false, detail: '无法评估' },
    { key: 'confirmation', label: '至少两项确认', passed: false, detail: '无法评估' },
    marketCondition(context),
    eventCondition(context, tradingDate),
    { key: 'room', label: '空间比至少 2', passed: false, detail: '无法评估' },
  ];
}

function dataCondition(
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  context: RecommendationContext,
): ConditionCheck {
  const passed = isDataReliable(levels, settings, refreshedAt, context);
  const weeklyUnavailable = context.weeklyTrend !== undefined
    && context.weeklyTrend.ma40 === null;
  return {
    key: 'data',
    label: '核心数据可用',
    passed,
    detail: passed
      ? dataDetail(levels, context)
      : weeklyUnavailable
        ? '缺少至少 40 根已完成的复权周线'
        : `需要至少 ${settings.minimumCandles} 根日线、MA60 和刷新时间`,
  };
}

function isDataReliable(
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  context: RecommendationContext = {},
): boolean {
  const dailyReliable = levels.candleCount >= settings.minimumCandles
    && levels.ma60 !== null
    && Boolean(refreshedAt);
  const weeklyReliable = context.weeklyTrend === undefined || context.weeklyTrend.ma40 !== null;
  return dailyReliable && weeklyReliable;
}

function determineDataQuality(
  levels: TechnicalLevels,
  settings: StrategySettings,
  refreshedAt: string | undefined,
  context: RecommendationContext,
): DataQuality {
  if (!isDataReliable(levels, settings, refreshedAt, context)) {
    return 'unavailable';
  }
  return effectiveInsufficientData(levels, context).length === 0 ? 'complete' : 'limited';
}

function marketCondition(context: RecommendationContext): ConditionCheck {
  if (!context.marketEnvironment) {
    return {
      key: 'market',
      label: '市场环境',
      passed: true,
      detail: '未提供市场环境上下文',
    };
  }
  return {
    key: 'market',
    label: '市场环境',
    passed: context.marketEnvironment.passed,
    detail: context.marketEnvironment.detail,
  };
}

function eventCondition(
  context: RecommendationContext,
  tradingDate: string,
): ConditionCheck {
  if (context.earningsCalendarAvailable === undefined) {
    return { key: 'event', label: '事件风险', passed: true, detail: '未提供财报日历上下文' };
  }
  if (!context.earningsCalendarAvailable) {
    return { key: 'event', label: '事件风险', passed: false, detail: '财报日历尚未加载' };
  }
  if (!context.nextEarnings) {
    return { key: 'event', label: '事件风险', passed: true, detail: '未来 7 天无已知财报' };
  }
  const days = daysUntil(tradingDate, context.nextEarnings.reportDate);
  const passed = days !== null && days > 7;
  return {
    key: 'event',
    label: '事件风险',
    passed,
    detail: days === null
      ? `下一财报 ${context.nextEarnings.reportDate}`
      : `${days} 天后财报（${context.nextEarnings.reportDate}）`,
  };
}

function effectiveInsufficientData(
  levels: TechnicalLevels,
  context: RecommendationContext,
): string[] {
  const hasLongTermWeeklyReference = context.weeklyTrend?.ma40 !== null
    && context.weeklyTrend?.ma40 !== undefined;
  return levels.insufficientData.filter(
    (indicator) => !hasLongTermWeeklyReference || (indicator !== 'MA120' && indicator !== 'MA250'),
  );
}

function dataDetail(levels: TechnicalLevels, context: RecommendationContext): string {
  const weeklyDetail = context.weeklyTrend?.ma40 === null
    || context.weeklyTrend?.ma40 === undefined
    ? ''
    : `；复权周线 MA40 ${formatCurrency(context.weeklyTrend.ma40)}`;
  return `${levels.candleCount} 根日线，最近交易日 ${levels.tradingDate}${weeklyDetail}`;
}

function appendEarningsReason(
  reasons: string[],
  warnings: string[],
  context: RecommendationContext,
  tradingDate: string,
): void {
  if (!context.nextEarnings) {
    return;
  }
  const days = daysUntil(tradingDate, context.nextEarnings.reportDate);
  reasons.push(`下一次已知财报日期 ${context.nextEarnings.reportDate}`);
  if (days !== null && days <= 7) {
    warnings.push(`距离财报仅 ${days} 天，事件风险条件未通过`);
  }
}

function daysUntil(fromDate: string, toDate: string): number | null {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return Math.ceil((to - from) / (24 * 60 * 60 * 1000));
}

function calculateInvalidationPrice(
  supportLevel: AppliedObservationLevel,
  levels: TechnicalLevels,
  settings: StrategySettings,
): number | null {
  if (supportLevel.invalidationPrice !== undefined) {
    return supportLevel.invalidationPrice < levels.currentPrice
      ? supportLevel.invalidationPrice
      : null;
  }

  const fallbackDistance = levels.atr14 ?? supportLevel.price * settings.entryBufferPercent / 100;
  const invalidation = roundMoney(supportLevel.price - fallbackDistance);
  return invalidation > 0 && invalidation < levels.currentPrice ? invalidation : null;
}

function calculateRoomRatio(
  currentPrice: number,
  resistance: number | undefined,
  invalidationPrice: number | null,
): number | null {
  if (resistance === undefined || resistance <= currentPrice || invalidationPrice === null) {
    return null;
  }
  const risk = currentPrice - invalidationPrice;
  return risk > 0 ? (resistance - currentPrice) / risk : null;
}

function countConfirmations(levels: TechnicalLevels): number {
  const volumeConfirmed =
    levels.volumeSignal === 'weakening_selling' || levels.volumeSignal === 'expanding_on_rise';
  const averageConfirmed =
    levels.ma60 !== null
    && (levels.currentPrice >= levels.ma60
      || levels.ma60Trend === 'rising'
      || levels.ma60Trend === 'flat');
  return [levels.priceStabilized, volumeConfirmed, averageConfirmed].filter(Boolean).length;
}

function appendConfirmationReasons(
  reasons: string[],
  levels: TechnicalLevels,
  confirmationCount: number,
): void {
  if (levels.priceStabilized) {
    reasons.push('最新交易日收高且未再创新低，出现初步止跌');
  }
  if (levels.volumeSignal === 'weakening_selling') {
    reasons.push('下跌段成交量收缩，抛压可能减弱');
  }
  if (levels.volumeSignal === 'expanding_on_rise') {
    reasons.push('上涨日成交量高于近期均量，量价方向一致');
  }
  if (confirmationCount < 2) {
    reasons.push('止跌、量能、MA60 三项确认尚未达到两项');
  }
}

function describeMatchedLevel(level: AppliedObservationLevel): string {
  return `价格进入${level.source === 'manual' ? '手动设置的' : '自动识别的'}${LEVEL_LABELS[level.kind]} ${formatCurrency(level.price)}；价位依据：${level.basis}`;
}

function appendManualAuditReason(reasons: string[], level: AppliedObservationLevel): void {
  if (level.source !== 'manual' || !level.timeframe) {
    return;
  }
  const timeframe = level.timeframe === 'weekly' ? '周线' : '日线';
  reasons.push(
    level.confirmedAt
      ? `${timeframe}价位，确认于 ${level.confirmedAt}`
      : `${timeframe}价位，尚未填写确认日期`,
  );
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

function sortCandles(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.date.localeCompare(b.date));
}

function findSwingLevels(candles: Candle[], kind: 'low' | 'high'): SwingPoint[] {
  return candles.slice(2, -2).flatMap((candle, index) => {
    const i = index + 2;
    const value = kind === 'low' ? candle.low : candle.high;
    const surrounding = [candles[i - 2], candles[i - 1], candles[i + 1], candles[i + 2]]
      .map((item) => kind === 'low' ? item.low : item.high);
    const isSwing = kind === 'low'
      ? surrounding.every((other) => value <= other)
      : surrounding.every((other) => value >= other);
    return isSwing ? [{ price: value, candleIndex: i }] : [];
  });
}

function clusterPriceLevels(values: SwingPoint[], tolerancePercent = 1.5): PriceCluster[] {
  const clusters: SwingPoint[][] = [];
  [...values].sort((a, b) => a.price - b.price).forEach((value) => {
    const cluster = clusters.find((items) => {
      const center = average(items.map((item) => item.price));
      return Math.abs(value.price - center) / center * 100 <= tolerancePercent;
    });
    if (cluster) {
      cluster.push(value);
    } else {
      clusters.push([value]);
    }
  });

  return clusters
    .map(selectIndependentTouches)
    .filter((items) => items.length >= 2)
    .map((items) => ({
      price: roundMoney(average(items.map((item) => item.price))),
      touches: items.length,
    }));
}

function selectIndependentTouches(items: SwingPoint[]): SwingPoint[] {
  const accepted: SwingPoint[] = [];
  [...items].sort((a, b) => a.candleIndex - b.candleIndex).forEach((item) => {
    const previous = accepted[accepted.length - 1];
    if (!previous || item.candleIndex - previous.candleIndex >= 10) {
      accepted.push(item);
    }
  });
  return accepted;
}

function calculateAtr(candles: Candle[], windowSize: number): number | null {
  if (candles.length < windowSize + 1) {
    return null;
  }
  const trueRanges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return roundMoney(average(trueRanges.slice(-windowSize)));
}

function calculateMovingAverageTrend(
  candles: Candle[],
  windowSize: number,
): TechnicalLevels['ma60Trend'] {
  if (candles.length < windowSize + 5) {
    return 'unavailable';
  }
  const current = calculateMovingAverage(candles, windowSize);
  const previous = calculateMovingAverage(candles.slice(0, -5), windowSize);
  if (current === null || previous === null) {
    return 'unavailable';
  }
  const changePercent = (current - previous) / previous * 100;
  if (Math.abs(changePercent) <= 0.5) {
    return 'flat';
  }
  return changePercent > 0 ? 'rising' : 'falling';
}

function calculatePriceStabilization(candles: Candle[]): boolean {
  if (candles.length < 6) {
    return false;
  }
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const priorFiveLow = Math.min(...candles.slice(-6, -1).map((candle) => candle.low));
  return latest.close > previous.close && latest.low >= priorFiveLow;
}

function calculateVolumeSignal(candles: Candle[]): TechnicalLevels['volumeSignal'] {
  if (candles.length < 25) {
    return 'neutral';
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const previousTwentyAverage = average(candles.slice(-21, -1).map((candle) => candle.volume));
  const lastFiveAverage = average(candles.slice(-5).map((candle) => candle.volume));
  const comparisonAverage = average(candles.slice(-25, -5).map((candle) => candle.volume));
  const closeFiveDaysAgo = candles[candles.length - 6]?.close ?? latest.close;

  if (latest.close > previous.close && latest.volume > previousTwentyAverage * 1.2) {
    return 'expanding_on_rise';
  }
  if (latest.close < closeFiveDaysAgo && lastFiveAverage < comparisonAverage * 0.85) {
    return 'weakening_selling';
  }
  return 'neutral';
}

function distancePercent(currentPrice: number, levelPrice: number): number {
  return Math.abs(currentPrice - levelPrice) / levelPrice * 100;
}

function positiveNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? roundMoney(numberValue) : null;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
