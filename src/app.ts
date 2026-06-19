export function renderApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="page">
      <header class="hero" data-animate>
        <div class="hero-top">
          <div class="brand">
            <div class="brand-mark">LL</div>
            <div>
              <div class="brand-name">Lao Li Stocks</div>
              <div class="brand-tag">Long-term Left-Side Strategy</div>
            </div>
          </div>
          <div class="hero-meta">
            <span>策略版本</span>
            <strong>Checkpoint v3.2</strong>
          </div>
        </div>
        <div class="hero-body">
          <h1 data-testid="hero-title">左侧交易 · 科技龙头 · 分批建仓</h1>
          <p>
            把价格当作节奏，把基本面当作门槛，用 checkpoint 驱动纪律与耐心。
          </p>
          <div class="hero-actions">
            <button class="primary">生成当日检查清单</button>
            <button class="ghost">查看历史迭代</button>
          </div>
        </div>
        <div class="hero-stats">
          <div class="stat-card">
            <span>现金缓冲</span>
            <strong>18%</strong>
            <small>保留给极端回撤</small>
          </div>
          <div class="stat-card">
            <span>观察池</span>
            <strong>9 只</strong>
            <small>大盘科技龙头</small>
          </div>
          <div class="stat-card">
            <span>目标持有</span>
            <strong>3-5 年</strong>
            <small>长线复利周期</small>
          </div>
        </div>
      </header>

      <main class="content">
        <section class="panel" data-animate>
          <div class="panel-title">
            <h2>策略支柱</h2>
            <span class="tag">左侧分批</span>
          </div>
          <div class="pill-grid">
            <div class="pill-card">
              <h3>基本面是门槛</h3>
              <p>任何一次加仓必须先通过需求、盈利质量与现金流的持续验证。</p>
            </div>
            <div class="pill-card">
              <h3>价格只负责节奏</h3>
              <p>50D / 200D 与 52周回撤用于定位介入层级与加仓节奏。</p>
            </div>
            <div class="pill-card">
              <h3>分批资金纪律</h3>
              <p>每一档只投入预设比例，避免在趋势未确认前过早满仓。</p>
            </div>
            <div class="pill-card">
              <h3>止加仓规则</h3>
              <p>出现结构性恶化、指引下修或行业逻辑破坏时立即暂停。</p>
            </div>
          </div>
        </section>

        <section class="panel grid-two" data-animate>
          <div class="panel">
            <div class="panel-title">
              <h2>决策树</h2>
              <span class="tag muted">只用于节奏</span>
            </div>
            <div class="decision-tree">
              <div class="tree-step" data-testid="decision-step">
                <span class="step-index">0</span>
                <div>
                  <h3>基本面检查</h3>
                  <p>需求、盈利质量、自由现金流与指引未明显恶化。</p>
                </div>
              </div>
              <div class="tree-step" data-testid="decision-step">
                <span class="step-index">1</span>
                <div>
                  <h3>当前价 vs 50D</h3>
                  <p>接近 50D 可开第一档；偏离过大进入回撤层级。</p>
                </div>
              </div>
              <div class="tree-step" data-testid="decision-step">
                <span class="step-index">2</span>
                <div>
                  <h3>52 周回撤层级</h3>
                  <p>0.786 / 0.618 轻仓，0.5 / 0.382 深回撤加仓。</p>
                </div>
              </div>
              <div class="tree-step" data-testid="decision-step">
                <span class="step-index">3</span>
                <div>
                  <h3>200D 重合确认</h3>
                  <p>重合则点位更硬，不重合就用区间+整数化落地。</p>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">
              <h2>分批资金表</h2>
              <span class="tag">可调</span>
            </div>
            <div class="allocation" data-testid="allocation-table">
              <div class="allocation-row">
                <span>浅回撤 0.786/0.618</span>
                <strong>30%</strong>
              </div>
              <div class="allocation-row">
                <span>深回撤 0.5</span>
                <strong>20%</strong>
              </div>
              <div class="allocation-row">
                <span>深回撤 0.382</span>
                <strong>20%</strong>
              </div>
              <div class="allocation-row">
                <span>极端回撤</span>
                <strong>20%</strong>
              </div>
              <div class="allocation-row">
                <span>企稳确认</span>
                <strong>10%</strong>
              </div>
            </div>
            <div class="note">
              单一股票上限 12%-15%，保留 10%-20% 现金缓冲。
            </div>
          </div>
        </section>

        <section class="panel" data-animate>
          <div class="panel-title">
            <h2>迭代式 Checkpoints</h2>
            <span class="tag">长期持有</span>
          </div>
          <div class="checkpoint-list">
            <div class="checkpoint" data-testid="checkpoint-item">
              <div class="checkpoint-badge">Checkpoint 0</div>
              <div>
                <h3>基本面未破坏</h3>
                <p>需求逻辑、现金流、指引三项通过，才允许任何买入动作。</p>
              </div>
              <span class="status ok">必经</span>
            </div>
            <div class="checkpoint" data-testid="checkpoint-item">
              <div class="checkpoint-badge">Checkpoint 1</div>
              <div>
                <h3>价格接近 50D</h3>
                <p>符合浅回撤层级，允许小比例试仓。</p>
              </div>
              <span class="status">待触发</span>
            </div>
            <div class="checkpoint" data-testid="checkpoint-item">
              <div class="checkpoint-badge">Checkpoint 2</div>
              <div>
                <h3>进入深回撤带</h3>
                <p>0.5/0.382 区间允许加仓，但仍遵守仓位上限。</p>
              </div>
              <span class="status">待触发</span>
            </div>
            <div class="checkpoint" data-testid="checkpoint-item">
              <div class="checkpoint-badge">Checkpoint 3</div>
              <div>
                <h3>200D 重合验证</h3>
                <p>重合则单点执行，不重合则用区间落地。</p>
              </div>
              <span class="status">策略锁定</span>
            </div>
            <div class="checkpoint" data-testid="checkpoint-item">
              <div class="checkpoint-badge">Checkpoint 4</div>
              <div>
                <h3>止加仓条件</h3>
                <p>出现结构性恶化、指引下修或行业逻辑破坏即停止加仓。</p>
              </div>
              <span class="status warn">警戒</span>
            </div>
          </div>
        </section>

        <section class="panel grid-two" data-animate>
          <div class="panel">
            <div class="panel-title">
              <h2>观察池</h2>
              <span class="tag muted">科技龙头</span>
            </div>
            <div class="watchlist">
              <div class="watch-card">
                <h3>NVDA</h3>
                <p>核心驱动：AI 训练 + 生态护城河</p>
                <span class="chip">关注回撤 0.618</span>
              </div>
              <div class="watch-card">
                <h3>MSFT</h3>
                <p>云 + Copilot 渗透率上升</p>
                <span class="chip">等待 50D 附近</span>
              </div>
              <div class="watch-card">
                <h3>META</h3>
                <p>广告周期修复 + 成本纪律</p>
                <span class="chip">深回撤加仓带</span>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">
              <h2>当日清单</h2>
              <span class="tag">纪律提醒</span>
            </div>
            <div class="checklist">
              <label class="check-item">
                <input type="checkbox" />
                <span>本季度基本面没有明显恶化</span>
              </label>
              <label class="check-item">
                <input type="checkbox" />
                <span>回撤层级对应的仓位尚未满额</span>
              </label>
              <label class="check-item">
                <input type="checkbox" />
                <span>200D 是否与关键回撤重合</span>
              </label>
              <label class="check-item">
                <input type="checkbox" />
                <span>保留现金缓冲比例</span>
              </label>
            </div>
          </div>
        </section>

        <section class="panel callout" data-animate>
          <div>
            <h2>下一次迭代焦点</h2>
            <p>把财报与指引事件加入 checkpoint，以“事件后执行”降低误判。</p>
          </div>
          <button class="ghost">添加迭代任务</button>
        </section>
      </main>
    </div>
  `;
}

export function initApp(root: HTMLElement): void {
  renderApp(root);
}
