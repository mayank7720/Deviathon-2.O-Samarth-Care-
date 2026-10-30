/** Public paths choose screens only; account permissions remain server checked. */
export const portalRoles=Object.freeze(['senior','family','coordinator','operations']);
export const workspaceViews=Object.freeze(['dashboard','seniors','checkin','insights','family','analysis','monitoring','medications','family-reports','alerts','communications','access','deliveries','reports','telephony','care-operations','speech','followups','household','system','account','phone-support']);
export function siteRoute(pathname='/'){
 const path=pathname.replace(/\/$/u,'')||'/';
 if(path==='/')return {kind:'home',role:'',view:''};
 if(['/how-it-works','/for-families','/questions','/invitations'].includes(path))return {kind:path.slice(1),role:'',view:''};
 if(path==='/sign-in'||path==='/create-account')return {kind:path==='/sign-in'?'sign-in':'register',role:'',view:''};
 const match=path.match(/^\/(sign-in|create-account|workspace)\/([^/]+)$/u);
 if(match?.[1]==='workspace'&&workspaceViews.includes(match[2]))return {kind:'workspace',role:'',view:match[2]};
 if(match&&portalRoles.includes(match[2])&&(match[1]==='sign-in'||match[1]==='create-account'&&['family','senior'].includes(match[2])))return {kind:match[1]==='sign-in'?'sign-in':'register',role:match[2],view:''};
 return {kind:'not-found',role:'',view:''};
}
export function workspacePath(view){return workspaceViews.includes(view)?'/workspace/'+view:'/workspace/dashboard';}
export function defaultWorkspace(role){return role==='senior'?'checkin':role==='family'?'family':role==='operations'?'insights':'dashboard';}
export function canOpenWorkspace(view,role,isAdmin=false){
 if(view==='account')return portalRoles.includes(role);
 if(['coordinator','operations'].includes(role))return ['access','system'].includes(view)?role==='operations'&&isAdmin:!['family','family-reports','household'].includes(view)&&workspaceViews.includes(view);
 return (role==='family'?['family','family-reports','checkin','followups','household','communications','deliveries','alerts']:role==='senior'?['checkin','followups','household','communications','deliveries','alerts']:[]).includes(view);
}
export function workspaceDestination(role,isAdmin=false,next=''){
 const route=siteRoute(next);return route.kind==='workspace'&&canOpenWorkspace(route.view,role,isAdmin)?workspacePath(route.view):workspacePath(defaultWorkspace(role));
}
export function signInPath(role='',create=false,{token='',next=''}={}){
 const personal=['senior','family'].includes(role);
 const path=(create?'/create-account':'/sign-in')+(portalRoles.includes(role)&&(!create||personal)?'/'+role:'');
 const url=new URL(path,'https://care.invalid');
 if(siteRoute(next).kind==='workspace'&&next===workspacePath(siteRoute(next).view))url.searchParams.set('next',next);
 if(/^[a-f\d]{64}$/iu.test(token))url.hash='invite='+token.toLowerCase()+(portalRoles.includes(role)?'&role='+role:'');
 return url.pathname+url.search+url.hash;
}
export function canonicalLegacyLink(value){
 const url=new URL(value,'https://care.invalid');
 if(url.hash==='#care-portals')return '/sign-in';
 if(url.pathname==='/'&&(url.searchParams.has('invite')||url.searchParams.has('token')||/^#(?:invite|token)=/u.test(url.hash)))return '/invitations'+url.search+url.hash;
 return null;
}
