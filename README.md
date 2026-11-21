# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/anchorite2006/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/anchorite2006/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0: `run(input)` returns exactly
csv-reader's `{columns, rows, errors}` for every `{text, header}` input —
including its broken-row policy (stray CRs, quote junk, unterminated quotes,
short/long rows, blank lines, BOM) — but scans with slices and `indexOf`
instead of one character at a time.

On the practice set (6 cases, ~10.2 MB of CSV) it runs at about 4x the CPU
time of the house baseline csv-reader 1.0.0, measured locally with paired
interleaved runs.

## Layout

- `solve.js` — the parser: an ES module exporting `run(input)`.
- `main.ts` — the driver: reads `/input/cases.json`, answers each case with
  `run`, writes `/output/answers.json` (the house baseline's driver, kept as
  shipped, including `--no-incremental-marking`).

## Run it locally

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

Node 22 or later. No dependencies, no network, no build step.
