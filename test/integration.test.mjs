import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const ffmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
async function exec(cmd,args){return new Promise((resolve,reject)=>{let stderr='';const p=spawn(cmd,args,{windowsHide:true});p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('close',c=>c?reject(Error(stderr)):resolve())})}
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)})}
test('Video upload, subtitle burn-in, render job and MP4 download', {skip:!ffmpeg,timeout:75000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'panha-e2e-'));
 const testVideo=path.join(dir,'sample.mp4');
 let child;
 try{
  await exec('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:r=12','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1.5','-c:v','mpeg4','-q:v','12','-c:a','aac','-shortest',testVideo]);
  const port=await freePort();child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:path.join(dir,'runtime'),APP_PASSWORD:'test-pass'},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`,h={'x-studio-password':'test-pass'};
  for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/status');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  const locked=await fetch(base+'/api/render',{method:'POST'});assert.equal(locked.status,401);
  const media=await fs.readFile(testVideo);
  const uploaded=await fetch(base+'/api/assets',{method:'POST',headers:{...h,'x-filename':'sample.mp4','x-media-kind':'video'},body:media});assert.equal(uploaded.status,201);
  const {assetId}=await uploaded.json();assert.ok(assetId);
  const started=await fetch(base+'/api/render',{method:'POST',headers:{...h,'content-type':'application/json'},body:JSON.stringify({videoAssetId:assetId,cues:[{start:.1,end:1.3,original:'Hello',khmer:'សួស្តី',speaker:'A'}],resolution:'1280x720'})});assert.equal(started.status,202);
  const {jobId}=await started.json();let status;
  for(let i=0;i<70;i++){await new Promise(r=>setTimeout(r,500));const res=await fetch(base+'/api/jobs/'+jobId,{headers:h});status=await res.json();if(status.status!=='queued'&&status.status!=='processing')break}
  assert.equal(status.status,'done',status.progress);
  const output=await fetch(base+'/api/exports/'+jobId,{headers:h});assert.equal(output.status,200);const bytes=Buffer.from(await output.arrayBuffer());assert.ok(bytes.length>5000);assert.equal(bytes.toString('latin1',4,8),'ftyp');
 }finally{child?.kill();await fs.rm(dir,{force:true,recursive:true})}
});
