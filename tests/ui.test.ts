import { beforeEach, describe, expect, it } from 'vitest';
import { initApp } from '../src/app';

describe('strategy dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the local-first MVP dashboard with recommendations', () => {
    const root = document.createElement('div');
    initApp(root, { autoRefresh: false, now: new Date('2026-06-19T00:00:00Z') });

    expect(root.querySelector('[data-testid="hero-title"]')?.textContent).toContain('左侧交易每日观察台');
    expect(root.querySelector('[data-testid="watchlist-form"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="refresh-status"]')?.textContent).toContain('示例');
    expect(root.querySelectorAll('[data-testid="recommendation-card"]').length).toBeGreaterThanOrEqual(3);
    expect(root.textContent).not.toContain('建议金额');
    expect(root.textContent).not.toContain('可用现金');
    expect(root.textContent).not.toContain('仓位');
  });

  it('adds a ticker to the watchlist and persists it locally', () => {
    const root = document.createElement('div');
    initApp(root, { autoRefresh: false, now: new Date('2026-06-19T00:00:00Z') });

    const symbolInput = root.querySelector<HTMLInputElement>('[data-testid="add-stock-symbol"]');
    const form = root.querySelector<HTMLFormElement>('[data-form="add-stock"]');

    expect(symbolInput).not.toBeNull();
    expect(form).not.toBeNull();

    if (!symbolInput || !form) {
      throw new Error('Add stock form did not render');
    }

    symbolInput.value = 'aapl';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(root.textContent).toContain('AAPL');
    expect(localStorage.getItem('lao-li-stocks:v1:state')).toContain('AAPL');
  });
});
