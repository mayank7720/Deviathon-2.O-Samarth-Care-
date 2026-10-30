import test from 'node:test';import assert from 'node:assert/strict';
import {siteRoute,portalRoles,workspaceViews,workspacePath,workspaceDestination,signInPath,canonicalLegacyLink,canOpenWorkspace} from '../lib/site-links.mjs';
import {invitationDetails} from '../lib/portal-entry.mjs';
import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {workspaceNavigation} from '../lib/workspace-navigation.mjs';
test('care menu destinations are distinct, role scoped and clearly separate medicines from LLM summaries',()=>{
 for(const [role,admin,write]of [['operations',true,true],['operations',false,false],['coordinator',false,true],['family',false,false],['senior',false,false]]){
  const groups=workspaceNavigation(role,admin,write),items=groups.flatMap(g=>g.items);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  for(const item of items)assert.equal(canOpenWorkspace(item.id,role,admin),true,role+':'+item.id);
  if(role==='family')assert.ok(items.some(i=>i.id==='family-reports'));
  if(['operations','coordinator'].includes(role)){assert.ok(items.some(i=>i.id==='medications'&&i.label==='Medication patterns'));assert.ok(items.some(i=>i.id==='reports'&&i.label==='Weekly AI summaries'));}
 }
 assert.equal(canOpenWorkspace('medications','family'),false);assert.equal(canOpenWorkspace('family-reports','senior'),false);
});
test('all public and role sign-in destinations resolve; account creation is restricted to personal roles',()=>{
 for(const path of ['/','/sign-in','/create-account','/how-it-works','/for-families','/questions','/invitations'])assert.notEqual(siteRoute(path).kind,'not-found');
 for(const role of portalRoles){const path=signInPath(role);assert.equal(siteRoute(path).kind,'sign-in');assert.equal(siteRoute(path).role,role);}
 for(const role of ['senior','family'])assert.equal(siteRoute(signInPath(role,true)).kind,'register');
 for(const role of ['coordinator','operations','admin'])assert.equal(siteRoute('/create-account/'+role).kind,'not-found');
 for(const path of ['/sign-in/admin','/random','/workspace/unknown','//sign-in/family','/sign-in/family/more'])assert.equal(siteRoute(path).kind,'not-found');
});
test('every workspace view has a refreshable URL; role hints cannot open an admin screen',()=>{
 for(const view of workspaceViews){assert.equal(siteRoute(workspacePath(view)).view,view);assert.equal(siteRoute(workspacePath(view)).kind,'workspace');}
 assert.equal(workspaceDestination('family',false,'/workspace/access'),'/workspace/family');
 assert.equal(workspaceDestination('senior',false,'/workspace/monitoring'),'/workspace/checkin');
 assert.equal(workspaceDestination('coordinator',false,'/workspace/system'),'/workspace/dashboard');
 assert.equal(workspaceDestination('operations',true,'/workspace/access'),'/workspace/access');
 assert.equal(workspaceDestination('family',false,'/workspace/followups'),'/workspace/followups');
 assert.equal(canOpenWorkspace('account','senior'),true);
 for(const next of ['https://evil.example/workspace/account','//evil.example','javascript:alert(1)','/workspace/account?admin=true'])assert.equal(workspaceDestination('senior',false,next),'/workspace/checkin');
});
test('return links survive portal choice and invitation tokens remain in the fragment',()=>{
 const token='a'.repeat(64),path=signInPath('family',false,{token,next:'/workspace/followups'}),url=new URL(path,'https://care.test');
 assert.equal(url.pathname,'/sign-in/family');assert.equal(url.searchParams.get('next'),'/workspace/followups');assert.equal(url.searchParams.has('invite'),false);assert.equal(invitationDetails(url.href).token,token);
 const create=signInPath('family',true,{token,next:'/workspace/followups'});assert.equal(invitationDetails(create).token,token);
 for(const next of ['https://evil.example','//evil.example','/workspace/account?role=operations'])assert.equal(new URL(signInPath('senior',false,{next}),'https://care.test').search,'');
});
test('the retired portal fragment is normalized and legacy invitation bookmarks preserve their secret',()=>{
 assert.equal(canonicalLegacyLink('https://swasthsync.vercel.app/#care-portals'),'/sign-in');
 const token='a'.repeat(64);const migrated=canonicalLegacyLink('https://care.test/?role=family#invite='+token);
 assert.equal(new URL(migrated,'https://care.test').pathname,'/invitations');assert.equal(invitationDetails(migrated).token,token);
 assert.equal(canonicalLegacyLink('https://care.test/sign-in/family'),null);
});
test('browser notification clicks open the protected inbox and ignore arbitrary payload destinations',async()=>{
 const listeners={},events=[],self={location:{origin:'https://swasthsync.vercel.app'},addEventListener:(name,handler)=>{listeners[name]=handler;},registration:{showNotification:async(title,value)=>{events.push({title,value});}},clients:{matchAll:async()=>[{url:'https://swasthsync.vercel.app/',navigate:async url=>events.push({navigate:url}),focus:async()=>events.push({focused:true})}],openWindow:async url=>events.push({opened:url})}};
 vm.runInNewContext(readFileSync('public/sw.js','utf8'),{self,URL});let pending;
 listeners.push({waitUntil:value=>{pending=value;}});await pending;assert.equal(events[0].value.data.url,'/workspace/deliveries');
 listeners.notificationclick({notification:{data:{url:'https://evil.example'},close(){}},waitUntil:value=>{pending=value;}});await pending;
 assert.equal(events[1].navigate,'https://swasthsync.vercel.app/workspace/deliveries');assert.equal(events[2].focused,true);
 self.clients.matchAll=async()=>[];listeners.notificationclick({notification:{close(){}},waitUntil:value=>{pending=value;}});await pending;assert.equal(events[3].opened,'https://swasthsync.vercel.app/workspace/deliveries');
});
