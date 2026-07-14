# Lao Li Stocks User Stories v5

## Scope

Build a personal stock watchlist and technical-signal tracker inspired by Lao Li's left-side trading workflow. The tool should be available on phone and desktop, refresh market data when opened, and produce rule-based observation signals for user-defined stocks. Automatic technical levels work by default; optional manual observation levels override the matching automatic level category.

This product provides decision support only. It does not record positions, calculate trade size, manage cash, or place trades.

## Roles

- Individual investor: manages watchlist, strategy parameters, and reviews daily signals.
- Data refresh service: fetches and caches market data so the app can update without wasting API quota.
- Strategy engine: converts watchlist, price data, and technical parameters into observation signals.
- Maintainer: deploys the app, manages API keys, and verifies production health.

## Story 1: Configure Market Data Access

As an individual investor, I want to save my market data API key locally or through a backend secret, so that the app can refresh stock data without asking me every time.

Acceptance criteria:

- Given I have no API key configured, when I open the app, then the app uses previously cached provider data or shows that no market data is loaded; it never generates a synthetic price.
- Given I enter a valid API key and save it, when the app tests the key, then it stores the key and marks data access as ready.
- Given I clear the saved key, when I reload the app, then no API key remains in local storage.
- Given the key test API returns an error, when I save the key, then the app displays a non-destructive error and does not mark the key as tested.

Automation target:

- Unit test key validation states.
- UI test setup, save, failed test, and clear flows with mocked API responses.

## Story 2: Maintain A Watchlist

As an individual investor, I want to add, edit, remove, and reorder stocks in my watchlist, so that the strategy engine only tracks companies I choose.

Acceptance criteria:

- Given I add a ticker with a display name and optional thesis, when I save it, then it appears in the watchlist.
- Given I add the same ticker twice, when I save it, then the app rejects the duplicate and keeps the original item.
- Given I remove a ticker, when I confirm removal, then it no longer appears in signals or refresh requests.
- Given I enter lowercase or spaced ticker text, when it is saved, then the symbol is normalized to uppercase without surrounding whitespace.
- Given a ticker is paused or set to market-data-only, when signals are generated, then the app returns continue-observing with the blocking reason.

Automation target:

- Unit test ticker normalization and duplicate detection.
- UI test add, edit, remove, status, and persistence flows.

## Story 3: Configure Optional Manual Observation Levels

As an individual investor, I want to optionally confirm important observation levels for each stock, so that daily reminders use the technical structure I have reviewed without making manual setup mandatory.

Acceptance criteria:

- Given no manual levels are configured, when signals are generated, then the app uses validated automatic support, deeper support, and resistance price structures.
- Given a manual low, deep, or pressure level is configured, when signals are generated, then that level overrides only the matching automatic category.
- Given a manual level is configured, when it is saved, then its price, basis, daily/weekly timeframe, optional invalidation price, and optional confirmation date are persisted.
- Given price crosses a manual level's invalidation price, when signals are generated, then the app keeps the saved level, warns that it requires review, and does not silently replace it with an automatic level from the same category.
- Given manual and automatic levels trigger together, when signals are generated, then a valid manual level is selected first.

Automation target:

- Unit test manual precedence, per-category automatic fallback, invalidation, and legacy-state sanitization.
- UI test editing and local persistence of every manual-level audit field.

## Story 4: Define Technical Signal Parameters

As an individual investor, I want to define signal thresholds, so that the tracker reflects my preferred left-side observation rules without requiring position data.

Acceptance criteria:

- Given I set an observation buffer percentage, when price is above and within that distance of a valid low or deep level, then the app marks the stock as inside the observation zone.
- Given no second validated support cluster exists, when levels are calculated, then the app leaves automatic deeper support unavailable instead of projecting one by percentage.
- Given I set a resistance buffer percentage, when price is below and near resistance, then the app can emit a pressure-observation signal.
- Given I set a minimum candle count, when data has fewer candles than required, then the app includes an insufficient-data warning.

Automation target:

- Unit test threshold calculations.
- UI test recalculation after changing strategy parameters.

## Story 5: Refresh Data On App Open

As an individual investor, I want the app to refresh data automatically when I open it, so that phone and desktop sessions show current signals with no manual workflow.

Acceptance criteria:

- Given I open the app for the first time today, when market data access is ready, then the app requests fresh data for the active watchlist.
- Given data was already refreshed today, when I reopen the app, then the app uses cached data unless I manually force refresh.
- Given the market is closed and no newer daily bar exists, when the app refreshes, then it keeps the last complete trading day and shows that timestamp.
- Given the refresh fails, when cached data exists, then the app keeps cached data and marks signals as stale.
- Given the refresh fails and no cached data exists, when I open the app, then the app shows `N/A`, continue-observing, and an actionable error state instead of a synthetic price.
- Given adjusted weekly data was refreshed in the current calendar week, when I reopen the app, then the app reuses it without another weekly request.
- Given the earnings calendar was refreshed in the last seven days, when I reopen the app, then the app reuses it without another calendar request.

Automation target:

- Unit test freshness checks and stale-state transitions.
- Integration test refresh service with mocked market data API and cache.
- UI test first open, cached reopen, forced refresh, and failure paths.

## Story 6: Protect API Quota With Daily Cache

As a data refresh service, I want to cache each ticker's daily data, so that repeated opens do not consume unnecessary free API quota.

Acceptance criteria:

- Given a ticker has a successful refresh for the current trading date, when another session requests it, then the service returns cached data.
- Given cached data is older than the latest complete trading day, when refresh is requested, then the service fetches new data.
- Given multiple tickers are requested, when the API quota would be exceeded, then the service refreshes only allowed tickers and reports skipped tickers.
- Given multiple uncached tickers are requested, when they are refreshed, then request start times are spaced by at least 1.2 seconds for the free-tier burst limit.
- Given the upstream API rate-limits a request, when refresh is attempted, then the service backs off and retries at most once before returning a concise rate-limit status.
- Given a ticker already refreshed successfully today, when the refresh button is clicked again, then the app uses that cache without making another API call.
- Given market benchmarks are needed, when data is refreshed, then SPY and sector ETFs request weekly data only and do not consume daily-data calls.
- Given one refresh reaches 24 upstream calls, when more data remains, then the app stops requesting and reports that remaining data will be completed later.

Automation target:

- Unit test trading-date cache keys.
- Integration test request spacing, bounded retry, cache hit, cache miss, and rate-limit responses.

## Story 7: Generate Technical Levels

As a strategy engine, I want to calculate support, resistance, moving averages, price distance, and volume behavior, so that signals are based on repeatable technical inputs.

Acceptance criteria:

- Given at least 250 daily candles are available, when indicators are calculated, then the engine returns MA20, MA60, MA120, and MA250.
- Given fewer candles are available, when indicators are calculated, then unavailable indicators are marked as insufficient data.
- Given at least 40 completed adjusted weekly candles are available, when long-term trend is calculated, then the engine returns weekly MA40 and excludes the still-forming current week.
- Given daily MA120 or MA250 is unavailable but weekly MA40 exists, when data quality is evaluated, then weekly MA40 is used as the long-term reference.
- Given recent swing highs and lows exist, when levels are calculated, then automatic levels are created only from clusters tested at least twice in the latest 90 daily bars.
- Given an automatic support is returned, when its direction is checked, then it is at or below the latest close.
- Given a tested support is above the latest close, when levels are calculated, then it is classified as broken support and potential resistance.
- Given no second tested lower cluster exists, when deeper support is calculated, then it remains unavailable; no fixed-percentage projection is used.
- Given volume declines while price approaches support, when the signal is scored, then the output records a selling-pressure-weakening factor.
- Given price is far above support and below resistance, when signals are generated, then the app returns continue-observing.

Automation target:

- Unit test indicator calculations against fixed candle fixtures.
- Unit test support/resistance detection and insufficient-data behavior.

## Story 8: Generate Daily Observation Signals

As an individual investor, I want each stock to receive a daily signal, so that I can quickly decide what deserves manual review.

Acceptance criteria:

- Given price enters a valid support zone, when data, level, location, confirmation, market environment, event risk, and room checks all pass, then the stock receives a technical-conditions-ready signal.
- Given price enters a valid support zone but fewer than two of price stabilization, volume, and MA60 confirmation pass, then the stock receives waiting-for-confirmation.
- Given price enters a valid support zone but room to resistance divided by risk to invalidation is below 2, then the stock receives waiting-for-confirmation.
- Given price is outside but within twice the configured support buffer, when signals are generated, then the stock receives approaching-observation-zone.
- Given price reaches a resistance zone, when signals are generated, then the stock receives a pressure-observation signal.
- Given both SPY and the stock's sector ETF have weak weekly trends, when signals are generated, then market environment fails and no technical-conditions-ready signal is emitted.
- Given a known earnings report is within seven days, when signals are generated, then event risk fails and no technical-conditions-ready signal is emitted.
- Given adjusted weekly history has fewer than 40 completed candles, when signals are generated, then core data fails and no technical-conditions-ready signal is emitted.
- Given price is below a tested former support, when signals are generated, then the stock receives structure-invalid-waiting-for-reclaim.
- Given the stock is paused, market-data-only, or data is stale, when signals are generated, then the stock receives continue-observing with the blocking reason.
- Given multiple levels from the same source apply, when signals are generated, then pressure takes priority over deep, then low.

Automation target:

- Unit test the seven-condition gate, directional level invariants, signal priority, and output schema.
- Snapshot test representative signals for ready, approaching, waiting, pressure, breakdown, paused, stale, and insufficient-data cases.

## Story 9: Explain Every Signal

As an individual investor, I want each signal to show its reason and blocking conditions, so that I can audit the tool instead of blindly following it.

Acceptance criteria:

- Given a signal is shown, when I view its card, then I see pass/fail results and details for data, level, location, confirmation, market environment, event risk, and room checks.
- Given adjusted weekly data is available, when I view a signal, then I see the weekly trend state and MA40 reference.
- Given a future earnings date is known, when I view a signal, then I see that date on the card.
- Given a signal is blocked, when I expand it, then I see the exact status or data rule that blocked it.
- Given data is stale or incomplete, when a signal is shown, then the warning is visible beside the signal.
- Given the app displays technical-conditions-ready, then it also displays that this is a rule-based reminder, not a buy instruction, financial advice, or an order instruction.
- Given a signal is rendered, then the app does not show a percentage confidence score.

Automation target:

- UI test expandable explanation content.
- Accessibility test warning and disclaimer text presence.

## Story 10: Review Signal Summary

As an individual investor, I want a signal summary, so that I can see how many stocks are tracked and how many require manual review today.

Acceptance criteria:

- Given watchlist items exist, when the dashboard loads, then it shows tracked count and technical-ready count.
- Given approaching or waiting signals exist, when the dashboard loads, then it groups them as pending confirmation.
- Given pressure or breakdown signals exist, when the dashboard loads, then it shows a risk-observation count.
- Given no signal needs action, when the dashboard loads, then the primary state is continue-observing.

Automation target:

- Unit test summary calculations.
- UI test grouping, warnings, and no-action state.

## Story 11: Work Across Phone And Desktop

As an individual investor, I want the same URL to work on phone and desktop, so that I can check signals anywhere.

Acceptance criteria:

- Given I open the app on a phone viewport, when the dashboard loads, then core cards, signals, and refresh status are usable without horizontal scrolling.
- Given I open the app on a desktop viewport, when the dashboard loads, then watchlist, settings, and signal detail can be viewed efficiently.
- Given the app is installed to a phone home screen, when it opens, then it launches into the same dashboard route.
- Given the device is offline, when I open the app, then cached data and last signals remain readable.

Automation target:

- Responsive UI tests for mobile and desktop viewport widths.
- PWA manifest and offline-cache checks.

## Story 12: Sync Settings Across Devices

As an individual investor, I want optional cloud sync for watchlist and technical settings, so that phone and desktop use the same tracking model.

Acceptance criteria:

- Given sync is disabled, when I use the app, then all personal data stays local to the device.
- Given sync is enabled and I sign in, when I update watchlist or settings on one device, then another device receives the updated configuration after reload.
- Given sync fails, when I update local settings, then the app preserves local changes and marks them as unsynced.
- Given I sign out, when the app returns to local mode, then cloud-only data is not shown unless I sign in again.

Automation target:

- Unit test local vs synced storage adapters.
- Integration test mocked auth, save, load, conflict, and sync-failure states.

## Story 13: Keep Deployment Free-Tier Friendly

As a maintainer, I want the app to fit free hosting and API limits, so that personal use remains free.

Acceptance criteria:

- Given the production build runs, when assets are generated, then the build output stays within static hosting limits.
- Given the app opens repeatedly during one day, when the same watchlist is used, then upstream API calls do not exceed one refresh per ticker per trading day unless forced.
- Given API quota is nearly exhausted, when refresh is requested, then the app warns the user before consuming the remaining quota.
- Given the backend has no required paid dependency, when deployment configuration is checked, then it can run on free-tier static hosting plus serverless functions.

Automation target:

- Build test for successful production bundle.
- Integration test API call counting.
- Configuration test for required environment variables.

## Story 14: Audit Refresh And Signal History

As an individual investor, I want to review previous daily signals, so that I can evaluate whether the strategy behaves consistently.

Acceptance criteria:

- Given signals are generated, when the refresh completes, then a daily snapshot is stored with timestamp, inputs, and signal outputs.
- Given settings are saved and signals are recalculated, when current daily data exists, then the same trading day's snapshot is replaced by the latest calculation.
- Given I open history, when snapshots exist, then I can view prior signals by date.
- Given storage reaches its configured limit, when a new snapshot is saved, then the oldest snapshot is pruned.
- Given a historical snapshot is viewed, when current settings differ, then the app clearly marks it as historical and not recalculated.

Automation target:

- Unit test snapshot creation and pruning.
- UI test history list and historical-state labeling.

## Story 15: Fail Safely

As an individual investor, I want the app to fail safely when data or rules are uncertain, so that it does not create false confidence.

Acceptance criteria:

- Given market data is missing, stale, or malformed, when signals are generated, then the stock receives continue-observing with a data-quality warning.
- Given any required technical condition fails, when signals are generated, then the app reports the failed check and does not emit technical-conditions-ready.
- Given a calculation throws an exception for one ticker, when the watchlist is processed, then other tickers still receive signals.
- Given the app detects unknown rule output, when rendering signals, then it shows a safe fallback and logs a diagnostic event.

Automation target:

- Unit test malformed data handling.
- Integration test partial ticker failure.
- UI test safe fallback rendering.

## Automation Definition Of Done

Every implemented story should include at least one automated test where practical:

- Pure calculations: unit tests with fixed fixtures.
- Data refresh and cache behavior: integration tests with mocked upstream API responses.
- User flows: UI tests in jsdom or browser automation.
- Responsive behavior: viewport-based UI tests for mobile and desktop.
- Production readiness: build test and configuration validation.

Stories that cannot be fully automated must include a short manual verification note and the reason automation is not practical.
