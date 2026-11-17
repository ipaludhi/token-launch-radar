# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ipaludhi/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ipaludhi/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of every protocol, finds the ones that record no token and are not a wrapped, staked or bridged product, ranks them by an implied launch value from a comparables model fitted on the tokens that already trade, and hands in a dashboard with a farm plan for every protocol, netted to the dollar.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only, no network. The program reads `snapshot.json`, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, and exits non-zero when the board fails the gate. Run it twice into two directories: the outputs are byte for byte identical.

## The model (radar-2)

Implied value is a comparables model fitted from the snapshot itself at run time:

- The comps are the 94 traded protocols in the same snapshot: market cap above zero, TVL above zero, no exchange, bridge or liquid-staking category.
- A log-log size curve is fitted by least squares: `log(market cap) = 8.998 + 0.405 * log(TVL)`, R-squared 0.103. Size explains only part of value, which is why the curve is a curve and not a flat multiple.
- Each category gets an adjustment from the curve's residuals: the median residual, shrunk by n / (n + 5) toward zero and clamped to [-0.75, 0.75] log units.
- Seven-day growth and age enter only as small bounded priors (growth at most 12%, age at most 10%): fitting them as regression terms did not help — leave-one-out 1.295 without them against 1.295 with them, walk-forward 0.734 against 1.703.

Validation, computed at run time from the same snapshot: leave-one-out median absolute log error 1.226, walk-forward (fit before 2024, test after) median 0.736. A log error of 0.74 means the typical prediction is within about a factor of 2 either way: the board ranks protocols, it does not price them.

The board ranks 203 pre-token protocols: the 40 on the watchlist plus 163 early rows below the floor. Exchanges, bridges and liquid-staking or restaking products are never ranked, and neither are versioned pools. Live-token protocols are set aside with their market caps shown.

## Farm plans

Every row carries a 7-step farm plan with a cost and a time per step, and a netting: gas priced per transaction by chain (Ethereum $4.00, Bitcoin $1.00, Tron $0.50, Binance, Base, Arbitrum, Optimism, Polygon and Avalanche $0.30, Hyperliquid L1 and Monad $0.10, Solana and Sui $0.05, Stellar $0.01, anything else $0.50), capital deployed and returned at unwind, and a verdict — FARM when the expected share covers the net cost 3 times over, THIN when it covers it once, SKIP when it does not. The expected share assumes 5% of the implied value goes to farmers, shared by 10,000 farmers. The dashboard recomputes every row's implied value and netting from the same function and checks them against `board.json`.

---

Entered on [make.fun](https://make.fun/?ref=e182s7fp&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
