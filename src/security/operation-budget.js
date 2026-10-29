import {AsyncLocalStorage} from 'node:async_hooks';
import {configuredLimit} from './resource-limits.js';

const operations=new AsyncLocalStorage();
const activeOperations=new Set();
export function cancelActiveOperations(){
  for(const context of activeOperations)context.controller.abort(abortError('Operation cancelled by administrator'));
  return activeOperations.size;
}
export const currentOperation=()=>operations.getStore();
export const operationAborted=()=>currentOperation()?.signal.throwIfAborted();
export function abortError(message='Operation cancelled'){return Object.assign(new Error(message),{name:'AbortError',statusCode:408});}

export async function withOperationBudget(callback,{timeoutMs=configuredLimit('PFC_CLOUD_OPERATION_TIMEOUT_MS',15*60*1000),signal,controller=new AbortController()}={}){
  if(currentOperation()){operationAborted();return callback(currentOperation());}
  const activeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const timer=setTimeout(()=>controller.abort(abortError('Operation deadline exceeded')),timeoutMs);
  const context={signal:activeSignal,controller,deadline:Date.now()+timeoutMs};
  activeOperations.add(context);
  try{return await operations.run(context,async()=>{activeSignal.throwIfAborted();const result=await callback(context);activeSignal.throwIfAborted();return result;});}
  finally{clearTimeout(timer);activeOperations.delete(context);controller.abort(abortError('Operation finished'));}
}
