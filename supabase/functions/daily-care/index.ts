import { createDailyCareHandler } from '../../../lib/service-job-store.mjs';
import { runWorkspaceDaily } from '../../../lib/job-runner.mjs';

// Deno owns these automatic server-only credentials. No request can supply an
// endpoint, workspace, service key or arbitrary SQL operation.
const runtime=globalThis as typeof globalThis & {
  Deno?: {
    env:{get(name:string):string|undefined};
    serve(handler:(request:Request)=>Promise<Response>):unknown;
  };
};
if(runtime.Deno) {
  const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SECRET_KEYS','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'].map(name=>[name,runtime.Deno!.env.get(name)]));
  runtime.Deno.serve(createDailyCareHandler(env,runWorkspaceDaily));
}
