import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {generateASS,sanitizeCue,mediaContentType} from './lib/media.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC=path.join(ROOT,'public');
const DATA=process.env.DATA_DIR||path.join(os.tmpdir(),'panha-studio-runtime');
const UPLOAD=path.join(DATA,'uploads'), OUTPUT=path.join(DATA,'exports');
const PORT=Number(process.env.PORT||3002);
const MAX_UPLOAD=Number(process.env.MAX_UPLOAD_MB||250)*1024*1024;
const ASSETS=new Map(), JOBS=new Map();
const AI_BASE=(process.env.AI_BASE_URL||'http://127.0.0.1:8878/v1').replace(/\/$/,'');
const AI_KEY=process.env.AI_API_KEY||'';
const AI_MODEL=process.env.AI_MODEL||'gpt-4o-mini';
const TTS_MODEL=process.env.TTS_MODEL||'tts-1';
const ASR_MODEL=process.env.ASR_MODEL||'whisper-1';
const PASSWORD=process.env.APP_PASSWORD||'';
const MAX_CONCURRENT_JOBS=Math.max(1,Math.min(3,Number(process.env.MAX_CONCURRENT_JOBS||2)));
if(process.env.NODE_ENV==='production'&&!PASSWORD)throw Error('APP_PASSWORD must be configured for production deployment.');

function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function error(res,code,msg){json(res,code,{error:msg})}
function secureMatch(candidate){
 const supplied=Buffer.from(String(candidate||''));
 const expected=Buffer.from(PASSWORD);
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
function authorized(req){
 if(!PASSWORD)return true;
 if(secureMatch(req.headers['x-studio-password']))return true;
 const auth=String(req.headers.authorization||'');
 if(!auth.startsWith('Basic '))return false;
 try{
  const decoded=Buffer.from(auth.slice(6),'base64').toString('utf8');
  const colon=decoded.indexOf(':');
  return colon>=0&&decoded.slice(0,colon)==='studio'&&secureMatch(decoded.slice(colon+1));
 }catch{return false;}
}
async function jsonBody(req,limit=1_000_000){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('Request body too large'),{status:413});chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
function run(cmd,args,{timeout=180000}={}){return new Promise((resolve,reject)=>{let err='',out='';const proc=spawn(cmd,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let done=false;const timer=setTimeout(()=>{proc.kill('SIGKILL')},timeout);proc.on('error',e=>{clearTimeout(timer);if(!done){done=true;reject(e)}});proc.stdout.on('data',d=>{if(out.length<200000)out+=d.toString()});proc.stderr.on('data',d=>{if(err.length<200000)err+=d.toString()});proc.on('close',code=>{clearTimeout(timer);if(done)return;done=true;if(code===0)resolve({out,err});else reject(Error(`${cmd} failed: ${(err||out).slice(-1600)}`))})})}
async function probe(file){const {out}=await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',file],{timeout:30000});const p=JSON.parse(out);return {duration:Number(p.format?.duration||0),hasAudio:(p.streams||[]).some(s=>s.codec_type==='audio'),hasVideo:(p.streams||[]).some(s=>s.codec_type==='video')}}
function getAsset(id,kind){const a=ASSETS.get(String(id||''));if(!a||(kind&&a.kind!==kind))throw Object.assign(Error('Unknown or expired media asset'),{status:404});return a}
async function saveUpload(req,kind){const length=Number(req.headers['content-length']||0);if(length>MAX_UPLOAD)throw Object.assign(Error('File exceeds upload limit'),{status:413});const original=decodeURIComponent(String(req.headers['x-filename']||'media.mp4')).slice(0,150).replace(/[\\/\x00-\x1f]/g,'_');if(!/\.(mp4|mov|webm|mkv|mp3|wav|m4a)$/i.test(original))throw Object.assign(Error('Unsupported media format'),{status:400});const id=randomUUID(),file=path.join(UPLOAD,id+path.extname(original).toLowerCase());let size=0;const output=fs.createWriteStream(file,{flags:'wx'});try{for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD){req.destroy();throw Object.assign(Error('File too large'),{status:413})}if(!output.write(chunk))await new Promise(r=>output.once('drain',r))}await new Promise((resolve,reject)=>output.end(e=>e?reject(e):resolve()));if(!size)throw Error('Empty upload');const a={id,file,name:original,size,kind,at:Date.now()};ASSETS.set(id,a);return a}catch(e){output.destroy();await fsp.rm(file,{force:true});throw e}}
function aiHeaders(contentType='application/json'){return {'Authorization':`Bearer ${AI_KEY||'local-gateway'}`,'Content-Type':contentType}}
async function aiRequest(url,options){const response=await fetch(url,{...options,signal:AbortSignal.timeout(120000)});if(!response.ok){const msg=(await response.text()).slice(0,700);throw Object.assign(Error(`AI provider error ${response.status}: ${msg}`),{status:502})}return response}
async function translate(cues,from){if(!AI_KEY && !AI_BASE.includes('127.0.0.1') && !AI_BASE.includes('localhost'))throw Error('AI_API_KEY has not been configured');const prompt='Translate every subtitle naturally into Cambodian Khmer. Preserve names, emotions and meaning. Output ONLY a JSON array of strings, one result per input line, matching input order. Do not add formatting or explanatory text.';const response=await aiRequest(AI_BASE+'/chat/completions',{method:'POST',headers:aiHeaders(),body:JSON.stringify({model:AI_MODEL,temperature:0.2,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({sourceLanguage:from||'auto',lines:cues})}]})});const body=await response.json();let v=body.choices?.[0]?.message?.content||'';if(Array.isArray(v))v=v.map(x=>x.text||'').join('');v=v.replace(/^```(?:json)?\s*|\s*```$/g,'').trim();const result=JSON.parse(v);if(!Array.isArray(result)||result.length!==cues.length||result.some(x=>typeof x!=='string'))throw Error('AI returned invalid translation format');return result}
async function generateVoice(text,voice){if(!AI_KEY && !AI_BASE.includes('127.0.0.1') && !AI_BASE.includes('localhost'))throw Error('AI_API_KEY has not been configured');const result=await aiRequest(AI_BASE+'/audio/speech',{method:'POST',headers:aiHeaders(),body:JSON.stringify({model:TTS_MODEL,voice:voice||'alloy',input:text,response_format:'mp3'})});const arr=Buffer.from(await result.arrayBuffer());if(!arr.length||arr.length>20*1024*1024)throw Error('Voice engine returned an invalid audio response');const id=randomUUID(),file=path.join(UPLOAD,id+'.mp3');await fsp.writeFile(file,arr);ASSETS.set(id,{id,file,name:'voice.mp3',size:arr.length,kind:'audio',at:Date.now()});return id}
async function transcribe(asset){const tmp=path.join(UPLOAD,randomUUID()+'.mp3');try{await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',asset.file,'-vn','-ac','1','-ar','16000','-b:a','32k',tmp],{timeout:180000});const audio=await fsp.readFile(tmp);if(audio.length>24*1024*1024)throw Error('Audio longer than supported transcription request; use a shorter clip.');const form=new FormData();form.append('model',ASR_MODEL);form.append('file',new Blob([audio],{type:'audio/mpeg'}),'audio.mp3');form.append('response_format','verbose_json');const response=await aiRequest(AI_BASE+'/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${AI_KEY||'local-gateway'}`},body:form});const data=await response.json();return {text:data.text||'',segments:(data.segments||[]).map((x,i)=>({start:Number(x.start||0),end:Number(x.end||x.start+3),original:String(x.text||''),khmer:'',speaker:'Speaker '+(i%2+1)}))}}finally{await fsp.rm(tmp,{force:true})}}
async function renderJob(job,body){try{
 job.status='processing';job.progress='Validating project';
 const video=getAsset(body.videoAssetId,'video');const p=await probe(video.file);if(!p.hasVideo)throw Error('Uploaded file does not contain a video stream');
 const cues=(body.cues||[]).slice(0,500).map(sanitizeCue);const resolution=body.resolution==='1920x1080'?'1920x1080':'1280x720';
 const jobDir=path.join(OUTPUT,job.id);await fsp.mkdir(jobDir,{recursive:true});
 const ass=path.join(jobDir,'captions.ass');await fsp.writeFile(ass,generateASS(cues,{resolution}),'utf8');
 const result=path.join(jobDir,'PaNha_Dubbed_Video.mp4');
 const voiceCues=cues.filter(c=>c.voiceAssetId).slice(0,80).map(c=>({...c,asset:getAsset(c.voiceAssetId,'audio')}));
 const args=['-hide_banner','-loglevel','error','-y','-i',video.file];for(const c of voiceCues)args.push('-i',c.asset.file);
 const targetWidth=resolution==='1920x1080'?1920:1280,targetHeight=resolution==='1920x1080'?1080:720;
 const assFile=ass.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");
 let filters=`scale=w=${targetWidth}:h=${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,ass='${assFile}'`;
 args.push('-vf',filters);
 if(voiceCues.length){
  const chains=[];const inputs=[];if(p.hasAudio){chains.push(`[0:a]volume=${Math.max(0,Math.min(1,Number(body.originalVolume??.25)))}[bg]`);inputs.push('[bg]')}
  voiceCues.forEach((c,i)=>{const delay=Math.round(c.start*1000);chains.push(`[${i+1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${delay}|${delay},volume=${c.voiceVolume}[v${i}]`);inputs.push(`[v${i}]`)});
  chains.push(`${inputs.join('')}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0[mixed]`);
  chains.push(`[mixed]apad=whole_dur=${Math.max(1,p.duration).toFixed(3)}[mix]`);
  args.push('-filter_complex',chains.join(';'),'-map','0:v:0','-map','[mix]');
 }else if(p.hasAudio){args.push('-map','0:v:0','-map','0:a:0')}else{args.push('-map','0:v:0','-an')}
 args.push('-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p',...(p.hasAudio||voiceCues.length?['-c:a','aac','-b:a','160k']:[]),'-movflags','+faststart',...(p.duration>0?['-t',String(p.duration)]:[]),result);
 job.progress='Rendering video using FFmpeg';await run('ffmpeg',args,{timeout:900000});
 const stat=await fsp.stat(result);job.status='done';job.progress='Complete';job.bytes=stat.size;job.file=result;
 }catch(e){job.status='error';job.progress=e.message.slice(0,700);console.error('Render failed:',job.progress)}}
const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function serveStatic(res,pathname){let urlPath=pathname==='/'?'/index.html':pathname;let file=path.resolve(PUBLIC,'.'+decodeURIComponent(urlPath));if(!file.startsWith(PUBLIC+path.sep))return error(res,403,'Forbidden');try{const st=await fsp.stat(file);if(!st.isFile())throw Error('not file');res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'application/octet-stream')+(path.extname(file)==='.wasm'?'':'; charset=utf-8'),'Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res)}catch{error(res,404,'Not found')}}
function sendDownload(res,file,name,contentType){res.writeHead(200,{'Content-Type':contentType,'Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'private, no-store'});fs.createReadStream(file).pipe(res)}
async function handle(req,res){try{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.xethub.hf.co; object-src 'none'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');const pn=url.pathname;
 if(pn==='/healthz'&&req.method==='GET')return json(res,200,{ok:true});
 if(!authorized(req)){res.setHeader('WWW-Authenticate','Basic realm="PaNha Dubber Studio Pro", charset="UTF-8"');return error(res,401,'Sign in with username studio and your private studio password.');}
 if(pn==='/api/status'&&req.method==='GET')return json(res,200,{name:'PaNha Dubber Studio Pro',version:'1.0.0-mvp',aiConfigured:!!AI_KEY||(process.env.NODE_ENV!=='production'&&AI_BASE.includes('127.0.0.1')),gateway:AI_BASE.includes('127.0.0.1')?'local':'configured',passwordRequired:!!PASSWORD,features:{video:true,subtitles:true,render:true,translation:true,tts:true,transcription:true}});
 if(pn.startsWith('/api/')){
  if(!authorized(req))return error(res,401,'Studio access password required or incorrect');
  if(pn==='/api/assets'&&req.method==='POST'){const kind=req.headers['x-media-kind']==='audio'?'audio':'video';const asset=await saveUpload(req,kind);return json(res,201,{assetId:asset.id,name:asset.name,size:asset.size})}
  if(pn.startsWith('/api/assets/')&&req.method==='GET'){const a=getAsset(pn.split('/')[3]);res.writeHead(200,{'Content-Type':mediaContentType(a.name),'Cache-Control':'private,no-store','Accept-Ranges':'none'});return fs.createReadStream(a.file).pipe(res)}
  if(pn==='/api/translate'&&req.method==='POST'){const b=await jsonBody(req);if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)return error(res,400,'Please submit 1–100 subtitle lines');const lines=b.lines.map(x=>String(x).slice(0,2000));return json(res,200,{translations:await translate(lines,b.sourceLanguage)})}
  if(pn==='/api/tts'&&req.method==='POST'){const b=await jsonBody(req);const t=String(b.text||'').trim();if(!t||t.length>1500)return error(res,400,'Voice text must be 1–1500 characters');return json(res,200,{assetId:await generateVoice(t,String(b.voice||'alloy'))})}
  if(pn==='/api/transcribe'&&req.method==='POST'){const b=await jsonBody(req);return json(res,200,await transcribe(getAsset(b.videoAssetId,'video')))}
  if(pn==='/api/render'&&req.method==='POST'){if([...JOBS.values()].filter(x=>x.status==='processing'||x.status==='queued').length>=MAX_CONCURRENT_JOBS)return error(res,429,'Export queue is full. Please try after a previous render finishes.');const b=await jsonBody(req,3000000);if(!Array.isArray(b.cues)||b.cues.length>500)return error(res,400,'Too many dialogue lines');const id=randomUUID();const job={id,status:'queued',progress:'Starting',at:Date.now()};JOBS.set(id,job);setImmediate(()=>renderJob(job,b));return json(res,202,{jobId:id})}
  if(pn.startsWith('/api/jobs/')&&req.method==='GET'){const id=pn.split('/')[3];const job=JOBS.get(id);if(!job)return error(res,404,'Unknown export job');return json(res,200,{jobId:id,status:job.status,progress:job.progress,bytes:job.bytes||0,downloadUrl:job.status==='done'?'/api/exports/'+id:null})}
  if(pn.startsWith('/api/exports/')&&req.method==='GET'){const job=JOBS.get(pn.split('/')[3]);if(!job||job.status!=='done')return error(res,404,'Export not ready');return sendDownload(res,job.file,'PaNha_Dubbed_Video.mp4','video/mp4')}
  return error(res,404,'Unknown API endpoint');
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return error(res,405,'Method not allowed');return serveStatic(res,pn)
 }catch(e){const status=e.status||500;console.error('[API]',e.message);if(!res.headersSent)error(res,status,status===500?e.message: e.message)}}
await Promise.all([fsp.mkdir(UPLOAD,{recursive:true}),fsp.mkdir(OUTPUT,{recursive:true})]);
// Automatic cleanup keeps public deployments from retaining uploaded media indefinitely.
const RETENTION_MS=24*60*60*1000;
const maintenance=setInterval(async()=>{
 const deadline=Date.now()-RETENTION_MS;
 for(const [id,a] of ASSETS){if(a.at<deadline){ASSETS.delete(id);await fsp.rm(a.file,{force:true}).catch(()=>{})}}
 for(const [id,j] of JOBS){if(j.at<deadline&&j.status!=='processing'&&j.status!=='queued'){JOBS.delete(id);await fsp.rm(path.join(OUTPUT,id),{recursive:true,force:true}).catch(()=>{})}}
},60*60*1000);maintenance.unref();
const server=http.createServer(handle);server.requestTimeout=16*60*1000;server.listen(PORT,'0.0.0.0',()=>console.log(`PaNha Dubber Studio Pro listening on http://localhost:${PORT}`));
