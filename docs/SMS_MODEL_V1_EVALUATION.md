# SMS intent model evaluation

**Rejected baseline. Never enabled in the application.** The “Supplement enabled” value below describes the candidate evaluated during training, not an approved deployment. Its failed held-out results motivated V2's broader data and release gate.

This is a small local classifier trained on authored synthetic SMS. It is not a clinical diagnostic model, LLM or evidence of accuracy on real seniors.

11880 unique normalized examples were generated from 144 seed phrases in 48 scenario families, across English, Hindi and Hinglish. Greetings, courtesies and bounded typing variants increase coverage; they do not create independent patient observations.

Training: 8008. Calibration: 1784. Fixed test: 2088. A whole scenario family and all its languages/variants stay in one split. The model uses 4,096 hashed character/word features and multinomial logistic regression. Weights are quantized before calibration and test. Corpus SHA-256: `e226f3179dae8251e4cfb6c3e72d0871e1d71a4a039d571540b473c89f050162`.

## Fixed held-out results

Four-class accuracy: 61.0%. Classes: help, callback, wellbeing concern and other.

| Review supplement | Precision | Recall | False positives | Missed care examples |
|---|---:|---:|---:|---:|
| Calibration | 100.0% | 76.4% | 0 | 327 |
| Fixed test | 74.9% | 47.5% | 250 | 823 |

Supplement enabled: true. Score threshold 0.55; margin threshold 0.1. Threshold selection uses calibration only with a 98.5% precision target. This target is not a guarantee on real SMS. The supplement abstains on low scores and blocked contexts. Misses in this table include abstentions; they must not be presented as detected messages.

These routing metrics evaluate the ML supplement plus its conservative context guard, not end-to-end carrier delivery or the full rules+ML pipeline. Existing explicit commands and asserted health cues remain independent routes. All model-only requests get a human callback review; the model cannot infer clinical severity. Neutral replies cannot clear an alert.

The fixed test is synthetic and comes from the same authors and augmentation process. It is not external validation. Before real use, collect consented examples, have coordinators label them, evaluate by person/household and time, review false alarms and missed requests, and recalibrate without reusing the final evaluation set.

Run `node scripts/train-sms-intent.mjs` to reproduce the artifact and ignored JSONL/evaluation outputs. Read the full confusion matrix and language metrics in `outputs/sms-intent/evaluation.json`.

References: [text features](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction), [grouped evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data).
