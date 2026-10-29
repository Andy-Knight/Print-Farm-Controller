import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RESOURCE_LIMIT_FIELDS,validateResourceOverrides} from './resource-limit-definitions.js';
import {setResourceLimitOverrides} from './resource-limits.js';

const hasOverride=(env,key)=>env[key]!==undefined&&env[key]!=='';

export class ResourceLimitSettings {
  #file;#env;#saved={};#active={};#queue=Promise.resolve();
  constructor({dataDir,env=process.env}){
    this.#file=path.join(dataDir,'security','resource-limits.json');
    this.#env={...env};
  }
  async init(){
    try{
      const stat=await fs.lstat(this.#file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Invalid resource limits file.');
      const document=JSON.parse(await fs.readFile(this.#file,'utf8'));
      if(document.version!==1)throw new Error('Unsupported resource limits version.');
      this.#saved=validateResourceOverrides(document.overrides);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    // Validate environment policy even when a component is not used at startup.
    for(const field of RESOURCE_LIMIT_FIELDS){
      if(hasOverride(this.#env,field.key))validateResourceOverrides({[field.key]:Number(this.#env[field.key])});
    }
    this.#active={...this.#saved};
    setResourceLimitOverrides(this.#active);
    return this.status();
  }
  status(){
    let restartRequired=false;
    const fields=RESOURCE_LIMIT_FIELDS.map(field=>{
      const locked=hasOverride(this.#env,field.key);
      const active=locked?Number(this.#env[field.key]):this.#active[field.key]??field.defaultValue;
      const saved=locked?Number(this.#env[field.key]):this.#saved[field.key]??field.defaultValue;
      if(active!==saved)restartRequired=true;
      return {...field,active,saved,locked,source:locked?'environment':Object.hasOwn(this.#saved,field.key)?'saved':'default'};
    });
    return {fields,restartRequired};
  }
  save(overrides){
    const task=this.#queue.then(async()=>{
      const next=validateResourceOverrides(overrides);
      for(const [key,value] of Object.entries(next)){
        if(hasOverride(this.#env,key))throw Object.assign(new Error('This limit is managed by the host environment: '+key),{statusCode:409});
        if(RESOURCE_LIMIT_FIELDS.find(field=>field.key===key).defaultValue===value)delete next[key];
      }
      // Retain dormant saved values underneath environment locks. They may be
      // used again if the host later removes an environment override.
      for(const field of RESOURCE_LIMIT_FIELDS)if(hasOverride(this.#env,field.key)&&Object.hasOwn(this.#saved,field.key))next[field.key]=this.#saved[field.key];
      const directory=path.dirname(this.#file);
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      const temporary=path.join(directory,'.resource-limits-'+randomUUID()+'.tmp');
      try{
        await fs.writeFile(temporary,JSON.stringify({version:1,overrides:next},null,2)+'\n',{mode:0o600,flag:'wx'});
        await fs.rename(temporary,this.#file);
        this.#saved=next;
      }finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
      return this.status();
    });
    this.#queue=task.catch(()=>{});
    return task;
  }
}
