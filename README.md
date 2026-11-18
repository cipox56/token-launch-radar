# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cipox56/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cipox56/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that still record no token and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth. The result is a static dashboard with the ranked board, a detail view per protocol, and a concrete farm plan for each.

## Model (radar-4)

Implied value is priced from the snapshot itself: each token-trading protocol's mcap/TVL is winsorized to [0.005, 5], the category median is shrunk toward the market median by n / (n + 3) so a thin category cannot decide a rank, and the result is multiplied by TVL, a growth factor from the seven-day change clamped to [-40, 60], and a maturity factor for how long the protocol has run with no token. Stable-asset protocols (CDP, dual-token stablecoin, stablecoin wrapper) are halved, because their TVL is largely the pegged asset's own supply. No protocol name is special-cased.

The model is tested, not just stated. A leave-one-out validation hides each of the 94 live comparables in turn, reprices it from the rest with the same rules (no growth multiplier — a live token's 7d move is a market move, not a launch signal), and compares with its real market cap: median absolute error 89.16%, 24.47% of predictions within 2x, 15.96% within 1.5x. The same test with a flat overall multiple gives 88.48% / 29.79% / 19.15% — on this snapshot the category adjustment does not beat the flat multiple, and the dashboard says so. Each rank also carries a bootstrap range (p10–p90 over 100 refits, resampling comparable ratios within each category, seeded deterministically from the snapshot date), so a rank reads as e.g. "Rank 12 (9–18)".

Each farm plan is built from the protocol's own record: the funding step follows its main chain, the core, weekly, milestone, eligibility-check and exit steps follow its category's own mechanics, and a multi-chain protocol's weekly step repeats the core action once on its second chain. Every step carries a cost and a time. The plan is also netted to the dollar: total gas is setup gas + weekly gas × hold weeks + exit gas (Ethereum 8/8/5/8, Solana 1/1/1/1, Tron 2/2/2/2, Bitcoin 5/5/3/5, L2s 1/2/1/2, default 3/5/2/5), stated against the capital at risk, with a verdict of FARM (gas under 5% of capital), THIN (5–20%) or SKIP (over 20%).

Each farm plan is built from the protocol's own record: the funding step follows its main chain, the core, weekly, milestone, eligibility-check and exit steps follow its category's own mechanics, and a multi-chain protocol's weekly step repeats the core action once on its second chain. Every step carries a cost and a time.

## Run it

```sh
node main.ts
```

It reads the sealed snapshot from `/input/snapshot.json` (or `--input <snapshot.json|directory>`) and writes the ranked board to `/output/board.json`, the dashboard data to `/output/data.js`, and the judge's summary to `/output/dossier.json`. Outside the grader's container, set `MAKEFUN_OUTPUT_DIR` to choose where the output goes:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
