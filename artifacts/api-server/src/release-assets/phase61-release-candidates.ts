/**
 * Exact already-fitted Phase 6.1 candidate rows approved for production import.
 * Generated from checksum-verified development records; never regenerate at runtime.
 */
export const PHASE61_RELEASE_CANDIDATES = [
  {
    "notes": "Phase 6 production refit of the unchanged selected Phase 4 algorithm using legitimate 2021-2025 data only. 2026 remains forward/out-of-sample. Administrator promotion required.",
    "family": "moneyline",
    "status": "refit_candidate",
    "metrics": {
      "status": "2025_holdout",
      "holdoutMetrics": {
        "logLoss": 0.6338545756226889,
        "accuracy": 0.6175438596491228,
        "brierScore": 0.22248731123956536,
        "sampleSize": 285,
        "calibration": [
          {
            "bucket": "0-9%",
            "actualRate": null,
            "predictions": 0,
            "predictedProbability": null
          },
          {
            "bucket": "10-19%",
            "actualRate": 0,
            "predictions": 3,
            "predictedProbability": 0.17400384258922497
          },
          {
            "bucket": "20-29%",
            "actualRate": 0.17391304347826086,
            "predictions": 23,
            "predictedProbability": 0.2597178307156971
          },
          {
            "bucket": "30-39%",
            "actualRate": 0.45454545454545453,
            "predictions": 44,
            "predictedProbability": 0.3597027994113786
          },
          {
            "bucket": "40-49%",
            "actualRate": 0.4153846153846154,
            "predictions": 65,
            "predictedProbability": 0.4519848806144351
          },
          {
            "bucket": "50-59%",
            "actualRate": 0.4838709677419355,
            "predictions": 62,
            "predictedProbability": 0.5452609009531045
          },
          {
            "bucket": "60-69%",
            "actualRate": 0.5932203389830508,
            "predictions": 59,
            "predictedProbability": 0.6461292264224547
          },
          {
            "bucket": "70-79%",
            "actualRate": 0.9130434782608695,
            "predictions": 23,
            "predictedProbability": 0.7500860296289464
          },
          {
            "bucket": "80-89%",
            "actualRate": 1,
            "predictions": 6,
            "predictedProbability": 0.8359761421192274
          },
          {
            "bucket": "90-100%",
            "actualRate": null,
            "predictions": 0,
            "predictedProbability": null
          }
        ]
      },
      "outputValidation": "finite",
      "holdoutSampleSize": 285,
      "trainingSampleSize": 1408,
      "comparisonThreshold": "10% relative metric band; moneyline accuracy 2.5 percentage-point band",
      "historicalReference": {
        "logLoss": 0.633853,
        "accuracy": 0.617544,
        "brierScore": 0.222487,
        "sampleSize": 285
      },
      "forwardSeasonsExcluded": [
        2026
      ],
      "holdoutTrainingSampleSize": 1123,
      "historicalComparisonClassification": "materially_consistent"
    },
    "algorithm": "logistic_regression",
    "trained_at": "2026-09-15T02:14:52.376931+00:00",
    "calibration": {
      "note": "Only 2025 holdout outcomes were used for comparison; no 2026 outcomes were used.",
      "status": "holdout_only"
    },
    "sample_size": 1408,
    "test_season": 2025,
    "model_version": "phase6-1-moneyline-917fa6e7417cccb45909ade4",
    "sample_policy": "include_low_sample",
    "model_artifact": {
      "model": {
        "kind": "logistic",
        "coefficients": [
          0.0544471628789121,
          0.07982974085407593,
          0.07074163114752889,
          -0.05064824685991253,
          -0.029444282469201152,
          -0.035874009276929034,
          -0.08878512287599788,
          0.07494535259741342,
          0.08836261737301286,
          0.13307889315917865,
          0.08458662220597508,
          -0.020479960102816167,
          0.008014028366507872,
          0.07728325609555717,
          0.008049475142109878,
          -0.026485110857046378,
          0.01117333713821909,
          0.04447782438041863,
          0.17985284914835872,
          -0.0128532381486634,
          -0.042512459388080424,
          0.15673991763761116,
          -0.03235954966304605,
          0.052490917264165805,
          0.1735954116933964,
          -0.06347743532505602,
          -0.06347743532505602,
          0
        ]
      },
      "scales": [
        0.06668323470073105,
        0.18508218716492833,
        0.06477514722530534,
        0.055348894890193415,
        0.0695710563957643,
        0.1251023059838258,
        0.01516395634175677,
        1.0731402060312418,
        0.055004570863795524,
        0.1601362949599934,
        0.0540647841367203,
        0.04464635216139575,
        0.05942628491193689,
        0.09808384889382114,
        0.012084518399985866,
        0.9202409223250388,
        0.04763187469578081,
        0.14176024751194755,
        0.047541002739691536,
        0.038015735949582394,
        0.05314573395396916,
        0.08136555142864584,
        0.009934728938361038,
        0.8190710693696536,
        0.38569460791993954,
        0.38569460791993954,
        1
      ],
      "centers": [
        0.0006976062687816351,
        0.0025951531072654684,
        0.0006609187923366192,
        0.0012220035764966936,
        0.00030438842704489467,
        -0.002943155716361941,
        0.00020182484560873177,
        0.006086370042437362,
        0.0001647762360204119,
        0.0038807965302629223,
        -0.000027359350279286757,
        0.0011446101323805814,
        0.0009538141462434436,
        -0.0008429358541963296,
        -0.000014111230510320278,
        0.011800149195932313,
        -0.00014081515295504118,
        0.002330983316218569,
        -0.00012625888977704203,
        0.000009883481364051748,
        0.0007572294023975766,
        -0.0014392059811647942,
        0.00009160658582094896,
        0.0023229837540356835,
        0.18181818181818182,
        0.18181818181818182,
        0
      ],
      "version": 1,
      "metadata": {
        "family": "moneyline",
        "algorithm": "logistic_regression",
        "createdAt": "2026-09-15T02:14:49.416Z",
        "artifactId": "phase6-1-moneyline-917fa6e7417cccb45909ade470c997d0",
        "randomSeed": null,
        "samplePolicy": "include_low_sample",
        "featureVersion": "pregame-v3",
        "trainingCutoff": "2026-02-08T12:00:00.000Z",
        "hyperparameters": {
          "epochs": 350,
          "learningRate": 0.08,
          "coefficientRegularization": 0.02
        },
        "runtimeVersions": {
          "v8": "13.6.233.17-node.37",
          "node": "v24.13.0",
          "modeling": "phase6.1"
        },
        "trainingSeasons": [
          2021,
          2022,
          2023,
          2024,
          2025
        ],
        "artifactChecksum": "917fa6e7417cccb45909ade470c997d0841fe8a010bc18899f4b5b913be4d6ae",
        "vectorFeatureNames": [
          "last_3.defensive_success_rate",
          "last_3.epa_per_play",
          "last_3.explosive_pass_rate",
          "last_3.explosive_rush_rate",
          "last_3.offensive_success_rate",
          "last_3.red_zone_touchdown_rate",
          "last_3.turnover_rate",
          "last_3.yards_per_play",
          "last_5.defensive_success_rate",
          "last_5.epa_per_play",
          "last_5.explosive_pass_rate",
          "last_5.explosive_rush_rate",
          "last_5.offensive_success_rate",
          "last_5.red_zone_touchdown_rate",
          "last_5.turnover_rate",
          "last_5.yards_per_play",
          "last_8.defensive_success_rate",
          "last_8.epa_per_play",
          "last_8.explosive_pass_rate",
          "last_8.explosive_rush_rate",
          "last_8.offensive_success_rate",
          "last_8.red_zone_touchdown_rate",
          "last_8.turnover_rate",
          "last_8.yards_per_play",
          "home_low_sample",
          "away_low_sample",
          "qb_confidence_difference"
        ],
        "trainingSampleCount": 1408,
        "vectorSchemaFingerprint": "d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42"
      },
      "algorithm": "logistic_regression"
    },
    "feature_version": "pregame-v3",
    "training_seasons": [
      2021,
      2022,
      2023,
      2024,
      2025
    ],
    "recency_weighting": "none",
    "feature_importance": {
      "away_low_sample": 0.03712958592202717,
      "home_low_sample": 0.03712958592202717,
      "last_3.epa_per_play": 0.04137860104943062,
      "last_5.epa_per_play": 0.049476892709480795,
      "last_8.epa_per_play": 0.1052005611376594,
      "last_3.turnover_rate": 0.043837465935298914,
      "last_5.turnover_rate": 0.015491823105098806,
      "last_8.turnover_rate": 0.030703288699450042,
      "last_3.yards_per_play": 0.05168556948222287,
      "last_5.yards_per_play": 0.006535572509898291,
      "last_8.yards_per_play": 0.10154042489481994,
      "qb_confidence_difference": 0,
      "last_3.explosive_pass_rate": 0.029625463347018193,
      "last_3.explosive_rush_rate": 0.01722271875437774,
      "last_5.explosive_pass_rate": 0.011979255847739782,
      "last_5.explosive_rush_rate": 0.004687611484176711,
      "last_8.explosive_pass_rate": 0.007518189853973184,
      "last_8.explosive_rush_rate": 0.024866631827883,
      "last_3.defensive_success_rate": 0.04669447035779338,
      "last_3.offensive_success_rate": 0.020983631474625283,
      "last_5.defensive_success_rate": 0.07784127025074696,
      "last_5.offensive_success_rate": 0.04520496587235879,
      "last_8.defensive_success_rate": 0.026016224403220736,
      "last_8.offensive_success_rate": 0.09168121253695294,
      "last_3.red_zone_touchdown_rate": 0.05193270382681759,
      "last_5.red_zone_touchdown_rate": 0.004708345215677265,
      "last_8.red_zone_touchdown_rate": 0.01892793357922441
    },
    "vector_feature_names": [
      "last_3.defensive_success_rate",
      "last_3.epa_per_play",
      "last_3.explosive_pass_rate",
      "last_3.explosive_rush_rate",
      "last_3.offensive_success_rate",
      "last_3.red_zone_touchdown_rate",
      "last_3.turnover_rate",
      "last_3.yards_per_play",
      "last_5.defensive_success_rate",
      "last_5.epa_per_play",
      "last_5.explosive_pass_rate",
      "last_5.explosive_rush_rate",
      "last_5.offensive_success_rate",
      "last_5.red_zone_touchdown_rate",
      "last_5.turnover_rate",
      "last_5.yards_per_play",
      "last_8.defensive_success_rate",
      "last_8.epa_per_play",
      "last_8.explosive_pass_rate",
      "last_8.explosive_rush_rate",
      "last_8.offensive_success_rate",
      "last_8.red_zone_touchdown_rate",
      "last_8.turnover_rate",
      "last_8.yards_per_play",
      "home_low_sample",
      "away_low_sample",
      "qb_confidence_difference"
    ],
    "vector_schema_fingerprint": "d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42"
  },
  {
    "notes": "Phase 6 production refit of the unchanged selected Phase 4 algorithm using legitimate 2021-2025 data only. 2026 remains forward/out-of-sample. Administrator promotion required.",
    "family": "spread",
    "status": "refit_candidate",
    "metrics": {
      "status": "2025_holdout",
      "holdoutMetrics": {
        "mae": 10.199152425068617,
        "rmse": 13.240022649749672,
        "lowQbMae": 0,
        "highQbMae": 10.199152425068617,
        "sampleSize": 285
      },
      "outputValidation": "finite",
      "holdoutSampleSize": 285,
      "trainingSampleSize": 1408,
      "comparisonThreshold": "10% relative metric band; moneyline accuracy 2.5 percentage-point band",
      "historicalReference": {
        "mae": 10.1982,
        "rmse": 13.2414,
        "sampleSize": 285
      },
      "forwardSeasonsExcluded": [
        2026
      ],
      "holdoutTrainingSampleSize": 1123,
      "historicalComparisonClassification": "materially_consistent"
    },
    "algorithm": "linear_regression",
    "trained_at": "2026-09-15T02:14:52.368167+00:00",
    "calibration": {
      "status": "not_applicable"
    },
    "sample_size": 1408,
    "test_season": 2025,
    "model_version": "phase6-1-spread-01c85917b47c6e70c258fe02",
    "sample_policy": "include_low_sample",
    "model_artifact": {
      "model": {
        "kind": "linear",
        "coefficients": [
          2.260653409090909,
          0.38500740629723323,
          0.4160540466098619,
          -0.1465896217792599,
          -0.11989903295930766,
          0.1782819516751348,
          -0.4069511998726437,
          0.07918653988244552,
          0.3593914549266861,
          0.6305893066796355,
          0.5165125357648649,
          -0.06355582711775669,
          0.09148522012256596,
          0.4184602256367323,
          -0.133034138703084,
          -0.02060120248337818,
          0.4199632652139465,
          0.39874238858610017,
          0.7845962752771445,
          0.1908991828855062,
          0.03478580697591701,
          0.7590917009948228,
          -0.10022582392037543,
          0.061583602653320434,
          0.8719755179152386,
          -0.15077171439541498,
          -0.15077171439541495,
          0
        ]
      },
      "scales": [
        0.06668323470073105,
        0.18508218716492833,
        0.06477514722530534,
        0.055348894890193415,
        0.0695710563957643,
        0.1251023059838258,
        0.01516395634175677,
        1.0731402060312418,
        0.055004570863795524,
        0.1601362949599934,
        0.0540647841367203,
        0.04464635216139575,
        0.05942628491193689,
        0.09808384889382114,
        0.012084518399985866,
        0.9202409223250388,
        0.04763187469578081,
        0.14176024751194755,
        0.047541002739691536,
        0.038015735949582394,
        0.05314573395396916,
        0.08136555142864584,
        0.009934728938361038,
        0.8190710693696536,
        0.38569460791993954,
        0.38569460791993954,
        1
      ],
      "centers": [
        0.0006976062687816351,
        0.0025951531072654684,
        0.0006609187923366192,
        0.0012220035764966936,
        0.00030438842704489467,
        -0.002943155716361941,
        0.00020182484560873177,
        0.006086370042437362,
        0.0001647762360204119,
        0.0038807965302629223,
        -0.000027359350279286757,
        0.0011446101323805814,
        0.0009538141462434436,
        -0.0008429358541963296,
        -0.000014111230510320278,
        0.011800149195932313,
        -0.00014081515295504118,
        0.002330983316218569,
        -0.00012625888977704203,
        0.000009883481364051748,
        0.0007572294023975766,
        -0.0014392059811647942,
        0.00009160658582094896,
        0.0023229837540356835,
        0.18181818181818182,
        0.18181818181818182,
        0
      ],
      "version": 1,
      "metadata": {
        "family": "spread",
        "algorithm": "linear_regression",
        "createdAt": "2026-09-15T02:14:49.304Z",
        "artifactId": "phase6-1-spread-01c85917b47c6e70c258fe0258481c7a",
        "randomSeed": null,
        "samplePolicy": "include_low_sample",
        "featureVersion": "pregame-v3",
        "trainingCutoff": "2026-02-08T12:00:00.000Z",
        "hyperparameters": {
          "ridgeLambda": 1
        },
        "runtimeVersions": {
          "v8": "13.6.233.17-node.37",
          "node": "v24.13.0",
          "modeling": "phase6.1"
        },
        "trainingSeasons": [
          2021,
          2022,
          2023,
          2024,
          2025
        ],
        "artifactChecksum": "01c85917b47c6e70c258fe0258481c7a2a21e567c95db02cac38988baa4034bf",
        "vectorFeatureNames": [
          "last_3.defensive_success_rate",
          "last_3.epa_per_play",
          "last_3.explosive_pass_rate",
          "last_3.explosive_rush_rate",
          "last_3.offensive_success_rate",
          "last_3.red_zone_touchdown_rate",
          "last_3.turnover_rate",
          "last_3.yards_per_play",
          "last_5.defensive_success_rate",
          "last_5.epa_per_play",
          "last_5.explosive_pass_rate",
          "last_5.explosive_rush_rate",
          "last_5.offensive_success_rate",
          "last_5.red_zone_touchdown_rate",
          "last_5.turnover_rate",
          "last_5.yards_per_play",
          "last_8.defensive_success_rate",
          "last_8.epa_per_play",
          "last_8.explosive_pass_rate",
          "last_8.explosive_rush_rate",
          "last_8.offensive_success_rate",
          "last_8.red_zone_touchdown_rate",
          "last_8.turnover_rate",
          "last_8.yards_per_play",
          "home_low_sample",
          "away_low_sample",
          "qb_confidence_difference"
        ],
        "trainingSampleCount": 1408,
        "vectorSchemaFingerprint": "d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42"
      },
      "algorithm": "linear_regression"
    },
    "feature_version": "pregame-v3",
    "training_seasons": [
      2021,
      2022,
      2023,
      2024,
      2025
    ],
    "recency_weighting": "none",
    "feature_importance": {
      "away_low_sample": 0.019111622040357407,
      "home_low_sample": 0.01911162204035741,
      "last_3.epa_per_play": 0.05273845773428927,
      "last_5.epa_per_play": 0.06547244224308482,
      "last_8.epa_per_play": 0.0994543806011468,
      "last_3.turnover_rate": 0.0100375805036479,
      "last_5.turnover_rate": 0.0026113810340221847,
      "last_8.turnover_rate": 0.007806255586555855,
      "last_3.yards_per_play": 0.04555598295499548,
      "last_5.yards_per_play": 0.05323398508657804,
      "last_8.yards_per_play": 0.11053045721252161,
      "qb_confidence_difference": 0,
      "last_3.explosive_pass_rate": 0.01858150554113058,
      "last_3.explosive_rush_rate": 0.015198241991949706,
      "last_5.explosive_pass_rate": 0.00805625213726297,
      "last_5.explosive_rush_rate": 0.011596544857717366,
      "last_8.explosive_pass_rate": 0.024198126589928922,
      "last_8.explosive_rush_rate": 0.004409402638674057,
      "last_3.defensive_success_rate": 0.048803026890001364,
      "last_3.offensive_success_rate": 0.02259878313843765,
      "last_5.defensive_success_rate": 0.07993266203994769,
      "last_5.offensive_success_rate": 0.05304346178831481,
      "last_8.defensive_success_rate": 0.050544054981964286,
      "last_8.offensive_success_rate": 0.09622145467774976,
      "last_3.red_zone_touchdown_rate": 0.05158459298564843,
      "last_5.red_zone_touchdown_rate": 0.016863230530693916,
      "last_8.red_zone_touchdown_rate": 0.012704492173021801
    },
    "vector_feature_names": [
      "last_3.defensive_success_rate",
      "last_3.epa_per_play",
      "last_3.explosive_pass_rate",
      "last_3.explosive_rush_rate",
      "last_3.offensive_success_rate",
      "last_3.red_zone_touchdown_rate",
      "last_3.turnover_rate",
      "last_3.yards_per_play",
      "last_5.defensive_success_rate",
      "last_5.epa_per_play",
      "last_5.explosive_pass_rate",
      "last_5.explosive_rush_rate",
      "last_5.offensive_success_rate",
      "last_5.red_zone_touchdown_rate",
      "last_5.turnover_rate",
      "last_5.yards_per_play",
      "last_8.defensive_success_rate",
      "last_8.epa_per_play",
      "last_8.explosive_pass_rate",
      "last_8.explosive_rush_rate",
      "last_8.offensive_success_rate",
      "last_8.red_zone_touchdown_rate",
      "last_8.turnover_rate",
      "last_8.yards_per_play",
      "home_low_sample",
      "away_low_sample",
      "qb_confidence_difference"
    ],
    "vector_schema_fingerprint": "d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42"
  },
  {
    "notes": "Phase 6 production refit of the unchanged selected Phase 4 algorithm using legitimate 2021-2025 data only. 2026 remains forward/out-of-sample. Administrator promotion required.",
    "family": "totals",
    "status": "refit_candidate",
    "metrics": {
      "status": "2025_holdout",
      "holdoutMetrics": {
        "mae": 10.880934778639512,
        "rmse": 13.806469437235359,
        "lowQbMae": 0,
        "highQbMae": 10.880934778639512,
        "sampleSize": 237
      },
      "outputValidation": "finite",
      "holdoutSampleSize": 237,
      "trainingSampleSize": 1152,
      "comparisonThreshold": "10% relative metric band; moneyline accuracy 2.5 percentage-point band",
      "historicalReference": {
        "mae": 10.8809,
        "rmse": 13.8065,
        "sampleSize": 237
      },
      "forwardSeasonsExcluded": [
        2026
      ],
      "holdoutTrainingSampleSize": 915,
      "historicalComparisonClassification": "materially_consistent"
    },
    "algorithm": "gradient_boosting",
    "trained_at": "2026-09-15T02:14:52.382452+00:00",
    "calibration": {
      "status": "not_applicable"
    },
    "sample_size": 1152,
    "test_season": 2025,
    "model_version": "phase6-1-totals-749279b5856f1be1165c211d",
    "sample_policy": "exclude_low_sample",
    "model_artifact": {
      "model": {
        "base": 44.97569444444444,
        "kind": "boosting",
        "trees": [
          {
            "tree": {
              "left": {
                "left": {
                  "value": 0.6736111111111092
                },
                "right": {
                  "value": -1.8163724105461496
                },
                "value": -0.5863290928149534,
                "feature": 22,
                "threshold": 0.04878855498776474
              },
              "right": {
                "left": {
                  "value": -0.5375673541434457
                },
                "right": {
                  "value": 1.8613425925925824
                },
                "value": 0.600755467682086,
                "feature": 2,
                "threshold": 0.6853957192923561
              },
              "value": -4.946660365274309e-15,
              "feature": 10,
              "threshold": -7.709882115452476e-19
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": 0.6197222222222207
                },
                "right": {
                  "value": -1.6710626177024475
                },
                "value": -0.5394227653897469,
                "feature": 22,
                "threshold": 0.04878855498776474
              },
              "right": {
                "left": {
                  "value": -0.4945619658119616
                },
                "right": {
                  "value": 1.7124351851851978
                },
                "value": 0.552695030267533,
                "feature": 2,
                "threshold": 0.6853957192923561
              },
              "value": 3.76859037803317e-15,
              "feature": 10,
              "threshold": -7.709882115452476e-19
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": 0.5701444444444403
                },
                "right": {
                  "value": -1.5373776082862416
                },
                "value": -0.4962689441585643,
                "feature": 22,
                "threshold": 0.04878855498776474
              },
              "right": {
                "left": {
                  "value": -0.45499700854700664
                },
                "right": {
                  "value": 1.5754403703703745
                },
                "value": 0.5084794278461245,
                "feature": 2,
                "threshold": 0.6853957192923561
              },
              "value": -4.564250212347865e-16,
              "feature": 10,
              "threshold": -7.709882115452476e-19
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": 0.5245328888888876
                },
                "right": {
                  "value": -1.414387399623373
                },
                "value": -0.4565674286258931,
                "feature": 22,
                "threshold": 0.04878855498776474
              },
              "right": {
                "left": {
                  "value": -0.4185972478632582
                },
                "right": {
                  "value": 1.4494051407407518
                },
                "value": 0.4678010736184318,
                "feature": 2,
                "threshold": 0.6853957192923561
              },
              "value": -1.1842378929335002e-15,
              "feature": 10,
              "threshold": -7.709882115452476e-19
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": 0.48257025777777685
                },
                "right": {
                  "value": -1.3012364076534757
                },
                "value": -0.420042034335812,
                "feature": 22,
                "threshold": 0.04878855498776474
              },
              "right": {
                "left": {
                  "value": -0.3851094680341939
                },
                "right": {
                  "value": 1.3334527294814857
                },
                "value": 0.4303769877289566,
                "feature": 2,
                "threshold": 0.6853957192923561
              },
              "value": -3.0592812234115426e-15,
              "feature": 10,
              "threshold": -7.709882115452476e-19
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": -0.8051984945455898
                },
                "right": {
                  "value": 1.6118765460745716
                },
                "value": 0.4115884286335039,
                "feature": 13,
                "threshold": -0.099368753583973
              },
              "right": {
                "left": {
                  "value": -1.2890767734105082
                },
                "right": {
                  "value": 0.3893652697892006
                },
                "value": -0.4261321893626011,
                "feature": 0,
                "threshold": 0.03898725478059328
              },
              "value": 3.3306690738754696e-16,
              "feature": 18,
              "threshold": -3.970589289458025e-17
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": 0.4173619376968033
                },
                "right": {
                  "value": -1.2133128250479837
                },
                "value": -0.40776508633358016,
                "feature": 22,
                "threshold": 0.04878855498776474
              },
              "right": {
                "left": {
                  "value": 1.2798764568807557
                },
                "right": {
                  "value": -0.4473160030934467
                },
                "value": 0.4177979707073427,
                "feature": 16,
                "threshold": 0.05326416232181446
              },
              "value": 4.625929269271486e-16,
              "feature": 10,
              "threshold": -7.709882115452476e-19
            },
            "weight": 0.08
          },
          {
            "tree": {
              "left": {
                "left": {
                  "value": -0.7195985139796296
                },
                "right": {
                  "value": 1.5020205645604654
                },
                "value": 0.39879334296461727,
                "feature": 13,
                "threshold": -0.099368753583973
              },
              "right": {
                "left": {
                  "value": -1.2333407112779489
                },
                "right": {
                  "value": 0.36245978221364744
                },
                "value": -0.41288498052520234,
                "feature": 0,
                "threshold": 0.03898725478059328
              },
              "value": -6.59965909082732e-16,
              "feature": 18,
              "threshold": -3.970589289458025e-17
            },
            "weight": 0.08
          }
        ],
        "classification": false
      },
      "scales": [
        0.0661870900305283,
        0.1857936803512779,
        0.06478174258033065,
        0.05413735662890344,
        0.06938247642191096,
        0.12205905098894274,
        0.014964597387155748,
        1.0757744500591928,
        0.05377366787208609,
        0.15799923478876784,
        0.05340372332240292,
        0.043144889890482006,
        0.05854671751650893,
        0.09344869864801413,
        0.011540500630034442,
        0.9162700373409939,
        0.04582979404412763,
        0.1387643736107513,
        0.04577735334337178,
        0.03602764464406296,
        0.052260464779996935,
        0.07473502169140736,
        0.009187468527785023,
        0.8070629807211563,
        1,
        1,
        1
      ],
      "centers": [
        0.0013981665965292777,
        0.0027606389751815828,
        -0.000182099822554667,
        0.0006114085619944254,
        0.0003560634600246087,
        -0.004293385869981503,
        0.000007758929245802877,
        0.0000812846170901195,
        0.00026521950863644435,
        0.004567476181709243,
        -0.0004909109229055354,
        0.0009659602547977328,
        0.001100093603707058,
        -0.0018579953797712215,
        -0.00013683265438188362,
        0.009238622951932443,
        -0.00030376783213827466,
        0.0021258137574000323,
        -0.0006386892421389208,
        -0.00027335938861777786,
        0.000738593260393821,
        -0.002998040296021314,
        0.00000920670927832355,
        -0.0009087200227365058,
        0,
        0,
        0
      ],
      "version": 1,
      "metadata": {
        "family": "totals",
        "algorithm": "gradient_boosting",
        "createdAt": "2026-09-15T02:14:52.362Z",
        "artifactId": "phase6-1-totals-749279b5856f1be1165c211d3c6233c7",
        "randomSeed": null,
        "samplePolicy": "exclude_low_sample",
        "featureVersion": "pregame-v3",
        "trainingCutoff": "2026-02-08T12:00:00.000Z",
        "hyperparameters": {
          "depth": 2,
          "rounds": 8,
          "learningRate": 0.08,
          "minLeafSamples": 5
        },
        "runtimeVersions": {
          "v8": "13.6.233.17-node.37",
          "node": "v24.13.0",
          "modeling": "phase6.1"
        },
        "trainingSeasons": [
          2021,
          2022,
          2023,
          2024,
          2025
        ],
        "artifactChecksum": "749279b5856f1be1165c211d3c6233c7c4f55d44d12ebcb2c94500db63b60c2f",
        "vectorFeatureNames": [
          "last_3.defensive_success_rate",
          "last_3.epa_per_play",
          "last_3.explosive_pass_rate",
          "last_3.explosive_rush_rate",
          "last_3.offensive_success_rate",
          "last_3.red_zone_touchdown_rate",
          "last_3.turnover_rate",
          "last_3.yards_per_play",
          "last_5.defensive_success_rate",
          "last_5.epa_per_play",
          "last_5.explosive_pass_rate",
          "last_5.explosive_rush_rate",
          "last_5.offensive_success_rate",
          "last_5.red_zone_touchdown_rate",
          "last_5.turnover_rate",
          "last_5.yards_per_play",
          "last_8.defensive_success_rate",
          "last_8.epa_per_play",
          "last_8.explosive_pass_rate",
          "last_8.explosive_rush_rate",
          "last_8.offensive_success_rate",
          "last_8.red_zone_touchdown_rate",
          "last_8.turnover_rate",
          "last_8.yards_per_play",
          "home_low_sample",
          "away_low_sample",
          "qb_confidence_difference"
        ],
        "trainingSampleCount": 1152,
        "vectorSchemaFingerprint": "d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42"
      },
      "algorithm": "gradient_boosting"
    },
    "feature_version": "pregame-v3",
    "training_seasons": [
      2021,
      2022,
      2023,
      2024,
      2025
    ],
    "recency_weighting": "none",
    "feature_importance": {
      "away_low_sample": 0,
      "home_low_sample": 0,
      "last_3.epa_per_play": 0,
      "last_5.epa_per_play": 0,
      "last_8.epa_per_play": 0,
      "last_3.turnover_rate": 0,
      "last_5.turnover_rate": 0,
      "last_8.turnover_rate": 0.25,
      "last_3.yards_per_play": 0,
      "last_5.yards_per_play": 0,
      "last_8.yards_per_play": 0,
      "qb_confidence_difference": 0,
      "last_3.explosive_pass_rate": 0.20833333333333334,
      "last_3.explosive_rush_rate": 0,
      "last_5.explosive_pass_rate": 0.25,
      "last_5.explosive_rush_rate": 0,
      "last_8.explosive_pass_rate": 0.08333333333333333,
      "last_8.explosive_rush_rate": 0,
      "last_3.defensive_success_rate": 0.08333333333333333,
      "last_3.offensive_success_rate": 0,
      "last_5.defensive_success_rate": 0,
      "last_5.offensive_success_rate": 0,
      "last_8.defensive_success_rate": 0.041666666666666664,
      "last_8.offensive_success_rate": 0,
      "last_3.red_zone_touchdown_rate": 0,
      "last_5.red_zone_touchdown_rate": 0.08333333333333333,
      "last_8.red_zone_touchdown_rate": 0
    },
    "vector_feature_names": [
      "last_3.defensive_success_rate",
      "last_3.epa_per_play",
      "last_3.explosive_pass_rate",
      "last_3.explosive_rush_rate",
      "last_3.offensive_success_rate",
      "last_3.red_zone_touchdown_rate",
      "last_3.turnover_rate",
      "last_3.yards_per_play",
      "last_5.defensive_success_rate",
      "last_5.epa_per_play",
      "last_5.explosive_pass_rate",
      "last_5.explosive_rush_rate",
      "last_5.offensive_success_rate",
      "last_5.red_zone_touchdown_rate",
      "last_5.turnover_rate",
      "last_5.yards_per_play",
      "last_8.defensive_success_rate",
      "last_8.epa_per_play",
      "last_8.explosive_pass_rate",
      "last_8.explosive_rush_rate",
      "last_8.offensive_success_rate",
      "last_8.red_zone_touchdown_rate",
      "last_8.turnover_rate",
      "last_8.yards_per_play",
      "home_low_sample",
      "away_low_sample",
      "qb_confidence_difference"
    ],
    "vector_schema_fingerprint": "d3549f1cba54adab375bfa051a20cb1997db448fce1fd136caf0251b881ceb42"
  }
] as const;
