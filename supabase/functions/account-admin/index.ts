import {createAccountAdminHandler} from '../../../lib/account-admin-service.mjs';
declare const Deno:{env:{get(key:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SECRET_KEYS'].map(key=>[key,Deno.env.get(key)]));
Deno.serve(createAccountAdminHandler(env));
