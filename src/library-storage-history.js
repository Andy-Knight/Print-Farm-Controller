import crypto from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {KeyedSerialExecutor} from './concurrency.js';

export const LIBRARY_HISTORY_FLUSH_MS=5*60*1000;
const MAX_POINTS=9000;
const validPoint=point=>Boolean(point&&typeof point.at==='string'&&Number.isFinite(Date.parse(point.at))
  &&Number.isSafeInteger(point.bytes)&&point.bytes>=0&&Number.isSafeInteger(point.limit)&&point.limit>0);

// Older releases tolerated malformed storage observations. Preserve valid ones
// during migration, while keeping the new on-disk format strictly validated.
export function normalizeLegacyStorageHistory(points){
  const hours=new Map();
  for(const point of (Array.isArray(points)?points.slice(-MAX_POINTS):[]).filter(validPoint)
    .map(({at,bytes,limit})=>({at:new Date(at).toISOString(),bytes,limit}))
    .sort((a,b)=>a.at.localeCompare(b.at))){
    hours.set(point.at.slice(0,13),point);
  }
  return [...hours.values()].slice(-MAX_POINTS);
}

export function validateLibraryStorageHistory(value){
  if(!value||value.version!==1||!Array.isArray(value.points)||value.points.length>MAX_POINTS||!value.points.every(validPoint))
    throw new Error('Library storage history is invalid');
  return {version:1,points:normalizeLegacyStorageHistory(value.points)};
}

export class LibraryStorageHistory {
  constructor({filePath,legacyPath,now=Date.now}={}){
    this.filePath=path.resolve(filePath);this.legacyPath=legacyPath&&path.resolve(legacyPath);
    this.now=now;this.mutations=new KeyedSerialExecutor();this.initialization=null;
    this.points=[];this.dirty=false;this.lastFlushedAt=0;
  }

  async init(){
    if(!this.initialization){
      this.initialization=(async()=>{
        await fs.mkdir(path.dirname(this.filePath),{recursive:true,mode:0o700});
        try{
          this.points=validateLibraryStorageHistory(JSON.parse(await fs.readFile(this.filePath,'utf8'))).points;
        }catch(error){
          if(error.code!=='ENOENT')throw error;
          let legacy={};
          if(this.legacyPath){
            try{legacy=JSON.parse(await fs.readFile(this.legacyPath,'utf8'));}
            catch(readError){if(readError.code!=='ENOENT')throw readError;}
          }
          this.points=normalizeLegacyStorageHistory(legacy.libraryStorage);
          // Commit the new file before ReportingService removes the legacy field.
          await this.save(this.points);
        }
        this.lastFlushedAt=this.now();
      })().catch(error=>{this.initialization=null;throw error;});
    }
    return this.initialization;
  }

  async save(points){
    const temporary=`${this.filePath}.${crypto.randomUUID()}.tmp`;
    try{
      await fs.writeFile(temporary,JSON.stringify({version:1,points},null,2)+'\n',{mode:0o600});
      await fs.rename(temporary,this.filePath);
    }finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
  }

  async observe(point){
    if(!validPoint(point))throw new Error('Library storage measurement is invalid');
    const {bytes,limit}=point,at=new Date(point.at).toISOString();
    await this.init();
    return this.mutations.run('history',()=>{
      const cutoff=Date.parse(at)-366*86400000;
      const points=this.points.filter(previous=>Date.parse(previous.at)>=cutoff);
      const previous=points.at(-1);
      if(previous&&previous.at>at)return;
      if(previous&&previous.at.slice(0,13)===at.slice(0,13)){
        if(previous.bytes===bytes&&previous.limit===limit)return;
        points.pop();
      }
      points.push({at,bytes,limit});this.points=points.slice(-MAX_POINTS);this.dirty=true;
    });
  }

  async getHistory(){
    await this.init();return this.mutations.run('history',()=>structuredClone(this.points));
  }

  async flush({force=false}={}){
    await this.init();
    return this.mutations.run('history',async()=>{
      if(!this.dirty||(!force&&this.now()-this.lastFlushedAt<LIBRARY_HISTORY_FLUSH_MS))return false;
      await this.save(this.points);
      this.lastFlushedAt=this.now();this.dirty=false;return true;
    });
  }
}
