import { supabaseConfiguration } from './supabase-auth.mjs';

/** An allowlisted D1 compatibility layer. SQL text never leaves this process. */
const normal = (sql) => sql.replace(/\s+/g,' ').replace(/\s*([(),=])\s*/g,'$1').trim().toLowerCase();
const statements = new Map();
const register = (op, sql) => statements.set(normal(sql),op);
register('members_insert', "INSERT OR IGNORE INTO care_memberships (id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM care_memberships WHERE workspace_id = ? AND user_id = ? AND role = ? AND senior_id = ? AND status = 'active')");
register('workspace_insert','INSERT OR IGNORE INTO care_workspaces (id,owner_user_id,created_at) VALUES (?,?,?)');
register('workspace_get','SELECT * FROM care_workspaces WHERE id = ?');
register('workspace_get','SELECT id FROM care_workspaces WHERE id = ?');
register('members_own','SELECT * FROM care_memberships WHERE workspace_id = ? AND user_id = ? AND status = ? ORDER BY created_at,id');
register('members_list','SELECT * FROM care_memberships WHERE workspace_id = ? ORDER BY created_at DESC');
register('members_get','SELECT * FROM care_memberships WHERE id = ? AND workspace_id = ?');
register('members_revoke','UPDATE care_memberships SET status = ? WHERE workspace_id = ? AND user_id = ? AND role = ? AND senior_id = ?');
register('session_get','SELECT * FROM demo_sessions WHERE id = ? AND owner = ? AND expires_at > ?');
register('session_delete','DELETE FROM demo_sessions WHERE id = ? AND owner = ?');
register('session_expire','DELETE FROM demo_sessions WHERE owner = ? AND expires_at <= ?');
register('session_revoke','DELETE FROM demo_sessions WHERE owner = ?');
register('session_insert','INSERT INTO demo_sessions (id,owner,role,senior_id,expires_at) VALUES (?,?,?,?,?)');
register('invites_list','SELECT id,email,role,senior_id,status,expires_at,created_at FROM care_invitations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100');
register('invites_get','SELECT * FROM care_invitations WHERE token_hash = ? AND workspace_id = ?');
register('invites_insert','INSERT INTO care_invitations (id,workspace_id,token_hash,email,role,senior_id,scope_json,created_by,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
register('event_insert','INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)');
register('events_list','SELECT id,kind,senior_id,payload,created_at FROM care_events WHERE owner = ? ORDER BY created_at ASC,rowid ASC');
register('event_get','SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?');
register('event_get','SELECT payload,senior_id FROM care_events WHERE id = ? AND owner = ? AND kind = ?');
register('event_update','UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ?');
register('ivr_advance',"UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.state.step') = ?");
register('ivr_insert_once','INSERT OR IGNORE INTO care_events (id,owner,kind,senior_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM care_events WHERE id = ? AND owner = ? AND kind = ? AND payload = ?)');
register('events_expire','DELETE FROM care_events WHERE owner = ? AND kind = ? AND created_at < ?');
register('voice_signals',"SELECT id,payload FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ? ORDER BY created_at,rowid LIMIT 100");
register('voice_claim',"UPDATE care_events SET payload = json_set(payload, '$.peerId', ?, '$.peerRole', ?, '$.status', 'active') WHERE id = ? AND owner = ? AND kind = ? AND (json_extract(payload, '$.peerId') IS NULL OR json_extract(payload, '$.peerId') = ?) AND json_extract(payload, '$.status') <> 'ended' AND json_extract(payload, '$.expiresAt') > ?");
register('voice_end',"UPDATE care_events SET payload = json_set(payload, '$.status', 'ended', '$.endedAt', ?) WHERE id = ? AND owner = ? AND kind = ?");
register('voice_cleanup',"DELETE FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ?");
register('voice_signal_type',"SELECT id FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ? AND json_extract(payload, '$.payload.type') = ? LIMIT 1");
register('voice_count',"SELECT COUNT(*) AS count FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ?");
register('voice_signal_insert',"INSERT OR IGNORE INTO care_events (id,owner,kind,senior_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM care_events WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.status') <> 'ended' AND json_extract(payload, '$.expiresAt') > ? AND (json_extract(payload, '$.createdBy') = ? OR json_extract(payload, '$.peerId') = ?)) AND (SELECT COUNT(*) FROM care_events WHERE owner = ? AND kind = 'voice_signal' AND json_extract(payload, '$.roomId') = ?) < 100");

export class SupabaseStoreError extends Error { constructor(status,message){super(message);this.status=status;} }
export function createSupabaseStore(options={}) {
  const config=supabaseConfiguration(options.env || {SUPABASE_URL:options.url,SUPABASE_PUBLISHABLE_KEY:options.publishableKey});
  const {accessToken,fetchImpl=fetch}=options;
  async function rpc(name,body) {
    let response;
    try { response=await fetchImpl(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${accessToken || config.publishableKey}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(15000)}); }
    catch {throw new SupabaseStoreError(503,'The care database is temporarily unavailable.');}
    let data;try{data=await response.json();}catch{throw new SupabaseStoreError(502,'The care database returned an invalid response.');}
    if(!response.ok){const status=response.status===401?401:response.status===403||data?.code==='42501'?403:data?.code==='23505'?409:503;throw new SupabaseStoreError(status,status===403?'This care account is not permitted to access that record.':status===409?'This change conflicts with an existing record.':'The care database could not complete this request.');}
    return data;
  }
  const db={
    backend:'supabase',
    notificationRouting(action,payload={}){return rpc('care_notification_routing',{action,payload});},
    async accountStatus(){return rpc('care_account_self_state',{});},
    async adminAccount(action,payload){
      const gateway=options.env?.SUPABASE_LEGACY_ANON_KEY;
      if(!gateway||!accessToken)throw new SupabaseStoreError(503,'Account provisioning is not configured.');
      let response;try{response=await fetchImpl(`${config.url}/functions/v1/account-admin`,{method:'POST',headers:{apikey:gateway,Authorization:`Bearer ${gateway}`,'x-samarth-user-token':accessToken,'content-type':'application/json'},body:JSON.stringify({action,payload}),redirect:'manual',signal:AbortSignal.timeout(30000)});}catch{throw new SupabaseStoreError(503,'The account request has an unconfirmed outcome. Refresh the directory before retrying.');}
      const data=await response.json();if(!response.ok)throw new SupabaseStoreError(response.status,typeof data.error==='string'?data.error:'Account management failed.');return data;
    },
    async accountDirectory(){return rpc('care_account_directory',{});},
    async accessDirectory(){return rpc('care_access_directory',{});},
    async manageInvitation({action,invitationId,details={}}){return rpc('care_manage_invitation',{action,invitation_id:invitationId,details});},
    async household(action,payload={}){return rpc('care_household',{action,payload});},
    async conversationRecipients(seniorId){return rpc('care_conversation_recipients',{senior_id:seniorId});},
    async recordRequest(metadata){return rpc('care_record_request',{metadata});},
    async systemStatus(){return rpc('care_system_status',{});},
    async reportJob(action,payload={}){return rpc('care_report_job_action',{action,payload});},
    async recordedProfiles(){return rpc('care_recorded_profiles',{});},
    familySummary:(sid,asOfDate)=>rpc('care_family_summary',{sid,as_of_date:asOfDate}),
    async accountContacts(){return rpc('care_account_phone_contacts',{});},
    async setAccountPhone({userId,phone,smsConsent,callConsent,confirmed}){return rpc('care_set_account_phone',{target_user_id:userId,mobile:phone,sms_allowed:smsConsent,call_allowed:callConsent,recipient_confirmed:confirmed});},
    async setAccountChannels({userId,smsConsent,callConsent,confirmed}){return rpc('care_update_account_channels',{target_user_id:userId,sms_allowed:smsConsent,call_allowed:callConsent,recipient_confirmed:confirmed});},
    prepare(sql){const op=statements.get(normal(sql));if(!op)throw new SupabaseStoreError(500,'This database operation has not been registered for Supabase.');
      const stmt={op,args:[],bind(...args){return {...stmt,args};},async all(){return (await db.batch([this]))[0];},async first(column){const row=(await this.all()).results?.[0]||null;return column?row?.[column]??null:row;},async run(){return this.all();}};return stmt;
    },
    async batch(items){if(!Array.isArray(items)||items.length>100)throw new SupabaseStoreError(400,'A database batch must contain at most 100 registered operations.');return rpc('care_store_batch',{commands:items.map(({op,args})=>({op,args}))});},
    async scanEvents({owner,seniorIds=null,kinds=null,limit=5000,sinceRecordDate=null,beforeCreatedAt=null,beforeSequence=null,ascending=true}={}){return rpc('care_events_scan',{options:{owner,seniorIds,kinds,limit:Math.min(5000,Math.max(1,Number(limit)||5000)),sinceRecordDate,beforeCreatedAt,beforeSequence,ascending}});},
    async history(options){return rpc('care_history',{options});},
    async historyScores(options){return rpc('care_history_scores_put',{options});},
    async historyDirty(options={}){return rpc('care_history_dirty',{options});},
    async workflow(operation,payload={}){return rpc('care_workflow',{operation,payload});},
    async bootstrapOwner(){if(!accessToken)return false;return rpc('care_bootstrap_owner',{});},
    async acceptInvitation({tokenHash,displayName}){return rpc('care_accept_invitation',{token_hash:tokenHash,display_name:displayName});},
  };
  return db;
}
