import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const problems=[];
const fail=(file,reason)=>problems.push(`${file}: ${reason}`);
for(const file of files){
 if(/(^|\/)(node_modules|outputs|\.next|dist|\.vercel|\.wrangler|\.local-tools|__pycache__)(\/|$)/.test(file))fail(file,'generated/private directory is tracked');
 if(/(^|\/)\.dev\.vars/.test(file)||/(^|\/)\.env(?:\.|$)/.test(file)&&file!=='.env.example')fail(file,'private environment file is tracked');
 if(/\.(?:pem|pfx|p12|sqlite|sqlite3|db|tsbuildinfo)$/i.test(file))fail(file,'private key, database or generated state is tracked');
 const path=resolve(root,file);if(!existsSync(path)){fail(file,'tracked file is missing');continue;}
 const bytes=readFileSync(path);if(bytes.includes(0)||!/[.](?:md|mjs|js|ts|tsx|json|ya?ml|toml|sql|example)$/i.test(file))continue;
 const text=bytes.toString('utf8');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))fail(file,'private key material detected');
 for(const value of text.match(/(?:sb_secret_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|sk-(?:proj-)?[A-Za-z0-9_-]{25,})/g)||[]){
  if(!/synthetic|example|placeholder|test[-_]/i.test(value))fail(file,'possible provider credential detected (value withheld)');
 }
 if(!file.endsWith('.md'))continue;
 const prose=text.replace(/```[^\n]*\n[\s\S]*?```/g,'');
 for(const match of prose.matchAll(/\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)){
  let target=match[1]||match[2];
  if(/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target))continue;
  target=target.split(/[?#]/,1)[0];if(!target)continue;
  try{target=decodeURIComponent(target);}catch{fail(file,'invalid local link encoding');continue;}
  if(!existsSync(resolve(dirname(path),target)))fail(file,`broken local link: ${target}`);
 }
}
for(const required of ['README.md','docs/QUICKSTART.md','docs/ARCHITECTURE.md','docs/PROJECT_STATUS.md','docs/DEMO_SCRIPT.md','docs/REQUIREMENTS.md','.env.example']){
 if(!files.includes(required))fail(required,'required showcase guide/template is not tracked');
}
const hero=resolve(root,'docs/assets/swasthsync-home.jpg');
if(!existsSync(hero)||statSync(hero).size===0)fail('docs/assets/swasthsync-home.jpg','public preview is missing');
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
else console.log(`Repository checks passed: ${files.length} tracked files, local Markdown links and credential/state guards.`);
