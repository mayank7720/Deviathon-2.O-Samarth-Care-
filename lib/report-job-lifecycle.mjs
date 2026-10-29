/** Terminal report states are durable. A claimed timeout requires inspection before another inference. */
export const REPORT_JOB_LIFETIME_MS=300000;
export function reportJobView(job){
 const retryAllowed=job.status==='failed'||job.status==='timed_out'&&!job.claimedAt;
 return {status:job.status==='claimed'?'processing':job.status,failureCode:job.failureCode||null,deadlineAt:Number(job.expiresAt)||null,retryAllowed:retryAllowed&&!job.retryJobId,retryJobId:job.retryJobId||null,inspectionRequired:job.status==='timed_out'&&!!job.claimedAt};
}
export async function settleReportJob(db,{id,owner,job,now=Date.now()}){
 if(typeof db.reportJob==='function')return db.reportJob('settle',{id});
 const stored=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,'report_job').first();
 if(!stored)return job;job=typeof stored.payload==='string'?JSON.parse(stored.payload):stored.payload;
 if(!['awaiting_n8n','claimed'].includes(job.status)||Number(job.expiresAt)>now)return job;
 const next={...job,status:'timed_out',failureCode:'deadline_exceeded',finishedAt:new Date(now).toISOString(),...(job.status==='claimed'&&!job.claimedAt?{claimedAt:'unknown'}:{})};
 await db.prepare('UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND payload = ?').bind(JSON.stringify(next),id,owner,'report_job',JSON.stringify(job)).run();
 const saved=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,'report_job').first();
 return typeof saved.payload==='string'?JSON.parse(saved.payload):saved.payload;
}
export async function retryReportJob(db,{id,owner,job,retryId,jobId,now=Date.now()}){
 if(typeof db.reportJob==='function')return db.reportJob('retry',{id,retryId,jobId});
 const stamp=new Date(now).toISOString(),seniorId=job.seniorId;
 job={...job};delete job.seniorId;
 if(job.retryJobId){const row=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(job.retryEventId,owner,'report_job').first();return {created:false,id:row.id,seniorId:row.senior_id,createdAt:row.created_at,job:typeof row.payload==='string'?JSON.parse(row.payload):row.payload};}
 if(!reportJobView(job).retryAllowed)throw Object.assign(new Error('This report needs execution inspection before another model request.'),{status:409});
 const next={...job,jobId,status:'awaiting_n8n',expiresAt:now+REPORT_JOB_LIFETIME_MS,retryOf:job.jobId,envelope:{...job.envelope,jobId}};
 for(const key of ['claimedAt','finishedAt','failureCode','reportId','retryJobId','retryEventId'])delete next[key];
 const parent={...job,retryJobId:jobId,retryEventId:retryId};
 const result=await db.batch([
  db.prepare('UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND payload = ?').bind(JSON.stringify(parent),id,owner,'report_job',JSON.stringify(job)),
  db.prepare('INSERT OR IGNORE INTO care_events (id,owner,kind,senior_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM care_events WHERE id = ? AND owner = ? AND kind = ? AND payload = ?)').bind(retryId,owner,'report_job',seniorId,JSON.stringify(next),stamp,id,owner,'report_job',JSON.stringify(parent))
 ]);
 if(Number(result[0].meta?.changes??result[0].changes??0)!==1)throw Object.assign(new Error('This report retry was already allocated. Refresh its status.'),{status:409});
 return {created:true,id:retryId,seniorId,createdAt:stamp,job:next};
}
