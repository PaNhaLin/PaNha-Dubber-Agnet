export function timeStamp(seconds) {
  const value=Math.max(0,Number(seconds)||0);
  const h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=Math.floor(value%60),cs=Math.floor((value%1)*100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}
export function sanitizeCue(c) {
  if (!c||typeof c!=='object') throw Error('Invalid dialogue');
  const start=Number(c.start),end=Number(c.end);
  if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>14400) throw Error('Invalid subtitle timing');
  return {start,end,original:String(c.original??'').slice(0,2000),khmer:String(c.khmer??'').slice(0,2000),speaker:String(c.speaker??'Narrator').slice(0,50),voiceAssetId:String(c.voiceAssetId??'').slice(0,80),voiceVolume:Math.max(0,Math.min(2,Number(c.voiceVolume??1)||1))};
}
const escapeAss=s=>String(s).replace(/\\/g,'\\\\').replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/\r\n?|\n/g,'\\N');
export function generateASS(cues,{resolution='1280x720'}={}){
  const [w,h]=resolution.split('x').map(Number);
  if(![1280,1920,1080,720].includes(w)||![720,1080,1920,1280].includes(h))throw Error('Invalid resolution');
  const fontSize=Math.round(h*.055);
  const lines=['[Script Info]','Title: PaNha Dubber Studio Pro','ScriptType: v4.00+','WrapStyle: 0',`PlayResX: ${w}`,`PlayResY: ${h}`,'ScaledBorderAndShadow: yes','','[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',`Style: Default,Noto Sans Khmer,${fontSize},&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,1,0,0,0,100,100,0,0,1,2,1,2,36,36,${Math.round(h*.06)},1`,'','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
  for(const raw of cues){const c=sanitizeCue(raw);if(!c.khmer.trim())continue;lines.push(`Dialogue: 0,${timeStamp(c.start)},${timeStamp(c.end)},Default,,0,0,0,,${escapeAss(c.khmer)}`)}
  return lines.join('\n')+'\n';
}
export function mediaContentType(name){const v=String(name||'').toLowerCase();if(v.endsWith('.mp4'))return'video/mp4';if(v.endsWith('.webm'))return'video/webm';if(v.endsWith('.mov'))return'video/quicktime';if(v.endsWith('.mkv'))return'video/x-matroska';if(v.endsWith('.wav'))return'audio/wav';if(v.endsWith('.mp3'))return'audio/mpeg';if(v.endsWith('.m4a'))return'audio/mp4';return'application/octet-stream'}
