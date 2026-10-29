export const isSeniorRecordId=value=>typeof value==='string'&&/^S\d{3,6}$/.test(value);
export class AccountManagementError extends Error{constructor(status,message){super(message);this.status=status;}}
const check=(value,message)=>{if(!value)throw new AccountManagementError(400,message);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function validateAccountAction(action,input={}) {
 check(input&&typeof input==='object'&&!Array.isArray(input),'Provide account details.');
 check(['create','onboard','assign','update','password','delete'].includes(action),'Choose a supported account action.');
 const fields=action==='onboard'?['email','name','age','city','language','password','idempotencyKey']:action==='create'?['email','name','role','seniorIds','allSeniors','password','idempotencyKey']:action==='assign'?['email','role','seniorIds','allSeniors','idempotencyKey']:action==='password'?['targetUserId','confirmReset','password','idempotencyKey']:action==='delete'?['targetUserId','confirmDelete','idempotencyKey']:['targetUserId','name','action','role','seniorIds','allSeniors'];
 check(Object.keys(input).every(key=>fields.includes(key)),'The account request contains unsupported fields.');
 const result={};
 if(['create','onboard','assign'].includes(action)){result.email=typeof input.email==='string'?input.email.trim().toLowerCase():'';check(result.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email),'Enter a valid account email.');}
 if(['password','update','delete'].includes(action)){check(uuid(input.targetUserId),'Choose a valid account.');result.targetUserId=input.targetUserId;}
 if(action==='create'||action==='onboard'||input.name!==undefined){result.name=typeof input.name==='string'?input.name.trim():'';check(result.name.length>=2&&result.name.length<=80,'Enter a name between 2 and 80 characters.');}
 if(action==='update'){check(['update','suspend','restore'].includes(input.action),'Choose update, suspend or restore.');result.action=input.action;}
 if(input.password!==undefined){check(['create','onboard','password'].includes(action)&&typeof input.password==='string'&&input.password.length>=12&&input.password.length<=128,'Choose a password between 12 and 128 characters.');result.password=input.password;}
 if(action==='onboard'){check(Number.isInteger(input.age)&&input.age>=60&&input.age<=120,'Enter an age between 60 and 120.');result.age=input.age;result.city=typeof input.city==='string'?input.city.trim():'';check(result.city.length>=2&&result.city.length<=80,'Enter a city between 2 and 80 characters.');check(['Hindi','English'].includes(input.language),'Choose Hindi or English.');result.language=input.language;}
 if(action==='password'){check(input.confirmReset===true,'Confirm that a new password should replace the current password.');result.confirmReset=true;}
 if(action==='delete'){check(input.confirmDelete===true,'Confirm account deletion. Care records and audit history will be retained.');result.confirmDelete=true;}
 if(action!=='update'){check(uuid(input.idempotencyKey),'Provide a unique request key.');result.idempotencyKey=input.idempotencyKey;}
 if(['create','assign'].includes(action)||action==='update'&&input.role!==undefined){
  check(['senior','family','coordinator'].includes(input.role),'Choose a valid care role.');result.role=input.role;
  check(input.allSeniors===undefined||typeof input.allSeniors==='boolean','Choose an assignment scope.');
  result.allSeniors=input.allSeniors===true;
  check(Array.isArray(input.seniorIds)&&input.seniorIds.length<=200&&input.seniorIds.every(id=>typeof id==='string'&&isSeniorRecordId(id)),'Choose existing seniors from the directory.');
  result.seniorIds=[...new Set(input.seniorIds)].sort();
  check(!result.allSeniors||result.role==='coordinator','Family and senior accounts require specific senior links.');
  check(!result.allSeniors||!result.seniorIds.length,'Choose all seniors or specific seniors, not both.');
  check(result.allSeniors||result.seniorIds.length>0,'Assign at least one senior.');
  check(result.role!=='senior'||result.seniorIds.length===1,'A senior login represents exactly one senior record.');
 }
 check(action!=='update'||result.action!=='update'||result.name!==undefined||result.role!==undefined,'Choose account details to update.');
 return result;
}
