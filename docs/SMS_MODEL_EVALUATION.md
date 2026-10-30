# SMS intent model evaluation

This is a small local classifier trained on authored synthetic SMS. It is not a clinical diagnostic model, LLM or evidence of accuracy on real seniors.

26912 unique normalized examples were generated from 336 seed phrases in 112 scenario families, across English, Hindi and Hinglish. Greetings, courtesies and bounded typing variants increase coverage; they do not create independent patient observations.

V1 failed its held-out test (74.9% review precision). Its old evaluation is preserved in [SMS_MODEL_V1_EVALUATION.md](SMS_MODEL_V1_EVALUATION.md). V1's evaluated families were retired into development/training. V2 uses new phrase-family calibration and test sets authored before V2 fitting. V2 test results are not used to retune its thresholds.

Training: 11880. Calibration: 7408. Fixed test: 7624. A whole scenario family and all its languages/variants stay in one split. The model uses 4,096 hashed character/word features and multinomial logistic regression. Weights are quantized before calibration and test. Corpus SHA-256: `153fbf9ecab8d4a6765f8bbbd2b72bc57af73e29688ee859f2486f4cf833b21f`.

## Fixed held-out results

Four-class accuracy: 84.6%. Classes: help, callback, wellbeing concern and other.

| Review supplement | Precision | Recall | False positives | Missed care examples |
|---|---:|---:|---:|---:|
| Calibration | 99.7% | 24.8% | 5 | 4317 |
| Fixed test | 97.3% | 29.8% | 48 | 4104 |

Automatic supplement enabled: false. Candidate score threshold 0.8; margin threshold 0.3. Threshold selection uses calibration only with a 98.5% precision target. The fixed test is then a release gate requiring at least 98.5% precision, 35% recall and 95% precision in each language. A failed gate leaves the model in shadow mode with automatic routing disabled. The table shows the candidate, including failed results. These targets are not guarantees on real SMS. The supplement abstains on low scores and blocked contexts. Misses in this table include abstentions; they must not be presented as detected messages.

These routing metrics evaluate the ML supplement plus its conservative context guard, not end-to-end carrier delivery or the full rules+ML pipeline. Existing explicit commands and asserted health cues remain independent routes. All model-only requests get a human callback review; the model cannot infer clinical severity. Neutral replies cannot clear an alert.

The fixed test is synthetic and comes from the same authors and augmentation process. It is not external validation. Before real use, collect consented examples, have coordinators label them, evaluate by person/household and time, review false alarms and missed requests, and recalibrate without reusing the final evaluation set.

Run `node scripts/train-sms-intent.mjs` to reproduce the artifact and ignored JSONL/evaluation outputs. Read the full confusion matrix and language metrics in `outputs/sms-intent/evaluation.json`.

References: [text features](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction), [grouped evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data).
