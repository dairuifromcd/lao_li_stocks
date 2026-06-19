# Lao Li Stocks User Stories v1

## Scope

Build a personal stock strategy tracker inspired by Lao Li's left-side trading workflow. The tool should be available on phone and desktop, refresh market data when opened, and produce rule-based operation suggestions for a user-defined watchlist.

This product provides decision support only. It must not place trades automatically.

## Roles

- Individual investor: manages watchlist, positions, cash rules, and reviews daily suggestions.
- Data refresh service: fetches and caches market data so the app can update without wasting API quota.
- Strategy engine: converts watchlist, positions, price data, and risk rules into operation suggestions.
- Maintainer: deploys the app, manages API keys, and verifies production health.

## Story 1: Configure Market Data Access

As an individual investor, I want to save my market data API key locally or through a backend secret, so that the app can refresh stock data without asking me every time.

Acceptance criteria:

- Given I have no API key configured, when I open the app, then the data refresh control is disabled and the app shows a setup state.
- Given I enter a valid API key and save it, when the app tests the key, then it stores the key and marks data access as ready.
- Given I clear the saved key, when I reload the app, then no key is available to browser code except through the chosen storage path.
- Given the key test API returns an error, when I save the key, then the app displays a non-destructive error and does not mark the key as ready.

Automation target:

- Unit test key validation states.
- UI test setup, save, failed test, and clear flows with mocked API responses.

## Story 2: Maintain A Watchlist

As an individual investor, I want to add, edit, remove, and reorder stocks in my watchlist, so that the strategy engine only tracks companies I choose.

Acceptance criteria:

- Given I add a ticker with a display name and optional thesis, when I save it, then it appears in the watchlist.
- Given I add the same ticker twice, when I save it, then the app rejects the duplicate and keeps the original item.
- Given I remove a ticker, when I confirm removal, then it no longer appears in suggestions or refresh requests.
- Given I reorder tickers, when I reload the app, then the saved order is preserved.
- Given I enter lowercase or spaced ticker text, when it is saved, then the symbol is normalized to uppercase without surrounding whitespace.

Automation target:

- Unit test ticker normalization and duplicate detection.
- UI test add, edit, remove, reorder, and persistence flows.

## Story 3: Record Current Position State

As an individual investor, I want to record my shares, average cost, target max allocation, and current operation status per stock, so that recommendations account for my real portfolio.

Acceptance criteria:

- Given a stock is in my watchlist, when I enter shares and average cost, then the app calculates current market value, unrealized gain/loss, and portfolio allocation.
- Given a stock has no shares, when suggestions are generated, then it is eligible for "open position" but not "reduce".
- Given a stock is marked "sealed" or "no action", when suggestions are generated, then the app does not suggest buying unless I manually unlock it.
- Given a single-stock max allocation is set, when a buy signal would exceed it, then the suggestion is downgraded or capped.

Automation target:

- Unit test position math and eligibility rules.
- UI test status changes and allocation limit messaging.

## Story 4: Define Risk Rules

As an individual investor, I want to define cash buffer, per-stock allocation cap, per-sector cap, and per-trade size rules, so that left-side buying stays controlled.

Acceptance criteria:

- Given I set a minimum cash buffer, when a buy recommendation would reduce cash below it, then the app blocks or caps the recommendation.
- Given I set a per-trade max amount, when a buy signal is triggered, then the suggested amount never exceeds the max amount.
- Given I set a max number of add-on rounds, when a stock has reached that number, then further add-on suggestions are blocked.
- Given risk settings are changed, when suggestions are recalculated, then all affected recommendations update immediately.

Automation target:

- Unit test rule precedence and capped recommendation output.
- UI test recalculation after changing risk settings.

## Story 5: Refresh Data On App Open

As an individual investor, I want the app to refresh data automatically when I open it, so that phone and desktop sessions show current suggestions with no manual workflow.

Acceptance criteria:

- Given I open the app for the first time today, when market data access is ready, then the app requests fresh data for the active watchlist.
- Given data was already refreshed today, when I reopen the app, then the app uses cached data unless I manually force refresh.
- Given the market is closed and no newer daily bar exists, when the app refreshes, then it keeps the last complete trading day and shows that timestamp.
- Given the refresh fails, when cached data exists, then the app keeps cached data and marks suggestions as stale.
- Given the refresh fails and no cached data exists, when I open the app, then the app shows an actionable error state.

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
- Given the upstream API rate-limits the request, when refresh is attempted, then the service backs off and returns a rate-limit status instead of retrying in a loop.

Automation target:

- Unit test trading-date cache keys.
- Integration test quota counting, cache hit, cache miss, and rate-limit responses.

## Story 7: Generate Technical Levels

As a strategy engine, I want to calculate support, resistance, moving averages, price distance, and volume behavior, so that recommendations are based on repeatable technical signals.

Acceptance criteria:

- Given at least 250 daily candles are available, when indicators are calculated, then the engine returns MA20, MA60, MA120, and MA250.
- Given fewer than 250 candles are available, when indicators are calculated, then unavailable indicators are marked as insufficient data.
- Given recent swing highs and lows exist, when levels are calculated, then the engine returns candidate support and resistance levels.
- Given volume declines while price approaches support, when the signal is scored, then the output records a "selling pressure weakening" factor.
- Given price is far above support and near resistance, when suggestions are generated, then the app does not produce a buy signal.

Automation target:

- Unit test indicator calculations against fixed candle fixtures.
- Unit test support/resistance detection and insufficient-data behavior.

## Story 8: Generate Daily Operation Suggestions

As an individual investor, I want each stock to receive a daily operation suggestion, so that I can quickly decide what deserves attention.

Acceptance criteria:

- Given I own no shares and price enters the first buy zone, when suggestions are generated, then the stock receives "open small position".
- Given I already own shares and price enters a lower support/add-on zone, when risk rules allow it, then the stock receives "add position".
- Given price reaches a configured trim zone or allocation is above the cap, when suggestions are generated, then the stock receives "reduce position".
- Given the stock is sealed, blocked by risk, or data is stale, when suggestions are generated, then the stock receives "hold/no action" with the blocking reason.
- Given multiple signals apply, when suggestions are generated, then risk blocks override buy signals, and reduce signals override add signals when allocation is above cap.

Automation target:

- Unit test recommendation priority and output schema.
- Snapshot test representative suggestions for open, add, hold, reduce, sealed, stale, and risk-blocked cases.

## Story 9: Explain Every Recommendation

As an individual investor, I want each recommendation to show its reason and blocking conditions, so that I can audit the tool instead of blindly following it.

Acceptance criteria:

- Given a recommendation is shown, when I expand it, then I see price, key levels, moving averages, volume note, position state, and risk constraints used.
- Given a recommendation is blocked, when I expand it, then I see the exact rule that blocked it.
- Given data is stale or incomplete, when a recommendation is shown, then the stale or incomplete data warning is visible beside the suggestion.
- Given the app displays "buy", "add", or "reduce" language, then it also displays that this is a rule-based suggestion, not financial advice.

Automation target:

- UI test expandable explanation content.
- Accessibility test warning and disclaimer text presence.

## Story 10: Review Portfolio-Level Summary

As an individual investor, I want a portfolio summary, so that I can see cash, exposure, concentration, and today's actionable items in one place.

Acceptance criteria:

- Given positions and cash are entered, when the dashboard loads, then it shows total portfolio value, cash percentage, invested percentage, and unrealized gain/loss.
- Given one stock or sector exceeds its configured cap, when the dashboard loads, then the concentration warning is visible.
- Given multiple recommendations exist, when the dashboard loads, then actionable items are grouped by reduce, add, open, and hold.
- Given no recommendation needs action, when the dashboard loads, then the primary state is "no action today".

Automation target:

- Unit test summary calculations.
- UI test grouping, warnings, and no-action state.

## Story 11: Work Across Phone And Desktop

As an individual investor, I want the same URL to work on phone and desktop, so that I can check suggestions anywhere.

Acceptance criteria:

- Given I open the app on a phone viewport, when the dashboard loads, then core cards, recommendations, and refresh status are usable without horizontal scrolling.
- Given I open the app on a desktop viewport, when the dashboard loads, then watchlist, summary, and recommendation detail can be viewed efficiently.
- Given the app is installed to a phone home screen, when it opens, then it launches into the same dashboard route.
- Given the device is offline, when I open the app, then cached data and last suggestions remain readable.

Automation target:

- Responsive UI tests for mobile and desktop viewport widths.
- PWA manifest and offline-cache checks.

## Story 12: Sync Settings Across Devices

As an individual investor, I want optional cloud sync for watchlist, positions, and risk rules, so that phone and desktop use the same portfolio model.

Acceptance criteria:

- Given sync is disabled, when I use the app, then all personal data stays local to the device.
- Given sync is enabled and I sign in, when I update watchlist or risk rules on one device, then another device receives the updated configuration after reload.
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

## Story 14: Audit Refresh And Recommendation History

As an individual investor, I want to review previous daily suggestions, so that I can evaluate whether the strategy behaves consistently.

Acceptance criteria:

- Given suggestions are generated, when the refresh completes, then a daily snapshot is stored with timestamp, inputs, and recommendation outputs.
- Given I open history, when snapshots exist, then I can view prior recommendations by date.
- Given storage reaches its configured limit, when a new snapshot is saved, then the oldest snapshot is pruned.
- Given a historical snapshot is viewed, when current settings differ, then the app clearly marks it as historical and not recalculated.

Automation target:

- Unit test snapshot creation and pruning.
- UI test history list and historical-state labeling.

## Story 15: Fail Safely

As an individual investor, I want the app to fail safely when data or rules are uncertain, so that it does not create false confidence.

Acceptance criteria:

- Given market data is missing, stale, or malformed, when suggestions are generated, then the stock receives "no action" with a data-quality warning.
- Given technical indicators conflict, when suggestions are generated, then the app lowers confidence instead of forcing a buy or sell action.
- Given a calculation throws an exception for one ticker, when the watchlist is processed, then other tickers still receive suggestions.
- Given the app detects unknown rule output, when rendering suggestions, then it shows a safe fallback and logs a diagnostic event.

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
