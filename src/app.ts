import {
  createAlphaVantageRequestScheduler,
  getLatestRefresh,
  refreshMarketData,
  testAlphaVantageKey,
} from './marketData';
import { recordSignalSnapshot } from './history';
import { getRequiredBenchmarkSymbols } from './marketContext';
import { refreshSupplementalData } from './supplementalData';
import {
  buildSignalSummary,
  generateRecommendations,
  sanitizeState,
} from './strategy';
import {
  clearApiKey,
  loadApiKey,
  loadAppState,
  loadEarningsCalendar,
  loadMarketCache,
  loadSignalHistory,
  loadWeeklyCache,
  saveApiKey,
  saveAppState,
  saveEarningsCalendar,
  saveMarketCache,
  saveSignalHistory,
  saveWeeklyCache,
} from './storage';
import type {
  AppState,
  EarningsCalendarCache,
  ManualObservationLevel,
  ManualObservationLevels,
  MarketDataMap,
  MarketDataRecord,
  ObservationLevelKind,
  Recommendation,
  SignalSnapshot,
  StockStatus,
  TrendState,
  WatchStock,
  WeeklyDataMap,
} from './types';
import { formatCurrency, formatDateTime, normalizeTicker, roundMoney } from './utils';

interface AppOptions {
  autoRefresh?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
}

interface RuntimeState {
  state: AppState;
  apiKey: string;
  marketCache: MarketDataMap;
  weeklyCache: WeeklyDataMap;
  earningsCalendar: EarningsCalendarCache | null;
  signalHistory: SignalSnapshot[];
  notice: string;
  error: string;
  refreshing: boolean;
}

const STATUS_LABELS: Record<StockStatus, string> = {
  active: '正常跟踪',
  sealed: '暂停跟踪',
  no_action: '仅显示行情',
};

const MANUAL_LEVEL_LABELS: Record<ObservationLevelKind, string> = {
  low: '低位观察',
  deep: '深度观察',
  pressure: '压力观察',
};

export function initApp(root: HTMLElement, options: AppOptions = {}): void {
  const runtime: RuntimeState = {
    state: loadAppState(),
    apiKey: loadApiKey(),
    marketCache: loadMarketCache(),
    weeklyCache: loadWeeklyCache(),
    earningsCalendar: loadEarningsCalendar(),
    signalHistory: loadSignalHistory(),
    notice: '',
    error: '',
    refreshing: false,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const getNow = () => options.now ?? new Date();

  const render = () => {
    root.innerHTML = renderApp(runtime);
  };

  const recordSnapshot = () => {
    const recommendations = generateRecommendations(
      runtime.state,
      runtime.marketCache,
      runtime.weeklyCache,
      runtime.earningsCalendar,
    );
    runtime.signalHistory = recordSignalSnapshot(
      runtime.signalHistory,
      recommendations,
      runtime.state.settings,
      getNow(),
    );
    saveSignalHistory(runtime.signalHistory);
  };

  const refresh = async (force: boolean) => {
    if (!runtime.apiKey) {
      runtime.error = '请先保存 Alpha Vantage API key。当前没有真实行情数据。';
      render();
      return;
    }

    runtime.refreshing = true;
    runtime.error = '';
    runtime.notice = force ? '正在强制刷新行情...' : '正在检查今日行情缓存...';
    render();

    const watchSymbols = runtime.state.watchlist.map((stock) => stock.symbol);
    const benchmarkSymbols = getRequiredBenchmarkSymbols(runtime.state.watchlist);
    const weeklySymbols = [...new Set([...watchSymbols, ...benchmarkSymbols])];
    const scheduler = createAlphaVantageRequestScheduler({ maxRequests: 24 });
    const result = await refreshMarketData(
      watchSymbols,
      runtime.apiKey,
      force ? {} : runtime.marketCache,
      fetchImpl,
      getNow(),
      { scheduler },
    );
    runtime.marketCache = result.cache;
    saveMarketCache(result.cache);

    const supplementalResult = await refreshSupplementalData(
      weeklySymbols,
      runtime.apiKey,
      runtime.weeklyCache,
      runtime.earningsCalendar,
      fetchImpl,
      getNow(),
      { scheduler },
    );
    runtime.weeklyCache = supplementalResult.weeklyCache;
    runtime.earningsCalendar = supplementalResult.earningsCalendar;
    saveWeeklyCache(runtime.weeklyCache);
    if (runtime.earningsCalendar) {
      saveEarningsCalendar(runtime.earningsCalendar);
    }
    recordSnapshot();
    runtime.refreshing = false;
    runtime.notice = buildRefreshNotice(
      result.refreshed,
      result.skipped,
      supplementalResult.weeklyRefreshed,
      supplementalResult.weeklySkipped,
      supplementalResult.earningsRefreshed,
    );
    runtime.error = [...result.errors, ...supplementalResult.errors].join('；');
    render();
  };

  root.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    event.preventDefault();

    if (form.dataset.form === 'add-stock') {
      const formData = new FormData(form);
      const symbol = normalizeTicker(String(formData.get('symbol') ?? ''));
      if (!symbol) {
        runtime.error = '请输入股票代码。';
        render();
        return;
      }

      if (runtime.state.watchlist.some((stock) => stock.symbol === symbol)) {
        runtime.error = `${symbol} 已在自选列表中。`;
        render();
        return;
      }

      runtime.state.watchlist = [
        ...runtime.state.watchlist,
        {
          symbol,
          name: String(formData.get('name') ?? symbol).trim() || symbol,
          sector: String(formData.get('sector') ?? 'Unassigned').trim() || 'Unassigned',
          thesis: String(formData.get('thesis') ?? '').trim(),
          status: 'active',
        },
      ];
      runtime.state = sanitizeState(runtime.state);
      saveAppState(runtime.state);
      runtime.notice = `${symbol} 已加入自选。`;
      runtime.error = '';
      form.reset();
      render();
    }
  });

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('[data-action]');
    if (!button) {
      return;
    }

    const action = button.dataset.action;

    if (action === 'save-api-key') {
      const input = root.querySelector<HTMLInputElement>('[data-testid="api-key-input"]');
      runtime.apiKey = input?.value.trim() ?? '';
      saveApiKey(runtime.apiKey);
      runtime.notice = runtime.apiKey ? 'API key 已保存。' : 'API key 已清空。';
      runtime.error = '';
      render();
    }

    if (action === 'test-api-key') {
      const input = root.querySelector<HTMLInputElement>('[data-testid="api-key-input"]');
      const key = input?.value.trim() ?? runtime.apiKey;
      runtime.notice = '正在测试 API key...';
      runtime.error = '';
      render();
      void testAlphaVantageKey(key, fetchImpl)
        .then((valid) => {
          if (valid) {
            runtime.apiKey = key;
            saveApiKey(key);
            runtime.notice = 'API key 测试通过并已保存。';
          } else {
            runtime.error = 'API key 测试失败。';
          }
          render();
        })
        .catch((error) => {
          runtime.error = error instanceof Error ? error.message : 'API key 测试失败。';
          render();
        });
    }

    if (action === 'clear-api-key') {
      runtime.apiKey = '';
      clearApiKey();
      runtime.notice = 'API key 已移除。';
      runtime.error = '';
      render();
    }

    if (action === 'save-state') {
      runtime.state = readStateFromDom(root, runtime.state);
      saveAppState(runtime.state);
      recordSnapshot();
      runtime.notice = '设置已保存，信号已重新计算。';
      runtime.error = '';
      render();
    }

    if (action === 'force-refresh') {
      void refresh(false);
    }

    if (action === 'remove-stock') {
      const symbol = button.dataset.symbol;
      if (symbol) {
        runtime.state.watchlist = runtime.state.watchlist.filter((stock) => stock.symbol !== symbol);
        saveAppState(runtime.state);
        runtime.notice = `${symbol} 已移除。`;
        runtime.error = '';
        render();
      }
    }
  });

  recordSnapshot();
  render();

  if (runtime.apiKey && options.autoRefresh !== false) {
    void refresh(false);
  }
}

export function renderApp(runtime: RuntimeState): string {
  const symbols = runtime.state.watchlist.map((stock) => stock.symbol);
  const effectiveMarketData = runtime.marketCache;
  const recommendations = generateRecommendations(
    runtime.state,
    effectiveMarketData,
    runtime.weeklyCache,
    runtime.earningsCalendar,
  );
  const summary = buildSignalSummary(recommendations);
  const marketRecords = symbols
    .map((symbol) => effectiveMarketData[symbol])
    .filter((record): record is MarketDataRecord => Boolean(record));
  const latestRefresh = getLatestRefresh(marketRecords);
  const marketStatus = runtime.refreshing
    ? '刷新中'
    : marketRecords.length === 0
      ? '无行情数据'
      : marketRecords.length < symbols.length
        ? '部分真实日线'
        : '真实日线行情';

  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Lao Li Stocks · MVP</p>
          <h1 data-testid="hero-title">左侧交易每日观察台</h1>
          <p class="subtitle">只跟踪自选股的技术位置和规则信号，不记录持股信息、不计算交易数量、不自动下单。</p>
        </div>
        <div class="topbar-actions">
          <button type="button" class="secondary" data-action="save-state" data-testid="save-state">保存设置</button>
          <button type="button" data-action="force-refresh" data-testid="force-refresh" ${runtime.refreshing ? 'disabled' : ''}>刷新行情</button>
        </div>
      </header>

      <section class="notice-row" aria-live="polite">
        <div class="status-line" data-testid="refresh-status">
          <strong>${marketStatus}</strong>
          <span>最近刷新：${formatDateTime(latestRefresh)}</span>
        </div>
        ${runtime.notice ? `<div class="notice">${escapeHtml(runtime.notice)}</div>` : ''}
        ${runtime.error ? `<div class="notice error">${escapeHtml(runtime.error)}</div>` : ''}
      </section>

      <main class="dashboard">
        <section class="summary-grid" aria-label="signal summary">
          <article class="metric">
            <span>跟踪股票</span>
            <strong>${summary.trackedCount}</strong>
            <small>来自你的自选列表</small>
          </article>
          <article class="metric">
            <span>技术条件满足</span>
            <strong>${summary.readyCount}</strong>
            <small>全部七项条件通过</small>
          </article>
          <article class="metric">
            <span>接近或待确认</span>
            <strong>${summary.waitingCount}</strong>
            <small>仍有条件尚未满足</small>
          </article>
          <article class="metric">
            <span>风险观察</span>
            <strong>${summary.riskCount}</strong>
            <small>压力区或结构失效</small>
          </article>
        </section>

        <section class="layout-grid">
          <div class="column">
            ${renderApiPanel(runtime.apiKey)}
            ${renderSettingsPanel(runtime.state)}
            ${renderWatchlist(runtime.state.watchlist)}
            ${renderAddStockForm()}
          </div>

          <div class="signal-column">
            <section class="panel recommendations-panel">
              <div class="section-heading">
                <div>
                  <h2>每日信号</h2>
                  <p>检查数据、支撑、位置、确认、市场环境、事件风险和空间比；“技术条件满足”不等于买入指令。</p>
                </div>
                <span class="badge">${recommendations.length} 只</span>
              </div>
              <div class="recommendations" data-testid="recommendation-list">
                ${recommendations
                  .map((item) => renderRecommendation(item, effectiveMarketData[item.symbol]))
                  .join('')}
              </div>
            </section>
            ${renderSignalHistory(runtime.signalHistory)}
          </div>
        </section>
      </main>
    </div>
  `;
}

function renderApiPanel(apiKey: string): string {
  return `
    <section class="panel">
      <div class="section-heading compact">
        <h2>数据源</h2>
        <span class="badge">${apiKey ? '已配置' : '未配置'}</span>
      </div>
      <label class="field">
        <span>Alpha Vantage API key（免费日线、复权周线与财报日历）</span>
        <input data-testid="api-key-input" type="password" value="${escapeHtml(apiKey)}" placeholder="保存后打开页面会自动刷新" />
      </label>
      <div class="button-row">
        <button type="button" data-action="save-api-key">保存</button>
        <button type="button" class="secondary" data-action="test-api-key">测试</button>
        <button type="button" class="text-button" data-action="clear-api-key">清除</button>
      </div>
    </section>
  `;
}

function renderSettingsPanel(state: AppState): string {
  return `
    <section class="panel">
      <div class="section-heading compact">
        <h2>策略参数</h2>
        <span class="badge">技术信号</span>
      </div>
      <div class="form-grid">
        ${numberField('观察区缓冲 %', 'entryBufferPercent', state.settings.entryBufferPercent, 'settings', 0.1)}
        ${numberField('压力区缓冲 %', 'resistanceBufferPercent', state.settings.resistanceBufferPercent, 'settings', 0.1)}
        ${numberField('最低K线数', 'minimumCandles', state.settings.minimumCandles, 'settings', 1)}
      </div>
    </section>
  `;
}

function renderWatchlist(watchlist: WatchStock[]): string {
  return `
    <section class="panel">
      <div class="section-heading compact">
        <h2>自选股</h2>
        <span class="badge">${watchlist.length} 只</span>
      </div>
      <div class="stock-table" data-testid="watchlist-form">
        ${watchlist.map(renderStockRow).join('')}
      </div>
    </section>
  `;
}

function renderStockRow(stock: WatchStock): string {
  return `
    <div class="stock-row" data-stock-row="${stock.symbol}">
      <div class="stock-row-head">
        <div>
          <strong>${escapeHtml(stock.symbol)}</strong>
          <span>${escapeHtml(stock.name)}</span>
        </div>
        <button type="button" class="icon-button" aria-label="移除 ${escapeHtml(stock.symbol)}" data-action="remove-stock" data-symbol="${escapeHtml(stock.symbol)}">×</button>
      </div>
      <div class="form-grid dense">
        ${textField('名称', 'name', stock.name)}
        ${textField('板块', 'sector', stock.sector)}
        <label class="field">
          <span>状态</span>
          <select data-field="status">
            ${Object.entries(STATUS_LABELS)
              .map(([value, label]) => `<option value="${value}" ${stock.status === value ? 'selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </label>
      </div>
      <label class="field">
        <span>跟踪逻辑</span>
        <textarea data-field="thesis" rows="2">${escapeHtml(stock.thesis)}</textarea>
      </label>
      ${renderManualLevelEditor(stock)}
    </div>
  `;
}

function renderManualLevelEditor(stock: WatchStock): string {
  const configuredCount = (['low', 'deep', 'pressure'] as ObservationLevelKind[]).filter(
    (kind) => stock.manualLevels?.[kind],
  ).length;

  return `
    <details class="manual-level-editor">
      <summary>
        <span>手动观察价位</span>
        <span class="badge">可选 · ${configuredCount}/3</span>
      </summary>
      <div class="manual-level-list">
        ${(['low', 'deep', 'pressure'] as ObservationLevelKind[])
          .map((kind) => renderManualLevelRow(kind, stock.manualLevels?.[kind]))
          .join('')}
      </div>
    </details>
  `;
}

function renderManualLevelRow(
  kind: ObservationLevelKind,
  level: ManualObservationLevel | undefined,
): string {
  const invalidationPlaceholder =
    kind === 'pressure' ? '高于该价失效' : '低于该价失效';

  return `
    <fieldset class="manual-level-row" data-manual-kind="${kind}">
      <legend>${MANUAL_LEVEL_LABELS[kind]}</legend>
      <div class="manual-level-fields">
        <label class="field">
          <span>观察价</span>
          <input type="number" min="0" step="0.01" data-level-field="price" value="${level?.price ?? ''}" placeholder="可选" />
        </label>
        <label class="field">
          <span>失效价（收盘）</span>
          <input type="number" min="0" step="0.01" data-level-field="invalidationPrice" value="${level?.invalidationPrice ?? ''}" placeholder="${invalidationPlaceholder}" />
        </label>
        <label class="field">
          <span>依据周期</span>
          <select data-level-field="timeframe">
            <option value="daily" ${level?.timeframe !== 'weekly' ? 'selected' : ''}>日线</option>
            <option value="weekly" ${level?.timeframe === 'weekly' ? 'selected' : ''}>周线</option>
          </select>
        </label>
        <label class="field level-basis">
          <span>价位依据</span>
          <input data-level-field="basis" value="${escapeHtml(level?.basis ?? '')}" placeholder="前低、平台、均线或突破回踩" />
        </label>
        <label class="field">
          <span>确认日期</span>
          <input type="date" data-level-field="confirmedAt" value="${escapeHtml(level?.confirmedAt ?? '')}" />
        </label>
      </div>
    </fieldset>
  `;
}

function renderAddStockForm(): string {
  return `
    <section class="panel">
      <div class="section-heading compact">
        <h2>添加股票</h2>
      </div>
      <form data-form="add-stock" class="add-form">
        <div class="form-grid">
          <label class="field">
            <span>代码</span>
            <input name="symbol" data-testid="add-stock-symbol" placeholder="AAPL" autocomplete="off" />
          </label>
          <label class="field">
            <span>名称</span>
            <input name="name" placeholder="Apple" autocomplete="off" />
          </label>
          <label class="field">
            <span>板块</span>
            <input name="sector" placeholder="Technology" autocomplete="off" />
          </label>
        </div>
        <label class="field">
          <span>跟踪逻辑</span>
          <textarea name="thesis" rows="2" placeholder="为什么值得长期跟踪"></textarea>
        </label>
        <button type="submit">加入自选</button>
      </form>
    </section>
  `;
}

function renderRecommendation(
  item: Recommendation,
  marketRecord?: MarketDataRecord,
): string {
  const levels = item.levels;
  const passedConditionCount = item.conditionChecks.filter((check) => check.passed).length;
  const totalConditionCount = item.conditionChecks.length;
  const statusBadge = item.action === 'technical_ready'
    ? `${totalConditionCount}/${totalConditionCount} 条件`
    : item.action === 'approaching' || item.action === 'waiting_confirmation'
      ? `${passedConditionCount}/${totalConditionCount} 条件`
      : item.action === 'pressure_watch'
        ? '压力'
        : item.action === 'breakdown'
          ? '失效'
          : '观察';
  const signalSourceLabel = item.triggeredLevel
    ? item.triggeredLevel.source === 'manual'
      ? '手动价位'
      : '自动技术参考'
    : item.manualLevelCount > 0
      ? `已配置 ${item.manualLevelCount} 个手动价位`
      : '自动技术参考';
  const marketSourceLabel = marketRecord
    ? marketRecord.source === 'alpha-vantage'
      ? 'Alpha Vantage 日线'
      : '缓存日线'
    : '未加载行情';
  const dataQualityLabel = item.dataQuality === 'complete'
    ? '数据完整'
    : item.dataQuality === 'limited'
      ? '数据有限'
      : '数据不足';

  return `
    <article class="recommendation ${item.action}" data-testid="recommendation-card">
      <div class="recommendation-head">
        <div>
          <span class="symbol">${escapeHtml(item.symbol)}</span>
          <strong>${item.label}</strong>
        </div>
        <span class="score">${statusBadge}</span>
      </div>
      <div class="recommendation-meta">
        <span>${marketSourceLabel}</span>
        <span>${dataQualityLabel}</span>
        <span>${signalSourceLabel}</span>
        <span>规则提醒，不含交易数量</span>
        <span>长期趋势 ${trendLabel(item.weeklyTrend?.state)}</span>
        ${item.weeklyTrend?.ma40 !== null && item.weeklyTrend?.ma40 !== undefined
          ? `<span>复权周线 MA40 ${formatCurrency(item.weeklyTrend.ma40)}</span>`
          : ''}
        <span>市场环境 ${item.marketEnvironment ? escapeHtml(item.marketEnvironment.detail) : '未加载'}</span>
        <span>下一财报 ${item.nextEarnings?.reportDate ?? '未知或未来三个月无日期'}</span>
        <span>交易日 ${levels?.tradingDate ?? 'N/A'}</span>
        <span>刷新 ${formatDateTime(marketRecord?.refreshedAt)}</span>
      </div>
      <dl class="levels">
        <div><dt>最近收盘</dt><dd>${levels ? formatCurrency(levels.currentPrice) : 'N/A'}</dd></div>
        <div><dt>观察价位</dt><dd>${item.triggeredLevel ? formatCurrency(item.triggeredLevel.price) : 'N/A'}</dd></div>
        <div><dt>有效支撑</dt><dd>${levels?.support !== null && levels?.support !== undefined ? formatCurrency(levels.support) : 'N/A'}</dd></div>
        <div><dt>有效压力</dt><dd>${levels?.resistance !== null && levels?.resistance !== undefined ? formatCurrency(levels.resistance) : 'N/A'}</dd></div>
      </dl>
      <ul class="condition-list" aria-label="技术条件">
        ${item.conditionChecks.map((check) => `
          <li class="${check.passed ? 'passed' : 'failed'}">
            <span>${check.passed ? '通过' : '未通过'}</span>
            <div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div>
          </li>
        `).join('')}
      </ul>
      <details>
        <summary>查看依据</summary>
        ${renderList('理由', item.reasons)}
        ${renderList('拦截', item.blockers)}
        ${renderList('提示', item.warnings)}
      </details>
    </article>
  `;
}

function renderSignalHistory(history: SignalSnapshot[]): string {
  const recent = [...history].sort((a, b) => b.tradingDate.localeCompare(a.tradingDate)).slice(0, 7);
  return `
    <section class="panel history-panel" data-testid="signal-history">
      <div class="section-heading compact">
        <div>
          <h2>信号历史</h2>
          <p>每天保留最后一次计算结果，最多保存 180 个交易日。</p>
        </div>
        <span class="badge">${history.length} 日</span>
      </div>
      ${recent.length === 0
        ? '<p class="empty-state">有行情数据后开始记录。</p>'
        : `<div class="history-list">
            ${recent.map((snapshot, index) => `
              <details class="history-row" ${index === 0 ? 'open' : ''}>
                <summary>
                  <span>${snapshot.tradingDate}</span>
                  <small>${snapshot.items.length} 只</small>
                </summary>
                <div class="history-items">
                  ${snapshot.items.map((item) => `
                    <div>
                      <strong>${escapeHtml(item.symbol)}</strong>
                      <span>${escapeHtml(item.label)}</span>
                      <span>${item.passedConditions}/${item.totalConditions}</span>
                      <span>${item.currentPrice === null ? 'N/A' : formatCurrency(item.currentPrice)}</span>
                    </div>
                  `).join('')}
                </div>
              </details>
            `).join('')}
          </div>`}
    </section>
  `;
}

function trendLabel(state: TrendState | undefined): string {
  if (state === 'healthy') return '健康';
  if (state === 'neutral') return '中性';
  if (state === 'weak') return '偏弱';
  return '不可用';
}

function renderList(title: string, items: string[]): string {
  if (items.length === 0) {
    return '';
  }

  return `
    <div class="reason-list">
      <strong>${title}</strong>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function numberField(
  label: string,
  field: string,
  value: number,
  scope: 'settings',
  step: number,
): string {
  return `
    <label class="field">
      <span>${label}</span>
      <input type="number" step="${step}" value="${roundMoney(value)}" data-${scope}="${field}" data-field="${field}" />
    </label>
  `;
}

function textField(label: string, field: string, value: string): string {
  return `
    <label class="field">
      <span>${label}</span>
      <input value="${escapeHtml(value)}" data-field="${field}" />
    </label>
  `;
}

function readStateFromDom(root: HTMLElement, previousState: AppState): AppState {
  const settings = {
    entryBufferPercent: readNumber(
      root.querySelector<HTMLInputElement>('[data-settings="entryBufferPercent"]'),
      previousState.settings.entryBufferPercent,
    ),
    resistanceBufferPercent: readNumber(
      root.querySelector<HTMLInputElement>('[data-settings="resistanceBufferPercent"]'),
      previousState.settings.resistanceBufferPercent,
    ),
    minimumCandles: readNumber(
      root.querySelector<HTMLInputElement>('[data-settings="minimumCandles"]'),
      previousState.settings.minimumCandles,
    ),
  };

  const watchlist = Array.from(root.querySelectorAll<HTMLElement>('[data-stock-row]')).map((row) => {
    const symbol = normalizeTicker(row.dataset.stockRow ?? '');
    const previous = previousState.watchlist.find((stock) => stock.symbol === symbol);
    return {
      symbol,
      name: readString(row, 'name', previous?.name ?? symbol),
      sector: readString(row, 'sector', previous?.sector ?? 'Unassigned'),
      thesis: readString(row, 'thesis', previous?.thesis ?? ''),
      status: readStatus(row, previous?.status ?? 'active'),
      manualLevels: readManualLevels(row),
    };
  });

  return sanitizeState({ watchlist, settings, lastSavedAt: new Date().toISOString() });
}

function readManualLevels(root: HTMLElement): ManualObservationLevels {
  const levels: ManualObservationLevels = {};

  root.querySelectorAll<HTMLElement>('[data-manual-kind]').forEach((row) => {
    const kind = row.dataset.manualKind as ObservationLevelKind | undefined;
    if (!kind || !['low', 'deep', 'pressure'].includes(kind)) {
      return;
    }

    const price = readOptionalNumber(
      row.querySelector<HTMLInputElement>('[data-level-field="price"]'),
    );
    if (price === undefined) {
      return;
    }

    const invalidationPrice = readOptionalNumber(
      row.querySelector<HTMLInputElement>('[data-level-field="invalidationPrice"]'),
    );
    const timeframeValue = row.querySelector<HTMLSelectElement>(
      '[data-level-field="timeframe"]',
    )?.value;
    const basis =
      row.querySelector<HTMLInputElement>('[data-level-field="basis"]')?.value.trim() ?? '';
    const confirmedAt =
      row.querySelector<HTMLInputElement>('[data-level-field="confirmedAt"]')?.value ?? '';

    levels[kind] = {
      price,
      basis,
      timeframe: timeframeValue === 'weekly' ? 'weekly' : 'daily',
      ...(invalidationPrice === undefined ? {} : { invalidationPrice }),
      ...(confirmedAt ? { confirmedAt } : {}),
    };
  });

  return levels;
}

function readString(root: HTMLElement, field: string, fallback: string): string {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`);
  return input?.value.trim() ?? fallback;
}

function readNumber(input: HTMLInputElement | null, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(input: HTMLInputElement | null): number | undefined {
  if (!input || input.value.trim() === '') {
    return undefined;
  }

  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readStatus(root: HTMLElement, fallback: StockStatus): StockStatus {
  const value = root.querySelector<HTMLSelectElement>('[data-field="status"]')?.value;
  return value === 'sealed' || value === 'no_action' || value === 'active' ? value : fallback;
}

function buildRefreshNotice(
  refreshed: string[],
  skipped: string[],
  weeklyRefreshed: string[],
  weeklySkipped: string[],
  earningsRefreshed: boolean,
): string {
  const parts = [];
  if (refreshed.length > 0) {
    parts.push(`已刷新：${refreshed.join(', ')}`);
  }
  if (skipped.length > 0) {
    parts.push(`日线缓存：${skipped.join(', ')}`);
  }
  if (weeklyRefreshed.length > 0) {
    parts.push(`已刷新复权周线：${weeklyRefreshed.join(', ')}`);
  }
  if (weeklySkipped.length > 0) {
    parts.push(`周线本周已缓存：${weeklySkipped.join(', ')}`);
  }
  if (earningsRefreshed) {
    parts.push('已刷新财报日历');
  }
  return parts.join('；') || '没有刷新任何股票。';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
