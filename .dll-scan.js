const fs=require('fs'),path=require('path');
const SIG=Buffer.from([0x24,0x1a,0x9c,0x92,0x6d,0x85,0xce,0x6d]);
let nm=0,src=0,scanned=0;const exSrc=[],exNm=[];
function walk(d){
  let ents; try{ents=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const e of ents){
    const p=path.join(d,e.name);
    if(e.isDirectory()){ if(e.name==='.git')continue; walk(p); }
    else if(e.isFile()){
      scanned++;
      let fd;try{fd=fs.openSync(p,'r');}catch{continue;}
      const b=Buffer.alloc(8);
      try{fs.readSync(fd,b,0,8,0);}catch{fs.closeSync(fd);continue;}
      fs.closeSync(fd);
      if(b.equals(SIG)){
        if(p.includes('node_modules')){nm++;if(exNm.length<5)exNm.push(p);}
        else{src++;if(exSrc.length<25)exSrc.push(p);}
      }
    }
  }
}
walk('.');
console.log('scanned:',scanned);
console.log('ENCRYPTED in node_modules:',nm);
console.log('ENCRYPTED outside node_modules:',src);
console.log('--- outside node_modules ---');exSrc.forEach(e=>console.log('  ',e));
console.log('--- node_modules sample ---');exNm.forEach(e=>console.log('  ',e));
