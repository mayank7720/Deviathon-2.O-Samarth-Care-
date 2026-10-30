import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {SMS_SEEDS} from '../data/sms-intent-seeds.mjs';
import {SMS_V2_VALIDATION} from '../data/sms-intent-validation.mjs';
import {generateSmsCorpus} from '../lib/sms-intent-corpus.mjs';
import {smsFeatures,intentScores,SMS_LABELS,SMS_FEATURE_DIMENSIONS} from '../lib/sms-intent-features.mjs';
import {acceptSmsIntent} from '../lib/sms-intent-policy.mjs';

const started=performance.now(),seeds=[...SMS_SEEDS.map(row=>({...row,split:'train'})),...SMS_V2_VALIDATION],rows=generateSmsCorpus(seeds);
const split=name=>rows.filter(x=>x.split===name);
const training=split('train').map(row=>({...row,features:smsFeatures(row.text),y:SMS_LABELS.indexOf(row.label)}));
const calibration=split('calibration').map(row=>({...row,features:smsFeatures(row.text)}));
const test=split('test').map(row=>({...row,features:smsFeatures(row.text)}));
const dimensions=SMS_FEATURE_DIMENSIONS,weights=new Float64Array(dimensions*SMS_LABELS.length),bias=new Float64Array(SMS_LABELS.length);
const model={id:'sms-intent-v2',algorithm:'Hashed character/word multinomial logistic regression',dimensions,labels:SMS_LABELS,weights,bias};
let seed=71942;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const order=training.map((_,i)=>i),gradient=new Float64Array(weights.length),biasGradient=new Float64Array(bias.length);
const counts=SMS_LABELS.map(label=>training.filter(row=>row.label===label).length),epochs=36,batchSize=96;
for(let epoch=0;epoch<epochs;epoch++){
 for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 const rate=1.2/Math.sqrt(1+epoch/5);
 for(let offset=0;offset<order.length;offset+=batchSize){
  gradient.fill(0);biasGradient.fill(0);const end=Math.min(offset+batchSize,order.length);
  for(let r=offset;r<end;r++){
   const row=training[order[r]],scores=intentScores(model,row.features),balance=training.length/(SMS_LABELS.length*counts[row.y]);
   for(let k=0;k<SMS_LABELS.length;k++){const residual=(scores[k]-Number(k===row.y))*balance;biasGradient[k]+=residual;for(const[index,value]of row.features)gradient[k*dimensions+index]+=residual*value;}
  }
  for(let i=0;i<weights.length;i++)weights[i]-=rate*(gradient[i]/(end-offset)+0.0002*weights[i]);
  for(let k=0;k<bias.length;k++)bias[k]-=rate*biasGradient[k]/(end-offset);
 }
}
// Quantize before calibration/evaluation so the reported model is exactly the
// compact artifact used in the receiver, not a higher precision training copy.
model.weights=Array.from(weights,x=>Number(x.toFixed(6)));model.bias=Array.from(bias,x=>Number(x.toFixed(6)));
function predict(row){const scores=intentScores(model,row.features),rank=scores.map((score,index)=>({score,label:SMS_LABELS[index]})).sort((a,b)=>b.score-a.score);return{label:rank[0].label,score:rank[0].score,margin:rank[0].score-rank[1].score};}
for(const row of [...calibration,...test])row.prediction=predict(row);
function routingMetrics(examples,thresholds){
 let tp=0,fp=0,fn=0,tn=0;
 for(const row of examples){const care=row.label!=='other',accepted=acceptSmsIntent(row.prediction,thresholds,row.text);if(care&&accepted)tp++;else if(!care&&accepted)fp++;else if(care)fn++;else tn++;}
 return{tp,fp,fn,tn,precision:tp+fp?tp/(tp+fp):null,recall:tp/(tp+fn),falsePositiveRate:fp/(fp+tn),accepted:tp+fp};
}
let thresholds={enabled:false,score:1,margin:1},bestRecall=-1;
for(const score of [.8,.85,.9,.95,.975,.99,.995,.999])for(const margin of [.3,.4,.5,.6,.8]){
 const candidate={enabled:true,score,margin},metrics=routingMetrics(calibration,candidate);
 if(metrics.precision>=.985&&metrics.tp>=30&&metrics.recall>bestRecall){thresholds=candidate;bestRecall=metrics.recall;}
}
function classificationMetrics(examples){
 const confusion=Object.fromEntries(SMS_LABELS.map(label=>[label,Object.fromEntries(SMS_LABELS.map(other=>[other,0]))]));
 for(const row of examples)confusion[row.label][row.prediction.label]++;
 const perClass=Object.fromEntries(SMS_LABELS.map(label=>{const tp=confusion[label][label],actual=Object.values(confusion[label]).reduce((a,b)=>a+b,0),predicted=SMS_LABELS.reduce((sum,l)=>sum+confusion[l][label],0);return[label,{precision:predicted?tp/predicted:0,recall:tp/actual,support:actual}];}));
 return{accuracy:examples.filter(x=>x.label===x.prediction.label).length/examples.length,confusion,perClass};
}
const corpusHash=createHash('sha256').update(rows.map(row=>JSON.stringify(row)).join('\n')).digest('hex');
const testRouting=routingMetrics(test,thresholds),languages=Object.fromEntries(['en','hi','hinglish'].map(language=>[language,routingMetrics(test.filter(x=>x.language===language),thresholds)]));
const release={passed:thresholds.enabled&&testRouting.precision>=.985&&testRouting.recall>=.35&&Object.values(languages).every(x=>x.precision>=.95&&x.tp>=30),precisionTarget:.985,minimumRecall:.35,perLanguagePrecisionTarget:.95};
model.thresholds={...thresholds,enabled:release.passed};model.release=release;
model.training={synthetic:true,independentScenarioFamilies:seeds.length,seedPhrases:seeds.length*3,examples:rows.length,trainingExamples:training.length,calibrationExamples:calibration.length,testExamples:test.length,split:'V1 evaluated families retired into training; new fixed V2 scenario-family calibration and test sets',corpusSha256:corpusHash,epochs,calibrationPrecisionTarget:.985};
const report={modelId:model.id,training:model.training,candidateThresholds:thresholds,deployedThresholds:model.thresholds,release,calibration:routingMetrics(calibration,thresholds),test:{classification:classificationMetrics(test),routing:testRouting,languages},limitations:['Entire corpus is authored synthetic text, not independently labelled patient SMS.','Augmented rows are correlated; scenario-family count is the independence unit.','Softmax intent scores are not calibrated clinical probabilities.','Thresholds are selected using calibration only; the fixed test is not used for fitting or threshold selection.','The fixed test is used once as a release gate; a failed gate disables automatic ML routing.','ML only adds human-review requests and cannot lower rule urgency, resolve an alert or diagnose.'],runtimeMs:Math.round(performance.now()-started)};
await mkdir('outputs/sms-intent',{recursive:true});
await writeFile('outputs/sms-intent/corpus.jsonl',rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
await writeFile('outputs/sms-intent/evaluation.json',JSON.stringify(report,null,2)+'\n');
await writeFile('lib/sms-intent-model.mjs','/** Generated only from synthetic training examples. Reproduce: node scripts/train-sms-intent.mjs */\nexport const SMS_INTENT_MODEL='+JSON.stringify(model)+';\n');
const pct=value=>value===null?'n/a':(value*100).toFixed(1)+'%';
await writeFile('docs/SMS_MODEL_EVALUATION.md',`# SMS intent model evaluation

This is a small local classifier trained on authored synthetic SMS. It is not a clinical diagnostic model, LLM or evidence of accuracy on real seniors.

${rows.length} unique normalized examples were generated from ${model.training.seedPhrases} seed phrases in ${seeds.length} scenario families, across English, Hindi and Hinglish. Greetings, courtesies and bounded typing variants increase coverage; they do not create independent patient observations.

V1 failed its held-out test (74.9% review precision). Its old evaluation is preserved in [SMS_MODEL_V1_EVALUATION.md](SMS_MODEL_V1_EVALUATION.md). V1's evaluated families were retired into development/training. V2 uses new phrase-family calibration and test sets authored before V2 fitting. V2 test results are not used to retune its thresholds.

Training: ${training.length}. Calibration: ${calibration.length}. Fixed test: ${test.length}. A whole scenario family and all its languages/variants stay in one split. The model uses 4,096 hashed character/word features and multinomial logistic regression. Weights are quantized before calibration and test. Corpus SHA-256: \`${corpusHash}\`.

## Fixed held-out results

Four-class accuracy: ${pct(report.test.classification.accuracy)}. Classes: help, callback, wellbeing concern and other.

| Review supplement | Precision | Recall | False positives | Missed care examples |
|---|---:|---:|---:|---:|
| Calibration | ${pct(report.calibration.precision)} | ${pct(report.calibration.recall)} | ${report.calibration.fp} | ${report.calibration.fn} |
| Fixed test | ${pct(report.test.routing.precision)} | ${pct(report.test.routing.recall)} | ${report.test.routing.fp} | ${report.test.routing.fn} |

Automatic supplement enabled: ${model.thresholds.enabled}. Candidate score threshold ${thresholds.score}; margin threshold ${thresholds.margin}. Threshold selection uses calibration only with a 98.5% precision target. The fixed test is then a release gate requiring at least 98.5% precision, 35% recall and 95% precision in each language. A failed gate leaves the model in shadow mode with automatic routing disabled. The table shows the candidate, including failed results. These targets are not guarantees on real SMS. The supplement abstains on low scores and blocked contexts. Misses in this table include abstentions; they must not be presented as detected messages.

These routing metrics evaluate the ML supplement plus its conservative context guard, not end-to-end carrier delivery or the full rules+ML pipeline. Existing explicit commands and asserted health cues remain independent routes. All model-only requests get a human callback review; the model cannot infer clinical severity. Neutral replies cannot clear an alert.

The fixed test is synthetic and comes from the same authors and augmentation process. It is not external validation. Before real use, collect consented examples, have coordinators label them, evaluate by person/household and time, review false alarms and missed requests, and recalibrate without reusing the final evaluation set.

Run \`node scripts/train-sms-intent.mjs\` to reproduce the artifact and ignored JSONL/evaluation outputs. Read the full confusion matrix and language metrics in \`outputs/sms-intent/evaluation.json\`.

References: [text features](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction), [grouped evaluation](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data).
`);
console.log(JSON.stringify(report,null,2));
