import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureDependencies, verifyDependencies } from '../lib/setup.mjs';
import { fileURLToPath } from 'node:url';
test('installed local dependencies load successfully',async()=>{
  await verifyDependencies(fileURLToPath(new URL('../',import.meta.url)));
});
test('missing dependencies are installed then rechecked before startup',async()=>{
  let installed=false,checks=0,installs=0;
  await ensureDependencies({root:'.',log:()=>{},check:async()=>{checks++;if(!installed)throw Error('missing');},runInstall:async()=>{installs++;installed=true;}});
  assert.equal(checks,2);assert.equal(installs,1);
});
test('installation failure blocks startup with an actionable error',async()=>{
  await assert.rejects(()=>ensureDependencies({root:'.',log:()=>{},check:async()=>{throw Error('missing');},runInstall:async()=>{throw Error('network unavailable');}}),/平台尚未启动/);
});
test('incomplete installation is rejected even if npm exits successfully',async()=>{
  await assert.rejects(()=>ensureDependencies({root:'.',log:()=>{},check:async()=>{throw Error('broken');},runInstall:async()=>{}}),/安装失败/);
});
