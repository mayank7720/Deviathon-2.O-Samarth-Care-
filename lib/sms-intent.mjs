import {SMS_INTENT_MODEL as model} from './sms-intent-model.mjs';
import {smsFeatures,intentScores,SMS_LABELS,SMS_FEATURE_DIMENSIONS} from './sms-intent-features.mjs';
import {acceptSmsIntent} from './sms-intent-policy.mjs';
const ready=model.dimensions===SMS_FEATURE_DIMENSIONS&&model.weights.length===SMS_LABELS.length*model.dimensions&&model.weights.every(Number.isFinite)&&model.bias.every(Number.isFinite);
export function classifySmsIntent(text){
 if(!ready||typeof text!=='string'||!text.trim()||text.length>1600)return{available:false,modelId:model.id,accepted:false,mode:'unavailable'};
 const scores=intentScores(model,smsFeatures(text)),rank=scores.map((score,index)=>({label:SMS_LABELS[index],score})).sort((a,b)=>b.score-a.score);
 const prediction={label:rank[0].label,score:rank[0].score,margin:rank[0].score-rank[1].score};
 return{available:true,modelId:model.id,label:prediction.label,intentScore:Number(prediction.score.toFixed(4)),margin:Number(prediction.margin.toFixed(4)),accepted:acceptSmsIntent(prediction,model.thresholds,text),
  mode:model.thresholds.enabled?'review-supplement':'shadow',trainingData:'authored-synthetic',trainingExamples:model.training.trainingExamples,
  scoreMeaning:'Uncalibrated text-intent score; not a clinical probability.',externalServiceUsed:false};
}
