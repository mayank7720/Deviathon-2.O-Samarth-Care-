import test from 'node:test';
import assert from 'node:assert/strict';
import {adbDevices,inspectAndroidPhone} from '../scripts/device-preflight.mjs';

const fixtureEnv={SAMARTH_ANDROID_GATEWAY_USERNAME:'private-user',SAMARTH_ANDROID_GATEWAY_PASSWORD:'private-password',SAMARTH_RELAY_EMAIL:'fixture@example.test',SAMARTH_RELAY_PASSWORD:'fixture-password',SAMARTH_ANDROID_BRIDGE_SECRET:'fixture-only-bridge-secret-longer-than-32'};
test('Android preflight reports unauthorized pairing without device identifiers or phone actions',()=>{
  const commands=[];const report=inspectAndroidPhone({env:{},exists:()=>false,run:(file,args)=>{commands.push(args);return {ok:true,output:args[0]==='devices'?'List of devices attached\nPRIVATE_SERIAL unauthorized usb:1-2\n':'Android Debug Bridge version 1'};}});
  assert.equal(report.checks.authorization,'unauthorized');assert.equal(report.readyForGatewayProbe,false);assert.equal(report.permissionsGranted,0);assert.equal(report.smsSent,0);assert.equal(report.callsStarted,0);
  assert.deepEqual(commands,[['version'],['devices','-l']]);assert.ok(!JSON.stringify(report).includes('PRIVATE_SERIAL'));assert.match(report.nextSteps[0],/Unlock/);
});
test('authorized Android inspection restricts commands to model/version and forwarding reads',()=>{
  const commands=[];const report=inspectAndroidPhone({env:fixtureEnv,exists:()=>false,run:(file,args)=>{commands.push(args);let output='Android Debug Bridge version 1';if(args[0]==='devices')output='List of devices attached\nPRIVATE_SERIAL device product:fixture\n';if(args.includes('ro.product.model'))output='RMX3393\n';if(args.includes('ro.build.version.release'))output='14\n';if(args[0]==='forward')output='PRIVATE_SERIAL tcp:8080 tcp:8080\n';return {ok:true,output};}});
  assert.equal(report.readyForGatewayProbe,true);assert.equal(report.checks.model,'RMX3393');assert.equal(report.checks.androidVersion,'14');assert.equal(report.checks.usbGatewayForwarded,true);
  assert.ok(commands.every(args=>['version','devices','forward'].includes(args[0])||args[0]==='-s'&&args[2]==='shell'&&args[3]==='getprop'));
  for(const secret of ['PRIVATE_SERIAL',...Object.values(fixtureEnv)])assert.ok(!JSON.stringify(report).includes(secret));
});
test('multiple devices and placeholder credentials never look ready',()=>{
  const commands=[];const report=inspectAndroidPhone({env:{...fixtureEnv,SAMARTH_ANDROID_GATEWAY_USERNAME:'REPLACE_FROM_PHONE'},exists:()=>false,run:(file,args)=>{commands.push(args);return {ok:true,output:args[0]==='devices'?'List of devices attached\na device\nb unauthorized\n':''};}});
  assert.equal(report.checks.authorization,'multiple_devices_choose_one');assert.equal(report.checks.gatewayCredentialsConfigured,false);assert.equal(report.readyForGatewayProbe,false);assert.equal(commands.length,2);
  assert.deepEqual(adbDevices('* daemon started successfully\nList of devices attached\na offline\n'),[{serial:'a',state:'offline'}]);
});
