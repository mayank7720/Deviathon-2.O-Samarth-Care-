import {SMS_SEEDS,SMS_AUGMENTATION} from '../data/sms-intent-seeds.mjs';
import {normalizeSmsText} from './sms-intent-features.mjs';
export function generateSmsCorpus(seeds=SMS_SEEDS){
 const rows=[],seen=new Map();
 for(const seed of seeds)for(const[language,base]of Object.entries(seed.texts)){
  const augmentation=SMS_AUGMENTATION[language];
  for(const prefix of augmentation.prefix)for(const suffix of augmentation.suffix){
   const text=prefix+base+suffix;
   const typo=text.replace(/\bplease\b/giu,'pls').replace(/\bcall\b/giu,'cal').replace(/\bhelp\b/giu,'hlp').replace(/\bmujhe\b/giu,'muje').replace(/\bchahiye\b/giu,'chaiye');
   for(const variant of new Set([text,typo])){
    const key=normalizeSmsText(variant),prior=seen.get(key);
    if(prior){if(prior.group!==seed.group)throw Error('Equivalent text crosses scenario families: '+seed.group+' and '+prior.group);continue;}
    const row={id:`sms-synthetic-${rows.length+1}`,group:seed.group,split:seed.split,label:seed.label,language,text:variant,synthetic:true};
    seen.set(key,row);rows.push(row);
   }
  }
 }
 return rows;
}
