/** Trial-only preflight. Never creates a call, buys a number or changes billing. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';import {parseEnv} from 'node:util';
const args=new Set(process.argv.slice(2));if([...args].some(a=>!['--check','--prepare','--provider'].includes(a)))throw Error('Use --check, --prepare or --provider.');
const file='.dev.vars.twilio';
if(args.has('--prepare')&&!existsSync(file))writeFileSync(file,'# Private trial-only settings. Never commit or paste these values into chat.\nTWILIO_ACCOUNT_SID=\nTWILIO_AUTH_TOKEN=\nTWILIO_FROM_NUMBER=\nSAMARTH_TWILIO_TRIAL_ENABLED=false\nSAMARTH_CALL_BOT_SPOKEN_CHOICES=false\n',{flag:'wx',mode:0o600});
const env={...(existsSync(file)?parseEnv(readFileSync(file,'utf8')):{}),...process.env};
const configured={accountSid:/^AC[a-f\d]{32}$/iu.test(env.TWILIO_ACCOUNT_SID||''),authToken:typeof env.TWILIO_AUTH_TOKEN==='string'&&env.TWILIO_AUTH_TOKEN.length>=16,fromNumber:/^\+[1-9]\d{7,14}$/u.test(env.TWILIO_FROM_NUMBER||'')};
const output={privateFileExists:existsSync(file),configured,callingEnabled:env.SAMARTH_TWILIO_TRIAL_ENABLED==='true',spokenChoices:env.SAMARTH_CALL_BOT_SPOKEN_CHOICES==='true',callsPlaced:0,billingChanged:false,trialAllowanceVerified:false};
if(args.has('--provider')){
 if(!Object.values(configured).every(Boolean))throw Error('Save the trial settings privately before checking the provider. No call was placed.');
 const url=`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`;
 const response=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64')},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('The provider did not verify these private settings. No call was placed.');
 const account=await response.json();if(account.type!=='Trial')throw Error('Only trial accounts are allowed. Paid-account calling remains blocked.');
 output.providerAccountType='Trial';output.providerAccountActive=account.status==='active';
}
console.log(JSON.stringify(output,null,2));
