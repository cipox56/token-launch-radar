# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cipox56/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cipox56/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that still record no token and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth. The result is a static dashboard with the ranked board, a detail view per protocol, and a concrete farm plan for each.

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
