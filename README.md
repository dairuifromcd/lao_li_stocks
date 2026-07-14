# Lao Li Stocks

A local-first stock watchlist and technical observation tracker inspired by Lao Li's left-side workflow. It refreshes daily market data, calculates repeatable technical references, and highlights low, deep, pressure, or continue-observing states.

This is a decision-support tool. It does not record positions, calculate order size, manage cash, place orders, or provide financial advice.

## Market Data

- The app uses Alpha Vantage `TIME_SERIES_DAILY` with `outputsize=compact`, which is available to free API keys.
- Displayed prices are the latest complete daily close returned by the provider, not live intraday quotes.
- The free compact response contains up to 100 daily bars. MA120 and MA250 remain unavailable until a longer-history data source is added, and the app reports that limitation.
- Free-tier requests are spaced by at least 1.2 seconds. A burst-limit response receives one delayed retry, while same-day cache hits make no API request.
- The current free quota is 25 requests per day, so avoid repeatedly clearing the browser cache or changing the device clock.
- Without provider or cached data, prices display as `N/A` and signals remain in continue-observing. The app never generates synthetic market prices.

## Observation Levels

- Automatic mode works immediately using recent swing lows/highs, MA60/120/250, volume behavior, and configured buffers.
- Manual levels are optional. A manual low, deep, or pressure level overrides only the matching automatic category.
- A manual level can store its technical basis, daily/weekly timeframe, invalidation price, and confirmation date.
- An invalidated manual level stays saved and is flagged for review. The app does not silently rewrite it or substitute the same automatic category.

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

The Alpha Vantage API key, watchlist, manual levels, settings, and market cache are currently stored in browser `localStorage`. Cross-device sync and production deployment are not implemented yet.

See [docs/user-stories.md](docs/user-stories.md) for the current acceptance criteria.
