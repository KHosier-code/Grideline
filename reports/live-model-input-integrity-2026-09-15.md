# Gridline live model input integrity audit

Generated from the development database on 2026-09-15 at 01:36 UTC.

## Verdict

- **Existing Phase 6 models:** not valid for further production inference. The three promoted run records do not contain the ordered training schema, preprocessing statistics, or immutable fitted parameters needed to prove or reproduce their original behavior.
- **Upcoming feature coverage:** healthy after repair. All 32 upcoming games have two correctly paired `pregame-v3` rows, complete diagnostic inputs, finite values, and populated Phase 6 QB confidence.
- **Prediction eligibility:** 0 of 32 upcoming games are eligible because the active legacy model contract is unverified. No new snapshot was created by the final audit.
- **Consumer trustworthiness:** current upcoming projections are not trustworthy and are suppressed. Consumers receive **“Prediction pending — incomplete model inputs.”**
- **Model lifecycle evidence:** the selected runs were trained at 2026-09-14 12:30 UTC and promoted between 16:32 and 16:34 UTC. Each selected run reports `immutableArtifactAvailable: false`. The audit did not train, replace, or promote a model.

## Root causes and fixes

1. The live builder previously received a complete vector-name list and appended the three derived fields again. The boundary now separates selected source features from the two low-sample fields and QB-confidence difference.
2. Missing selected values and missing QB confidence were converted to diagnostic zeroes. They now remain unavailable, carry explicit reasons, and block model execution and snapshot persistence. Observed zeroes are counted separately.
3. Schedule/team rows use canonical ESPN team IDs while nflverse history uses abbreviations. Feature history, QB history, and score joins now normalize at the source boundary, including `WAS`/`WSH`.
4. Future-row cutoffs previously represented the full pre-kickoff window (`kickoff - 1ms`) even when the row was generated days earlier. Future rebuilds now cap the cutoff at the actual generation time, and generation rejects any row cutoff later than inference time.
5. Prediction snapshots now support immutable ordered feature names, a schema fingerprint, the exact raw vector, and cutoff-safe source evidence. Every grading, performance, drift, lifecycle, detail, weekly-report, and consumer path requires complete v3 provenance; existing rows remain excluded.
6. The prior inference path refit models from mutable historical rows under an existing model version. Inference now accepts only persisted preprocessing statistics and fitted parameters. The current promoted runs predate that contract, so production fails closed rather than refitting or assuming their provenance.
7. Future training runs persist their exact schema, fingerprint, preprocessing statistics, and fitted model artifact. Promotion rejects absent artifacts and same-width name/order drift.
8. Phase 7 projected-starter and QB evidence remains audit-only validation. No Phase 7-only field enters a Phase 6 vector.

## Future-game pregame-v3 health

- Games considered by the rebuild: 1,493
- Rows generated: 2,986
- Upcoming games audited: 32
- Upcoming games with complete diagnostic vectors: 32
- Distinct diagnostic vectors: 32
- Upcoming games eligible for production inference: 0
- Valid current-model snapshots: 0

The feature build remains cutoff-safe: only completed source rows strictly before the target kickoff are eligible. Each administrator record includes game/team identity, row cutoffs, selected-feature evidence, QB evidence, personnel completeness, sample quality, and an explicit schema/artifact failure.

## QB confidence findings

The reported 0% confidence symptom was not a legitimate measured zero. Missing QB evidence had been defaulted to numeric zero, and identifier mismatches prevented historical QB rows from joining. Missing QB confidence now remains unavailable with an explicit reason and blocks prediction. After identifier normalization, all 32 upcoming games have populated diagnostic Phase 6 QB confidence.

## Phase 7 / Phase 6 boundary

Projected starter identity, evidence classification, QB certainty, personnel completeness, and sample quality are displayed only to administrators. These values validate and explain Phase 6 input availability; they are not added to the model vector.

## Three real upcoming diagnostic vectors

The legacy promotions do not prove their trained ordering, so these are explicitly labeled **diagnostic-only, unverified legacy-contract vectors**. They demonstrate that repaired upcoming rows are game-specific; they are not represented as inputs to a trustworthy active model.

### Game `401872932`

```json
[-0.08122715136895398,0.2789308077610616,0.09037690685123786,0.04576287909621245,0.019248963130331975,0.04179279899094138,-0.019078318307770365,1.4264013155969426,0.02561706610367742,0.14993183943828192,0.04131341169831629,0.04687985571706503,0.04841555682011439,0.042810926603496224,-0.008744288281959518,0.7023148931955232,-0.015254736078216258,0.08918402443033645,0.02550806835908251,0.008735575896762743,0.04602050189839063,-0.012278258592113095,-0.005339076771432768,0.01605341284286066,1,1,0]
```

### Game `401872937`

```json
[-0.07660159091430152,0.27248822823683094,0.16202746306344962,-0.010453809315289386,0.09834366848782827,-0.0035714285714285587,0.015069914901904147,2.0162657151133594,-0.10614850783076346,0.2075202985782213,0.06931119970790409,0.005773224079426015,0.05935894939803149,-0.0376984126984127,0.0020029470745544127,1.5142957292939716,-0.07354818403219743,0.27409770910070497,0.07526704064017103,-0.0073024541331367515,0.0760175233020619,-0.03492514430014432,-0.015118382057323127,1.6007963906561367,1,1,0]
```

### Game `401872939`

```json
[0.0009242128917585912,-0.19077686429988752,-0.04957912349216698,-0.012918407128933468,-0.04048745013661109,0.10923520923520921,0.005542593719708754,-0.9696219767409229,-0.01848229339478913,-0.08689250658478515,-0.030366780832515733,-0.0031356596619754457,0.002710835386157573,0.06841991341991341,0.0033255562318252525,-0.11743546422282325,-0.047283487961277126,-0.11281782153670585,-0.05459478459617362,-0.007693577903626653,-0.043969003027625186,0.0742902236652237,-0.006079124965831828,-0.7179559458193685,1,1,0]
```

These three vectors differ; the full audit found 32 distinct diagnostic vectors across 32 upcoming games.

## Operational behavior

- Administrators can inspect every upcoming game at the protected live-input-integrity endpoint and on Feature Audit.
- Causes include absent rows, identity mismatch, stale or invalid cutoffs, schema/version mismatch, missing selected values, QB evidence failure, and missing immutable model artifacts.
- Consumer endpoints never expose feature names or technical evidence.
- Numerically plausible legacy or development snapshots remain excluded unless their exact vector, ordered schema, fingerprint, active model versions, and immutable fitted artifacts all validate.