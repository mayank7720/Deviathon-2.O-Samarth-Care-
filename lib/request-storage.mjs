/** Request metadata never contains bodies, notes, query values, tokens or credentials. */
export function requestMetadata(request,response,{id=crypto.randomUUID(),startedAt=Date.now(),now=Date.now()}={}) {
 const raw=new URL(request.url).pathname.replace(/^\/api\/?/,'').split('/');
 const categories=new Set(['auth','access','accounts','household','portal-care','checkins','communications','reports','integrations','history','signals','tasks','session','runtime','dashboard','seniors','alerts','analysis','deliveries','notifications','telephony','speech','care-operations','sim-calls','motion','health']);
 return {requestId:id,category:categories.has(raw[0])?raw[0]:'care',method:request.method,status:response.status,durationMs:Math.max(0,Math.min(300000,Math.round(now-startedAt)))};
}
export async function recordRequestResult(db,request,response,startedAt) {
 if(typeof db.recordRequest!=='function')return response;
 const metadata=requestMetadata(request,response,{startedAt});
 let stored=false;
 try{stored=(await db.recordRequest(metadata))?.stored===true;}catch{ /* The domain write is already committed; do not misreport it as failed. */ }
 const headers=new Headers(response.headers);headers.set('x-care-request-id',metadata.requestId);headers.set('x-care-request-log',stored?'stored':'unavailable');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
