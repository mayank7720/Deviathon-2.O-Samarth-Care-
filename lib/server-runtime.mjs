/** Standalone Node hosting always uses verified Supabase identities and RLS. */
export function serverRuntime(environment = process.env) {
  return {
    env: { ...environment, SAMARTH_AUTH_MODE: 'supabase' },
    db: undefined,
    local: false,
  };
}

/** Next's standalone server can build an internal localhost URL even when the
 * browser addressed 127.0.0.1. Recover only an exact loopback Host on the same
 * port. Forwarded headers and remote hosts never change the security origin. */
export function normalizeNodeRequest(request) {
  const url=new URL(request.url),host=request.headers.get('host')||'';
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||! /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))return request;
  let incoming;try{incoming=new URL('http://'+host);}catch{return request;}
  if(incoming.port!==url.port||incoming.host===url.host)return request;
  url.host=incoming.host;
  return new Request(url,request);
}
