/** Named storage operations shared by local SQLite and caller-scoped Postgres RPC. */
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const many = async stmt => (await stmt.all()).results;
const payloadRows = rows => rows.map(row => ({...row,payload:parse(row.payload)}));

export async function workflow(db,operation,payload={}) {
  if(typeof db.workflow === 'function') return db.workflow(operation,payload);
  const p=payload;
  switch(operation) {
    case 'runtime_get': return db.prepare('SELECT * FROM care_runtime WHERE owner = ?').bind(p.owner).first();
    case 'runtime_set':
      await db.prepare('INSERT INTO care_runtime (owner,mode,as_of_date,timezone,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET mode=excluded.mode,as_of_date=excluded.as_of_date,timezone=excluded.timezone,updated_at=excluded.updated_at').bind(p.owner,p.mode,p.date,p.timezone,p.updatedAt).run(); return {ok:true};
    case 'scores_get': return payloadRows(await many(db.prepare('SELECT * FROM care_daily_scores WHERE owner = ? AND score_date = ? AND revision = ? AND senior_id > ? ORDER BY senior_id LIMIT ?').bind(p.owner,p.date,p.revision,p.cursor||'',p.limit||250)));
    case 'score_get': {const row=await db.prepare('SELECT * FROM care_daily_scores WHERE owner = ? AND senior_id = ? AND score_date = ?').bind(p.owner,p.seniorId,p.date).first();return row?{...row,payload:parse(row.payload)}:null;}
    case 'scores_put': {
      const statements=p.scores.map(row=>db.prepare('INSERT INTO care_daily_scores (id,owner,senior_id,score_date,revision,payload,computed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,computed_at=excluded.computed_at').bind(`${p.owner}:${p.date}:${row.seniorId}`,p.owner,row.seniorId,p.date,p.revision,JSON.stringify(row.payload),p.computedAt));
      for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));return {count:statements.length};
    }
    case 'consents_get': return many(db.prepare('SELECT senior_id,allowed,updated_at FROM care_consents WHERE owner = ?').bind(p.owner));
    case 'consent_put': await db.prepare('INSERT INTO care_consents (id,owner,senior_id,allowed,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET allowed=excluded.allowed,updated_at=excluded.updated_at').bind(`${p.owner}:${p.seniorId}`,p.owner,p.seniorId,p.allowed?1:0,p.updatedAt).run();return {ok:true};
    case 'consents_seed': {
      const statements=p.consents.map(c=>db.prepare('INSERT OR IGNORE INTO care_consents (id,owner,senior_id,allowed,updated_at) VALUES (?,?,?,?,?)').bind(`${p.owner}:${c.seniorId}`,p.owner,c.seniorId,c.allowed?1:0,p.updatedAt));
      for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));return {ok:true};
    }
    case 'members_get': return many(db.prepare('SELECT id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin FROM care_memberships WHERE workspace_id = ? AND status = ?').bind(p.workspaceId||'primary','active'));
    case 'delivery_put': {
      const result=await db.prepare('INSERT OR IGNORE INTO care_deliveries (id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,attempts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(p.id,p.owner,p.seniorId,p.recipientRole,p.userId,p.kind,p.channel,p.status||'queued',JSON.stringify(p.payload),p.sourceId,p.createdAt,0).run();return {created:Number(result.meta?.changes??result.changes??0)>0};
    }
    case 'deliveries_get': return payloadRows(await many(db.prepare("SELECT * FROM care_deliveries WHERE owner = ? AND (created_at < ? OR (created_at = ? AND id > ?)) AND (? IS NULL OR user_id = ?) AND (? IS NULL OR recipient_role = ?) AND (? IS NULL OR senior_id IN (SELECT value FROM json_each(?))) AND (? IS NULL OR status IN (SELECT value FROM json_each(?))) AND (? IS NULL OR attempts < ?) AND (? IS NULL OR status <> 'processing' OR claimed_at < ?) ORDER BY created_at DESC,id LIMIT ?").bind(p.owner,p.cursor||'9999',p.cursor||'9999',p.cursorId||'',p.userId??null,p.userId??null,p.recipientRole??null,p.recipientRole??null,p.seniorIds?JSON.stringify(p.seniorIds):null,p.seniorIds?JSON.stringify(p.seniorIds):null,p.statuses?JSON.stringify(p.statuses):null,p.statuses?JSON.stringify(p.statuses):null,p.maxAttempts??null,p.maxAttempts??null,p.availableBefore??null,p.availableBefore??null,Math.min(500,Math.max(1,p.limit||250)))));
    case 'delivery_get': {const row=await db.prepare('SELECT * FROM care_deliveries WHERE owner = ? AND id = ?').bind(p.owner,p.id).first();return row?{...row,payload:parse(row.payload)}:null;}
    case 'delivery_update': await db.prepare('UPDATE care_deliveries SET status=?,attempts=?,delivered_at=?,read_at=?,last_error=?,claimed_at=NULL WHERE id=? AND owner=?').bind(p.status,p.attempts??0,p.deliveredAt??null,p.readAt??null,p.lastError??null,p.id,p.owner).run();return {ok:true};
    case 'delivery_claim': {
      const result=await db.prepare("UPDATE care_deliveries SET status='processing',attempts=attempts+1,claimed_at=? WHERE owner=? AND id=? AND attempts=? AND attempts<3 AND (status IN ('queued','failed') OR (status='processing' AND claimed_at<?))").bind(p.claimedAt,p.owner,p.id,p.attempts,p.expiredBefore).run();return {claimed:Number(result.meta?.changes??result.changes??0)>0};
    }
    case 'delivery_read': await db.prepare("UPDATE care_deliveries SET status='read',read_at=? WHERE owner=? AND id=? AND user_id=? AND recipient_role=? AND channel='in_app' AND status IN ('delivered','read')").bind(p.readAt,p.owner,p.id,p.userId,p.recipientRole).run();return {ok:true};
    case 'alert_seen_put': {
      await db.prepare("INSERT OR IGNORE INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,'alert_seen',?,?,?)").bind(p.id,p.owner,p.seniorId,JSON.stringify({alertId:p.alertId,firstSeenAt:p.firstSeenAt}),p.firstSeenAt).run();
      const row=await db.prepare("SELECT payload FROM care_events WHERE owner=? AND id=? AND kind='alert_seen'").bind(p.owner,p.id).first();return row?parse(row.payload):null;
    }
    case 'push_get': return (await many(db.prepare('SELECT * FROM care_push_subscriptions WHERE owner = ? AND user_id = ? AND disabled = 0 ORDER BY created_at DESC LIMIT 10').bind(p.owner,p.userId))).map(row=>({...row,subscription:parse(row.subscription_json)}));
    case 'push_put': await db.prepare('INSERT INTO care_push_subscriptions (id,owner,user_id,endpoint,subscription_json,created_at,disabled) VALUES (?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET subscription_json=excluded.subscription_json,disabled=0').bind(p.id,p.owner,p.userId,p.subscription.endpoint,JSON.stringify(p.subscription),p.createdAt).run();return {ok:true};
    case 'push_delete': await db.prepare('UPDATE care_push_subscriptions SET disabled=1 WHERE owner=? AND user_id=? AND endpoint=?').bind(p.owner,p.userId,p.endpoint).run();return {ok:true};
    case 'job_get': return db.prepare('SELECT * FROM care_jobs WHERE owner=? AND id=?').bind(p.owner,p.id).first();
    case 'job_put': await db.prepare('INSERT INTO care_jobs (id,owner,kind,job_date,status,result_json,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,result_json=excluded.result_json,completed_at=excluded.completed_at').bind(p.id,p.owner,'daily',p.date,p.status,JSON.stringify(p.result||{}),p.createdAt,p.completedAt??null).run();return {ok:true};
    default: throw new Error(`Unsupported workflow operation: ${operation}`);
  }
}

class EventHistoryError extends Error {constructor(message){super(message);this.name='EventHistoryError';this.status=503;}}
async function eventPage(db,{owner,seniorIds=null,kinds=null,limit=1000,sinceRecordDate=null,beforeCreatedAt=null,beforeSequence=null}) {
  if(typeof db.scanEvents==='function'){
    const result=await db.scanEvents({owner,seniorIds,kinds,limit,sinceRecordDate,beforeCreatedAt,beforeSequence,ascending:false});
    if(!Array.isArray(result?.results))throw new EventHistoryError('The care history reader returned an invalid page.');
    return result.results;
  }
  return many(db.prepare("SELECT id,kind,senior_id,payload,created_at,rowid AS sequence FROM care_events WHERE owner = ? AND (? IS NULL OR senior_id = '' OR senior_id IN (SELECT value FROM json_each(?))) AND (? IS NULL OR kind IN (SELECT value FROM json_each(?))) AND (? IS NULL OR kind <> 'signal' OR json_extract(payload,'$.record.date') >= ?) AND (? IS NULL OR created_at < ? OR (created_at = ? AND rowid < ?)) ORDER BY created_at DESC,rowid DESC LIMIT ?")
    .bind(owner,seniorIds?JSON.stringify(seniorIds):null,seniorIds?JSON.stringify(seniorIds):null,kinds?JSON.stringify(kinds):null,kinds?JSON.stringify(kinds):null,sinceRecordDate,sinceRecordDate,beforeCreatedAt,beforeCreatedAt,beforeCreatedAt,beforeSequence,limit));
}

/** Explicitly bounded read for replaceable status, never authoritative history. */
export async function scanLatestEvents(db,options={}) {
  const limit=Math.min(5000,Math.max(1,Number(options.limit)||1));
  return (await eventPage(db,{...options,limit})).slice().reverse();
}

/**
 * Drain indexed keyset pages rather than silently dropping older records.
 * `limit` controls page size for compatibility with earlier callers. A failed
 * page or exhausted protective guard fails the request instead of resetting
 * consent, care state or historical inputs from an incomplete snapshot.
 */
export async function scanEvents(db,options={}) {
  const limit=Math.min(1000,Math.max(1,Number(options.limit)||1000));
  const rows=[],seen=new Set();let beforeCreatedAt=null,beforeSequence=null;
  for(let page=0;page<200;page++){
    const result=await eventPage(db,{...options,limit,beforeCreatedAt,beforeSequence});
    if(result.length>limit)throw new EventHistoryError('The care history page exceeded its requested size.');
    for(const row of result){
      if(!row?.id||seen.has(row.id))throw new EventHistoryError('The care history cursor repeated a record. Retry before making changes.');
      seen.add(row.id);rows.push(row);
    }
    if(result.length<limit)return rows.reverse();
    const last=result.at(-1),sequence=String(last?.sequence??'');
    if(typeof last?.created_at!=='string'||!/^\d+$/.test(sequence)||sequence==='0'||(last.created_at===beforeCreatedAt&&sequence===String(beforeSequence)))throw new EventHistoryError('Complete care history could not be retrieved. No records have been reset.');
    beforeCreatedAt=last.created_at;beforeSequence=sequence;
  }
  throw new EventHistoryError('The care history exceeded the safe request budget. Use a narrower date range; no records have been reset.');
}
