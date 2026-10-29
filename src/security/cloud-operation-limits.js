import {withOperationBudget,currentOperation,abortError} from './operation-budget.js';
import {configuredLimit} from './resource-limits.js';

export function boundedCloudFetch(fetchFn,{headerTimeoutMs=configuredLimit('PFC_CLOUD_HEADER_TIMEOUT_MS',30000),idleTimeoutMs=configuredLimit('PFC_CLOUD_IDLE_TIMEOUT_MS',30000),
  requestTimeoutMs=configuredLimit('PFC_CLOUD_OPERATION_TIMEOUT_MS',15*60*1000),metadataBytes=4*1024**2,aggregateMetadataBytes=16*1024**2,maxBodyBytes=4*1024**3}={}){
  return async(url,options={})=>{
    const controller=new AbortController();
    const signals=[controller.signal,options.signal,currentOperation()?.signal].filter(Boolean);
    const signal=AbortSignal.any(signals);
    signal.throwIfAborted();
    let reader,idle,closed=false;
    const total=setTimeout(()=>controller.abort(abortError('Cloud request deadline exceeded')),requestTimeoutMs);total.unref?.();
    const headers=setTimeout(()=>controller.abort(abortError('Cloud response headers timed out')),headerTimeoutMs);
    const cleanup=()=>{closed=true;clearTimeout(total);clearTimeout(headers);clearTimeout(idle);signal.removeEventListener('abort',cancel);};
    const cancel=()=>{options.body?.destroy?.();void reader?.cancel(signal.reason).catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});
    const aborted=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason||abortError()),{once:true}));
    try{
      const pending=Promise.resolve().then(()=>fetchFn(url,{...options,signal,redirect:options.redirect??'error'}));
      // Cancel a late response even when a custom fetch implementation ignored abort.
      void pending.then(response=>{if(signal.aborted)void response.body?.cancel().catch(()=>{});},()=>{});
      const response=await Promise.race([pending,aborted]);
      clearTimeout(headers);signal.throwIfAborted();
      if(!response.body){cleanup();return response;}
      reader=response.body.getReader();
      let bytes=0;
      const resetIdle=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(abortError('Cloud response body stalled')),idleTimeoutMs);idle.unref?.();};
      resetIdle();
      const stream=new ReadableStream({
        async pull(output){
          try{
            signal.throwIfAborted();
            const result=await Promise.race([reader.read(),aborted]);
            signal.throwIfAborted();
            if(result.done){cleanup();output.close();return;}
            bytes+=result.value.byteLength;
            if(bytes>maxBodyBytes)throw new Error('Cloud response exceeds supported size limit');
            resetIdle();output.enqueue(result.value);
          }catch(error){cancel();cleanup();output.error(error);}
        },
        async cancel(reason){cleanup();await reader.cancel(reason).catch(()=>{});}
      });
      const wrapped=new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
      const read=async()=>{
        const input=wrapped.body.getReader(),chunks=[];let size=0;
        try{while(true){const {done,value}=await input.read();if(done)break;
          const operation=currentOperation();
          if(operation){operation.metadataBytes=(operation.metadataBytes||0)+value.byteLength;
            if(operation.metadataBytes>aggregateMetadataBytes)throw new Error('Cloud operation metadata exceeds aggregate size limit');}
          size+=value.byteLength;if(size>metadataBytes)throw new Error('Cloud metadata/error response exceeds size limit');chunks.push(Buffer.from(value));
        }return Buffer.concat(chunks,size);}
        catch(error){await input.cancel(error).catch(()=>{});throw error;}
        finally{input.releaseLock();}
      };
      Object.defineProperties(wrapped,{
        text:{value:async()=>(await read()).toString('utf8')},
        json:{value:async()=>JSON.parse((await read()).toString('utf8'))},
        arrayBuffer:{value:async()=>{const data=await read();return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);}},
        url:{value:response.url}
      });
      return wrapped;
    }catch(error){if(!closed){cancel();cleanup();}throw error;}
  };
}

/** Public operations share one deadline across refresh, pagination and transfer. */
export function installCloudOperationLimits(client,options={}){
  client.fetchFn=boundedCloudFetch(client.fetchFn,options);
  for(const name of ['startDeviceAuthorization','pollDeviceAuthorization','getAccessToken','ensureBackupFolder',
    'testConnection','uploadBackup','downloadBackup','getBackup','listBackups','listObjects',
    'listChildren','getObjectBuffer','uploadBuffer','uploadLargeFile','uploadMetadata','createUploadSession',
    'pruneScheduledBackups','deleteBackup','disconnect','resetConfiguration']){
    if(typeof client[name]!=='function')continue;
    const original=client[name].bind(client);
    client[name]=(...args)=>withOperationBudget(()=>original(...args),{timeoutMs:options.operationTimeoutMs});
  }
}
