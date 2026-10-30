export const SMS_LABELS=Object.freeze(['help','callback','concern','other']);
export const SMS_FEATURE_DIMENSIONS=4096;
export function normalizeSmsText(text){return String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/gu,"'").replace(/\p{N}+/gu,' # ').replace(/[^\p{L}\p{M}#'\s]/gu,' ').replace(/\s+/gu,' ').trim();}
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;}
export function smsFeatures(text,dimensions=SMS_FEATURE_DIMENSIONS){
 const normalized=normalizeSmsText(text).slice(0,1600),values=new Map();
 const add=(token,weight=1)=>{const h=hash(token),index=h%dimensions,sign=(h&0x80000000)?-1:1;values.set(index,(values.get(index)||0)+weight*sign);};
 const padded=' '+normalized+' ';for(const n of [2,3,4])for(let i=0;i+n<=padded.length;i++)add(n+':'+padded.slice(i,i+n));
 const words=normalized.split(' ').filter(Boolean);for(let i=0;i<words.length;i++){add('w:'+words[i],2);if(i) add('b:'+words[i-1]+' '+words[i],2.5);}
 let norm=0;for(const[index,value]of values){const bounded=Math.sign(value)*Math.sqrt(Math.abs(value));values.set(index,bounded);norm+=bounded*bounded;}norm=Math.sqrt(norm)||1;
 return [...values].map(([index,value])=>[index,value/norm]);
}
export function intentScores(model,features){
 const scores=model.bias.map((bias,k)=>{let total=bias;for(const[index,value]of features)total+=model.weights[k*model.dimensions+index]*value;return total;});
 const max=Math.max(...scores),exps=scores.map(x=>Math.exp(x-max)),sum=exps.reduce((a,b)=>a+b,0);return exps.map(x=>x/sum);
}
