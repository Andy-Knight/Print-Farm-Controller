import {promises as fs} from 'node:fs';
import path from 'node:path';
import {configuredLimit,resourceError,requireFreeSpace} from './resource-limits.js';

export async function readLibraryOwnerUsage(root){
  const owners=new Map();
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue;
    let metadata;try{metadata=JSON.parse(await fs.readFile(path.join(root,entry.name,'metadata.json'),'utf8'));}catch{continue;}
    const size=Number(metadata.size);
    if(!Number.isSafeInteger(size)||size<0)continue;
    const id=metadata.ownerId||'local',usage=owners.get(id)||{bytes:0,files:0};
    usage.bytes+=size;usage.files++;owners.set(id,usage);
  }
  return owners;
}

// Match the global admission quota: count payloads, previews and metadata.
// Never follow links out of the controller-owned library directory.
export async function readLibraryStorageBytes(root){
  let bytes=0;const pending=[root];
  while(pending.length){
    const directory=pending.pop();
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw resourceError('Linked library storage cannot be measured safely.',507);
      const target=path.join(directory,entry.name);
      if(entry.isDirectory())pending.push(target);
      else if(entry.isFile())bytes+=(await fs.stat(target)).size;
    }
  }
  return bytes;
}

/** Called while holding the library catalog mutation lock, before copying. */
export async function requireLibraryCapacity(root,incomingBytes,{ownerId='local',overheadBytes=0,
  maxBytes=configuredLimit('PFC_LIBRARY_MAX_BYTES',50*1024**3),maxFiles=configuredLimit('PFC_LIBRARY_MAX_FILES',10000),
  maxPerUserBytes=configuredLimit('PFC_LIBRARY_MAX_USER_BYTES',10*1024**3),checkSpace=requireFreeSpace}={}){
  const requiredBytes=incomingBytes+overheadBytes;
  if(requiredBytes>maxBytes)throw resourceError('Print Library storage quota exceeded.',507);
  let total=0,owned=0,count=0;
  const stack=[root];
  while(stack.length){
    const directory=stack.pop();
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      const target=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw resourceError('Linked library storage cannot be admitted safely.',507);
      if(entry.isDirectory()){
        if(directory===root){
          count++;
          let metadata;try{metadata=JSON.parse(await fs.readFile(path.join(target,'metadata.json'),'utf8'));}catch{}
          if(metadata?.ownerId===ownerId)owned+=Number(metadata.size)||0;
        }
        stack.push(target);
      }else if(entry.isFile())total+=(await fs.stat(target)).size;
      if(total+requiredBytes>maxBytes||count>=maxFiles)throw resourceError('Print Library storage/file quota reached. Ask an administrator to remove unused files or adjust the host quota.',507);
    }
  }
  if(ownerId!=='local'&&owned+incomingBytes>maxPerUserBytes)throw resourceError('Your Print Library storage quota has been reached.',507);
  await checkSpace(root,requiredBytes);
}
