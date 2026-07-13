export function roundToInt(value: number): number {
  return Math.round(value);
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${roundMoney(value)}%`;
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return '未刷新';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
