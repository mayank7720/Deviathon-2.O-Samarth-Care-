import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SMS_SEEDS} from '../data/sms-intent-seeds.mjs';
import {SMS_V2_VALIDATION} from '../data/sms-intent-validation.mjs';
import {generateSmsCorpus} from '../lib/sms-intent-corpus.mjs';
import {SMS_INTENT_MODEL as model} from '../lib/sms-intent-model.mjs';
import {normalizeSmsText} from '../lib/sms-intent-features.mjs';
import {classifySmsIntent} from '../lib/sms-intent.mjs';
import {analyzeSms} from '../lib/sms-understanding.mjs';

test('generated training corpus is synthetic, normalized-unique and grouped without cross-split leakage',()=>{
 const seeds=[...SMS_SEEDS.map(x=>({...x,split:'train'})),...SMS_V2_VALIDATION],rows=generateSmsCorpus(seeds),groups=new Map(),texts=new Set();
 assert.ok(rows.length>=20000);assert.equal(rows.length,model.training.examples);
 for(const row of rows){assert.equal(row.synthetic,true);if(groups.has(row.group))assert.equal(groups.get(row.group),row.split);groups.set(row.group,row.split);const key=normalizeSmsText(row.text);assert.ok(!texts.has(key));texts.add(key);}
 const hash=createHash('sha256').update(rows.map(row=>JSON.stringify(row)).join('\n')).digest('hex');assert.equal(hash,model.training.corpusSha256,'Changing authored data requires retraining and reevaluation');
 for(const split of ['train','calibration','test'])for(const language of ['en','hi','hinglish'])for(const label of model.labels)assert.ok(rows.some(x=>x.split===split&&x.language===language&&x.label===label));
});

test('frozen release gate controls automatic ML routing while retaining review-only predictions',()=>{
 assert.equal(model.thresholds.enabled,model.release.passed);
 const result=classifySmsIntent('I need help');assert.equal(result.available,true);assert.equal(result.modelId,model.id);assert.ok(result.intentScore>=0&&result.intentScore<=1);assert.match(result.scoreMeaning,/not a clinical probability/);
 if(!model.release.passed){assert.equal(result.mode,'shadow');for(const text of ['I need help','call me','mujhe ulti jaisa lag raha hai','My sister is tired','please ring our shop'])assert.equal(classifySmsIntent(text).accepted,false);}
 for(const text of ['', 'x'.repeat(1601)])assert.equal(classifySmsIntent(text).available,false);
 const upper=classifySmsIntent('I NEED HELP');assert.equal(result.intentScore,upper.intentScore);
});

test('ML never removes explicit help or lowers urgent asserted cues and its metadata is auditable',()=>{
 for(const text of ['HELP','मदद','I fell today','I cannot breathe']){
  const result=analyzeSms(text);assert.equal(result.intent,'help');assert.equal(result.decisionSource,'assertion-rules');assert.equal(result.classifier.modelId,model.id);assert.equal(result.classifier.trainingData,'authored-synthetic');assert.equal(result.externalServiceUsed,false);assert.ok(!('diagnosis' in result));
 }
 assert.equal(analyzeSms('I fell today').urgency,'immediate');
 assert.equal(analyzeSms('No help needed. No pain.').intent,'none');
});
