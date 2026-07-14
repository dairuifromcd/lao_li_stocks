import type {
  Recommendation,
  SignalSnapshot,
  StrategySettings,
} from './types';

export function recordSignalSnapshot(
  history: SignalSnapshot[],
  recommendations: Recommendation[],
  settings: StrategySettings,
  now = new Date(),
): SignalSnapshot[] {
  const tradingDates = recommendations
    .map((recommendation) => recommendation.levels?.tradingDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  const tradingDate = tradingDates[tradingDates.length - 1];
  if (!tradingDate) {
    return history;
  }

  const snapshot: SignalSnapshot = {
    tradingDate,
    recordedAt: now.toISOString(),
    settings: { ...settings },
    items: recommendations.map((recommendation) => ({
      symbol: recommendation.symbol,
      action: recommendation.action,
      label: recommendation.label,
      currentPrice: recommendation.levels?.currentPrice ?? null,
      support: recommendation.levels?.support ?? null,
      resistance: recommendation.levels?.resistance ?? null,
      passedConditions: recommendation.conditionChecks.filter((check) => check.passed).length,
      totalConditions: recommendation.conditionChecks.length,
      nextEarningsDate: recommendation.nextEarnings?.reportDate ?? null,
    })),
  };

  return [...history.filter((item) => item.tradingDate !== tradingDate), snapshot]
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))
    .slice(-180);
}
