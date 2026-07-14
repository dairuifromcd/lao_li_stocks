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
    expect(root.querySelector('[data-testid="refresh-status"]')?.textContent).toContain('无行情数据');
    expect(root.querySelectorAll('[data-testid="recommendation-card"]').length).toBeGreaterThanOrEqual(3);
    expect(root.textContent).toContain('未加载行情');
    expect(root.textContent).not.toContain('$224');
    expect(root.textContent).not.toContain('建议金额');
    expect(root.textContent).not.toContain('可用现金');
    expect(root.textContent).not.toContain('仓位');
    expect(root.textContent).not.toContain('封仓');
    expect(root.querySelectorAll('[data-manual-kind]').length).toBe(9);
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

  it('saves an optional manual observation level with its audit fields', () => {
    const root = document.createElement('div');
    initApp(root, { autoRefresh: false, now: new Date('2026-06-19T00:00:00Z') });

    const nvda = root.querySelector<HTMLElement>('[data-stock-row="NVDA"]');
    const lowLevel = nvda?.querySelector<HTMLElement>('[data-manual-kind="low"]');
    const saveButton = root.querySelector<HTMLButtonElement>('[data-testid="save-state"]');

    if (!lowLevel || !saveButton) {
      throw new Error('Manual level editor did not render');
    }

    const price = lowLevel.querySelector<HTMLInputElement>('[data-level-field="price"]');
    const invalidation = lowLevel.querySelector<HTMLInputElement>(
      '[data-level-field="invalidationPrice"]',
    );
    const basis = lowLevel.querySelector<HTMLInputElement>('[data-level-field="basis"]');
    const timeframe = lowLevel.querySelector<HTMLSelectElement>('[data-level-field="timeframe"]');
    const confirmedAt = lowLevel.querySelector<HTMLInputElement>(
      '[data-level-field="confirmedAt"]',
    );

    if (!price || !invalidation || !basis || !timeframe || !confirmedAt) {
      throw new Error('Manual level fields did not render');
    }

    price.value = '118';
    invalidation.value = '112';
    basis.value = '周线平台与 MA120 重合';
    timeframe.value = 'weekly';
    confirmedAt.value = '2026-06-18';
    saveButton.click();

    const persisted = localStorage.getItem('lao-li-stocks:v1:state') ?? '';
    expect(persisted).toContain('"low":{"price":118');
    expect(persisted).toContain('周线平台与 MA120 重合');
    expect(persisted).toContain('"timeframe":"weekly"');
    expect(root.textContent).toContain('可选 · 1/3');
  });

  it('labels cached provider data as a recent close instead of a live price', () => {
    localStorage.setItem(
      'lao-li-stocks:v1:market-cache',
      JSON.stringify({
        NVDA: {
          symbol: 'NVDA',
          candles: [
            {
              date: '2026-07-13',
              open: 208.54,
              high: 210.57,
              low: 203,
              close: 203.53,
              volume: 121380205,
            },
          ],
          refreshedAt: '2026-07-14T00:00:00.000Z',
          tradingDate: '2026-07-13',
          source: 'alpha-vantage',
        },
      }),
    );

    const root = document.createElement('div');
    initApp(root, { autoRefresh: false, now: new Date('2026-07-14T01:00:00Z') });

    const nvda = root.querySelector<HTMLElement>('[data-testid="recommendation-card"]');
    expect(nvda?.textContent).toContain('Alpha Vantage 日线');
    expect(nvda?.textContent).toContain('最近收盘');
    expect(nvda?.textContent).toContain('$203.53');
    expect(nvda?.textContent).toContain('交易日 2026-07-13');
  });

  it('rejects legacy synthetic prices from browser cache', () => {
    localStorage.setItem(
      'lao-li-stocks:v1:market-cache',
      JSON.stringify({
        NVDA: {
          symbol: 'NVDA',
          candles: [
            {
              date: '2026-07-14',
              open: 224,
              high: 225,
              low: 223,
              close: 224,
              volume: 1000,
            },
          ],
          refreshedAt: '2026-07-14T00:00:00.000Z',
          tradingDate: '2026-07-14',
          source: 'demo',
        },
      }),
    );

    const root = document.createElement('div');
    initApp(root, { autoRefresh: false });

    expect(root.querySelector('[data-testid="refresh-status"]')?.textContent).toContain(
      '无行情数据',
    );
    expect(root.textContent).not.toContain('$224.00');
  });

  it('reuses a same-day cache when the refresh button is clicked', async () => {
    localStorage.setItem(
      'lao-li-stocks:v1:state',
      JSON.stringify({
        watchlist: [
          {
            symbol: 'NVDA',
            name: 'NVIDIA',
            sector: 'Semiconductors',
            thesis: '',
            status: 'active',
          },
        ],
        settings: {
          entryBufferPercent: 3.5,
          addDiscountPercent: 7,
          resistanceBufferPercent: 2,
          minimumCandles: 60,
        },
      }),
    );
    localStorage.setItem('lao-li-stocks:v1:alpha-vantage-key', 'test-key');
    localStorage.setItem(
      'lao-li-stocks:v1:market-cache',
      JSON.stringify({
        NVDA: {
          symbol: 'NVDA',
          candles: [
            {
              date: '2026-07-13',
              open: 208.54,
              high: 210.57,
              low: 203,
              close: 203.53,
              volume: 121380205,
            },
          ],
          refreshedAt: '2026-07-14T00:00:00.000Z',
          tradingDate: '2026-07-13',
          source: 'alpha-vantage',
        },
      }),
    );

    let fetchCount = 0;
    const fetchMock: typeof fetch = async () => {
      fetchCount += 1;
      throw new Error('Same-day cache should prevent a network request');
    };
    const root = document.createElement('div');
    initApp(root, {
      autoRefresh: false,
      fetchImpl: fetchMock,
      now: new Date('2026-07-14T01:00:00Z'),
    });

    root.querySelector<HTMLButtonElement>('[data-testid="force-refresh"]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchCount).toBe(0);
    expect(root.textContent).toContain('使用今日缓存：NVDA');
  });
});
