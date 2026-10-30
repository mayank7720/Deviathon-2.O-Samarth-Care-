/** Conservative routing guard. ML supplements explicit requests and assertion
 * rules; it never suppresses a request or invents clinical severity. */
export function maySupplementSms(text){
 const value=String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/gu,"'");
 if(/\b(?:example|sample|advertisement|discount|offer|loan|otp|password|bank|balance|cricket|battery|charger|sale|season)\b|उदाहरण|बैंक|चार्जर|ऑफर/u.test(value))return false;
 if(/\b(?:daughter|son|wife|husband|friend|neighbou?r|grandchild)\b|बेटी|बेटा|पड़ोसी|दोस्त/u.test(value))return false;
 if(/\b(?:history\s+of|last\s+year|years?\s+ago|months?\s+ago|fully\s+recovered|resolved|in\s+love|fall\s+asleep)\b|पिछले\s*साल|साल\s*पहले/u.test(value))return false;
 if(/^\s*(?:what\b|how\b|why\b|if\b|watch\s+for\b|do\s+you\b|have\s+you\b|does\s+she\b|क्या|अगर|यदि)/u.test(value))return false;
 if(/\b(?:do\s+not|don't|dont|no\s+(?:need|help|pain|confusion|fall)|not\s+(?:needed|required|unwell)|cancel|help\s+yourself)\b|(?:madad|call|phone)\s+(?:nahi|nahin|mat)\b|(?:मदद|कॉल|फोन)\s*(?:नहीं|मत)|दर्द\s*नहीं/u.test(value))return false;
 return /[\p{L}]/u.test(value)&&value.length<=1600;
}
export function acceptSmsIntent(prediction,thresholds,text){
 return thresholds.enabled&&prediction.label!=='other'&&prediction.score>=thresholds.score&&prediction.margin>=thresholds.margin&&maySupplementSms(text);
}
