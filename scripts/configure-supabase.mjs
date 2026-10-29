import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const path='.dev.vars.supabase';
if(existsSync(path))console.log('Preserved existing ignored Supabase configuration.');
else {
  const config=JSON.parse(readFileSync(new URL('../config/supabase.json',import.meta.url),'utf8'));
  writeFileSync(path,`SAMARTH_AUTH_MODE=supabase\nSUPABASE_URL=${config.url}\nSUPABASE_PUBLISHABLE_KEY=${config.publishableKey}\nSAMARTH_ALLOW_SIGNUP=true\nSAMARTH_SCHEDULER_CONFIGURED=true\n`);
  console.log('Supabase login configured. Run npm run dev:supabase and use your assigned account.');
}
