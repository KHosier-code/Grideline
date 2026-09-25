# Gridline 2025 Personnel-Aware Challenger Comparison

## Task 82 rerun status — blocked on September 25, 2026

**The numerical results below are the previously retained comparison, not a newly reproduced rerun.** The existing development-only comparison command stopped before personnel preflight or model fitting with `No persisted accepted 2025 market baseline exists`. A separate read-only development query of `market_baseline_runs` returned no rows for season 2025. The runner requires the accepted run and its event, quote, and game-level prediction evidence to enforce exact per-family pairing. The prior run ID in the report is not a substitute for those persisted rows.

In accordance with the stop rule, no alternative baseline or game set was substituted and no new statistical or per-game results were generated. The retained machine-readable report at `reports/gridline-2025-personnel-comparison.json` was left byte-for-byte unchanged (SHA-256 `4a94b018ffb377fd445abf9707360dbc597968f02fc63d172baa29aebfc4bc2c`). It preserves the earlier numerical results, but it does **not** include individual paired predictions; their differences cannot be reconstructed from these aggregates. The current development database therefore cannot independently verify those values or the historical personnel contexts. The verdicts below are historical, not a successful Task 82 rerun.

**To unblock a future evaluation:** make the exact accepted baseline run and associated immutable market/evaluation evidence available in a non-production evaluation database under a separately approved data-restoration plan. Then rerun the existing command with its retained-report fingerprint guard and strict preflight. Do not rewrite historical records, change model artifacts, or infer unavailable evidence from current data.

**Baseline run:** `phase6-1-2025-market-baseline-v4-bc87373a5d1a-f289a18f99c4`  
**Training:** 2021–2024 only  
**Test season:** 2025 only  
**Personnel chronology:** strictly before kickoff  
**Tuning, promotion, production-model changes, or production-prediction mutation:** None

## Family verdicts

| Family | Paired games | Baseline | Challenger | Raw difference | Improvement | Verdict |
|---|---:|---|---|---|---:|---|
| spread | 277 | mae 10.2677 | mae 10.2627 | -0.0050 | 0.05% | **NO MATERIAL IMPROVEMENT** |
| moneyline | 277 | logLoss 0.6335 | logLoss 0.6345 | 0.0010 | -0.16% | **NO MATERIAL IMPROVEMENT** |
| totals | 230 | mae 10.9452 | mae 10.9452 | 0.0000 | 0.00% | **NO MATERIAL IMPROVEMENT** |

Paired intervals are descriptive normal-approximation 95% intervals using sample variance. Improve/worse requires at least 30 paired games and the full interval to exceed 1% of the baseline primary metric; otherwise the verdict is no material improvement. No betting threshold was selected from these results.

## Spread

### Metrics

```json
{
  "baseline": {
    "sampleSize": 277,
    "mae": 10.267708651779436,
    "rmse": 13.274101462983571
  },
  "challenger": {
    "sampleSize": 277,
    "mae": 10.262731081141151,
    "rmse": 13.251575509636119
  },
  "comparison": {
    "mae": {
      "baseline": 10.267708651779436,
      "challenger": 10.262731081141151,
      "difference": -0.0049775706382853,
      "improvementPercent": 0.048477910769533436
    },
    "rmse": {
      "baseline": 13.274101462983571,
      "challenger": 13.251575509636119,
      "difference": -0.022525953347452443,
      "improvementPercent": 0.16969851714836423
    }
  },
  "pairedDelta": {
    "mae": {
      "sampleSize": 277,
      "mean": -0.00497757063829298,
      "low": -0.028329094198366316,
      "high": 0.01837395292178036,
      "status": "descriptive_95_percent_interval"
    }
  }
}
```

### Recorded-market benchmark

The retained benchmark is source-designated recorded; not verified closing.

```json
{
  "designation": "source-designated recorded; not verified closing",
  "sampleSize": 277,
  "mae": 9.660649819494585,
  "rmse": 12.237717632466667
}
```

Baseline record: 112-111-1 (53 no-bets; 50.22% graded win rate).
Challenger record: 114-112-1 (50 no-bets; 50.44% graded win rate).

Baseline and challenger edge buckets are retained in the JSON report.

## Moneyline

### Metrics

```json
{
  "baseline": {
    "sampleSize": 277,
    "accuracy": 0.6245487364620939,
    "brierScore": 0.22228888249768036,
    "logLoss": 0.6334879648011796
  },
  "challenger": {
    "sampleSize": 277,
    "accuracy": 0.6137184115523465,
    "brierScore": 0.22284179482393304,
    "logLoss": 0.6345066130235545
  },
  "comparison": {
    "accuracy": {
      "baseline": 0.6245487364620939,
      "challenger": 0.6137184115523465,
      "difference": -0.010830324909747335,
      "improvementPercent": -1.7341040462427812
    },
    "logLoss": {
      "baseline": 0.6334879648011796,
      "challenger": 0.6345066130235545,
      "difference": 0.0010186482223748516,
      "improvementPercent": -0.16079993290710023
    },
    "brierScore": {
      "baseline": 0.22228888249768036,
      "challenger": 0.22284179482393304,
      "difference": 0.0005529123262526803,
      "improvementPercent": -0.24873593318750437
    }
  },
  "pairedDelta": {
    "brierScore": {
      "sampleSize": 277,
      "mean": 0.0005529123262528771,
      "low": -0.0010632501285658099,
      "high": 0.002169074781071564,
      "status": "descriptive_95_percent_interval"
    },
    "logLoss": {
      "sampleSize": 277,
      "mean": 0.001018648222374395,
      "low": -0.0023911084143920474,
      "high": 0.004428404859140837,
      "status": "descriptive_95_percent_interval"
    }
  }
}
```

### Recorded-market benchmark

The retained benchmark is source-designated recorded; not verified closing.

```json
{
  "designation": "source-designated recorded; not verified closing",
  "sampleSize": 277,
  "accuracy": 0.6714801444043321,
  "brierScore": 0.20681192263359421,
  "logLoss": 0.5979623221382667
}
```

Baseline and challenger 10-point calibration buckets are retained in the JSON report.

## Totals

### Metrics

```json
{
  "baseline": {
    "sampleSize": 230,
    "mae": 10.945155216456653,
    "rmse": 13.874126443492935
  },
  "challenger": {
    "sampleSize": 230,
    "mae": 10.945155216456653,
    "rmse": 13.874126443492935
  },
  "comparison": {
    "mae": {
      "baseline": 10.945155216456653,
      "challenger": 10.945155216456653,
      "difference": 0,
      "improvementPercent": 0
    },
    "rmse": {
      "baseline": 13.874126443492935,
      "challenger": 13.874126443492935,
      "difference": 0,
      "improvementPercent": 0
    }
  },
  "pairedDelta": {
    "mae": {
      "sampleSize": 230,
      "mean": 1.2357264969740873e-16,
      "low": -2.4204703284835664e-17,
      "high": 2.713500026796531e-16,
      "status": "descriptive_95_percent_interval"
    }
  }
}
```

### Recorded-market benchmark

The retained benchmark is source-designated recorded; not verified closing.

```json
{
  "designation": "source-designated recorded; not verified closing",
  "sampleSize": 230,
  "mae": 10.126086956521739,
  "rmse": 13.018966097999854
}
```

Baseline record: 84-98-0 (48 no-bets; 46.15% graded win rate).
Challenger record: 84-98-0 (48 no-bets; 46.15% graded win rate).

Baseline and challenger edge buckets are retained in the JSON report.

## Personnel evidence availability and limitations

Source availability is counted from underlying pre-cutoff rows, not from derived numeric values. Under the unchanged feature contract, some empty injury-unit summaries derive to zero; those are disclosed separately and are not counted as source observations.

### injury

Availability: 0/554 observations (0.00%).
- Replacement quality is unavailable; injury impact is limited to pre-cutoff designations, participation, and starter likelihood.
- A derived zero with no underlying injury rows means no supported pre-cutoff injury impact was found; it does not prove a complete injury feed.

### qbStarter

Availability: 538/554 observations (97.11%).
- A projected starter may be inferred from prior participation when a published depth source is unavailable.

### depth

Availability: 538/554 observations (97.11%).
- Historical depth and snap-count inference are fallbacks; they are not official depth charts.

### offensiveLine

Availability: 0/554 observations (0.00%).
- Continuity is a recent-snap proxy; replacement quality and complete snap burden are unavailable.

### secondaryCornerback

Availability: 0/554 observations (0.00%).
- Direct cornerback assignments and player-vs-player coverage are unavailable.
- Unit-level derived zeroes without an underlying secondary injury row are not counted as available evidence.

### rosterTrade

Availability: 0/554 observations (0.00%).
- No immutable point-in-time roster transaction or trade feed is included; no roster/trade value was imputed.

## Reproducibility and safeguards

- Exact same-game pairing is enforced independently for spread, moneyline, and totals.
- Personnel source cutoffs must be strictly before kickoff.
- Output ordering and serialization are deterministic.
- No tuning, promotion, production-model change, or production-prediction mutation occurred.
- The comparison remains evaluation-only and does not persist challenger evidence as new database rows.
