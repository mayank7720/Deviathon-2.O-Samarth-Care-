import test from 'node:test';import assert from 'node:assert/strict';
import {callingPolicy,callWindowAllowed,assertCallingPolicy,DEFAULT_CALLING_POLICY} from '../lib/calling-policy.mjs';
import {assertSavedVoiceCallWindow} from '../lib/voice-dispatch.mjs';
const at=time=>Date.parse('2026-10-31T'+time+':00+05:30');
test('Operations calling window has inclusive start, exclusive end, overnight and all-day controls',()=>{
 const p={...DEFAULT_CALLING_POLICY};
 assert.equal(callWindowAllowed(p,at('08:00')),true);assert.equal(callWindowAllowed(p,at('19:59')),true);assert.equal(callWindowAllowed(p,at('20:00')),false);
 const overnight={...p,start:'22:00',end:'06:00'};for(const t of ['22:00','23:59','00:00','05:59'])assert.equal(callWindowAllowed(overnight,at(t)),true);
 assert.equal(callWindowAllowed(overnight,at('06:00')),false);
 assert.equal(callWindowAllowed({...p,restrictHours:false},at('02:00')),true);
 assert.equal(callWindowAllowed({...p,helpOutsideHours:true},at('02:00'),true),true);
 assert.equal(callWindowAllowed({...p,helpOutsideHours:true},at('02:00'),false),false);
 assert.equal(callWindowAllowed({...p,callsEnabled:false,restrictHours:false,helpOutsideHours:true},at('12:00'),true),false);
 for(const patch of [{start:'25:00'},{end:'aa'},{callsEnabled:'yes'},{start:'20:00'}])assert.throws(()=>callingPolicy({...p,...patch}));
 assert.throws(()=>assertCallingPolicy({...p,callsEnabled:false},at('12:00')),/paused/);
});
test('saved dispatch policy takes precedence over the retired demo window for manual and automatic jobs',()=>{
 const now=at('02:00'),p={...DEFAULT_CALLING_POLICY,restrictHours:false};
 assert.doesNotThrow(()=>assertSavedVoiceCallWindow({}, {SAMARTH_CALL_POLICY:p},now));
 assert.throws(()=>assertSavedVoiceCallWindow({}, {SAMARTH_CALL_POLICY:{...p,callsEnabled:false},SAMARTH_CALL_DEMO_UNTIL:new Date(now+60000).toISOString()},now),/paused/);
 assert.doesNotThrow(()=>assertSavedVoiceCallWindow({sourceRequestId:'saved-help-id'}, {SAMARTH_CALL_POLICY:{...DEFAULT_CALLING_POLICY,helpOutsideHours:true}},now));
 assert.throws(()=>assertSavedVoiceCallWindow({}, {SAMARTH_CALL_POLICY:'bad-json'},now),/could not be read/);
});
