const item=(id,label,icon)=>({id,label,icon});
/** One menu definition shared by route tests and the workspace. No permissions are granted here. */
export function workspaceNavigation(role,isAdmin=false,canWrite=false){
 if(['coordinator','operations'].includes(role))return [
  {label:'Daily care',items:[item('dashboard','Care overview','grid'),item('phone-support','Incoming help','phone'),item('alerts','Alerts','bell'),item('followups','Follow-ups','calendar'),item('seniors','Senior directory','people'),...(canWrite?[item('checkin','Record an update','note')]:[])]},
  {label:'Health review',items:[item('analysis','Risk & wellbeing','heart'),item('monitoring','Health charts','chart'),item('medications','Medication patterns','check'),item('reports','Weekly AI summaries','note')]},
  {label:'Communication',items:[item('telephony','Calls & SMS','phone'),item('communications','Care conversations','people'),item('speech','Voice notes','note'),item('deliveries','Notifications','bell')]},
  {label:'Management',items:[item('insights','Team outcomes','chart'),item('care-operations','Care assignments','people'),...(role==='operations'&&isAdmin?[item('access','Accounts & invitations','shield'),item('system','Services & integrations','grid')]:[]),item('account','My account','shield')]}
 ];
 return [
  {label:role==='family'?'Family care':'My care',items:[...(role==='family'?[item('family','Family overview','heart'),item('family-reports','Weekly summaries','note')]:[]),item('checkin',role==='family'?'Share an update':'My wellbeing','heart'),item('followups','Follow-ups','calendar'),item('communications','Talk to care team','phone'),item('alerts','Care updates','bell'),item('deliveries','Notifications','bell')]},
  {label:'Account',items:[item('household',role==='family'?'Family & senior links':'Family access','people'),item('account','My account','shield')]}
 ];
}
