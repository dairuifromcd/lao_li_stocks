# Lao Li Stocks

A local-first stock watchlist and technical observation tracker inspired by Lao Li's left-side workflow. It refreshes daily market data, calculates repeatable technical references, and separates approaching, waiting-confirmation, technical-ready, pressure, and broken-structure states.

This is a decision-support tool. It does not record positions, calculate order size, manage cash, place orders, or provide financial advice.

## Market Data

- The app uses Alpha Vantage `TIME_SERIES_DAILY` with `outputsize=compact`, which is available to free API keys.
- Displayed prices are the latest complete daily close returned by the provider, not live intraday quotes.
- The free compact response contains up to 100 daily bars. The app supplements it with split/dividend-adjusted weekly history, caches that history for a week, and uses weekly MA40 as the long-term reference when daily MA120/MA250 are unavailable.
- SPY and a sector ETF provide a weekly market-environment filter. A three-month earnings calendar is cached for seven days and blocks a ready signal during the seven days before a known report.
- Free-tier requests are spaced by at least 1.2 seconds. A burst-limit response receives one delayed retry, while same-day cache hits make no API request.
- A refresh is capped at 24 requests. Daily calls cover only watchlist stocks; benchmark ETFs use the weekly cache. The current free quota is 25 requests per day, so avoid repeatedly clearing the browser cache or changing the device clock.
- Without provider or cached data, prices display as `N/A` and signals remain in continue-observing. The app never generates synthetic market prices.

## Observation Levels

- Automatic support and resistance require a price cluster that was tested at least twice in the latest 90 daily bars.
- Support is always at or below the latest close. A tested level above the latest close is treated as broken support and potential resistance, never as a low observation trigger.
- A deeper automatic support must be another tested price cluster. The app does not project a level from a fixed percentage or use a moving average as a substitute for price structure.
- Manual levels are optional. A manual low, deep, or pressure level overrides only the matching automatic category.
- A manual level can store its technical basis, daily/weekly timeframe, invalidation price, and confirmation date.
- An invalidated manual level stays saved and is flagged for review. The app does not silently rewrite it or substitute the same automatic category.

## Technical Conditions

`技术条件满足` appears only when all seven checks pass: reliable daily and adjusted-weekly data, valid support, price inside the directional observation buffer, at least two of three confirmations (price stabilization, volume, MA60), acceptable SPY/sector environment, no known earnings within seven days, and a minimum 2:1 room-to-invalidation-risk ratio. This state is a review reminder, not a buy instruction.

The app stores one signal snapshot per trading day and shows the latest seven dates. Up to 180 dates are retained locally so rule changes can be reviewed against prior outputs.

## Local Development

```bash
npm install
npm run dev
```

Production verification:

```bash
npm run test
npm run build
```

The Alpha Vantage API key, watchlist, manual levels, settings, daily/weekly caches, earnings calendar, and signal history are currently stored in browser `localStorage`. Cross-device sync and production deployment are not implemented yet.

See [docs/user-stories.md](docs/user-stories.md) for the current acceptance criteria.
