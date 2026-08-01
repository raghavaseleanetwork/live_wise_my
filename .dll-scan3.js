const fs=require('fs'),path=require('path');
const SIG=Buffer.from([0x24,0x1a,0x9c,0x92,0x6d,0x85,0xce,0x6d]);
let bad=0,scanned=0,dirs=0;const ex=[];const times=[];
function walk(d,depth){ if(depth>6)return; dirs++;
 let ents;try{ents=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
 for(const e of ents){const p=path.join(d,e.name);
  if(e.isDirectory())walk(p,depth+1);
  else if(e.isFile()){scanned++;let fd;try{fd=fs.openSync(p,'r');}catch{continue;}
   const b=Buffer.alloc(8);try{fs.readSync(fd,b,0,8,0);}catch{fs.closeSync(fd);continue;}fs.closeSync(fd);
   if(b.equals(SIG)){bad++;if(ex.length<12)ex.push(p);try{times.push(fs.statSync(p).mtime);}catch{}}}}}
walk('node_modules',0);
console.log('scanned:',scanned,'dirs:',dirs);
console.log('ENCRYPTED:',bad, bad&&scanned?('('+(100*bad/scanned).toFixed(2)+'%)'):'');
ex.forEach(e=>console.log('  ',e));
if(times.length){times.sort((a,b)=>a-b);
 console.log('earliest mtime:',times[0].toISOString());
 console.log('latest   mtime:',times[times.length-1].toISOString());}
