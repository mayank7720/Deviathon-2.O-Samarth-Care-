/** A relay uses an assigned human account; selecting a role never grants its scope. */
export function relayRole(env={}){
 const role=env.SAMARTH_RELAY_ROLE||'coordinator';
 if(!['coordinator','operations'].includes(role))throw new Error('Set the relay role to coordinator or operations for the configured care account.');
 return role;
}
