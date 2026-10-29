import {existsSync,readFileSync,appendFileSync} from 'node:fs';
import webpush from 'web-push';

const path=process.argv.includes('--supabase')?'.dev.vars.supabase':'.dev.vars';
const current=existsSync(path)?readFileSync(path,'utf8'):'';
if(/^VAPID_PRIVATE_KEY=/m.test(current))console.log('Browser notification keys already exist; preserved.');
else {
  const keys=webpush.generateVAPIDKeys();
  appendFileSync(path,`\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:notifications@example.invalid\n`);
  console.log(`Generated browser notification keys in ignored ${path}. Restart the local server to use them.`);
}
