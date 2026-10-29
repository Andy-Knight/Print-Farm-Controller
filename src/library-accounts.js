import {configuredLimit} from './security/resource-limits.js';

/** Only names/IDs attached to files are public; account management stays private. */
export function libraryAccountPresentation({files,usage,accounts,currentUser}){
  const byId=new Map(accounts.map(account=>[account.id,account]));
  const identity=id=>{
    if(!id||id==='local')return {id:null,label:'Unknown / legacy',status:'legacy'};
    const account=byId.get(id);
    return {id,label:account?.displayName||'Deleted account',status:account?'account':'deleted'};
  };
  const admin=currentUser?.role==='administrator';
  const limit=configuredLimit('PFC_LIBRARY_MAX_USER_BYTES',10*1024**3);
  const ids=admin?new Set([...accounts.map(account=>account.id),...usage.keys()]):new Set(currentUser?.id?[currentUser.id]:[]);
  return {
    files:files.map(file=>({...file,uploader:identity(file.uploadedById),quotaOwner:identity(file.ownerId)})),
    storage:{limit,mine:currentUser?.id?{...identity(currentUser.id),bytes:0,files:0,...usage.get(currentUser.id),limit}:null,
      accounts:admin?[...ids].map(id=>({...identity(id),bytes:0,files:0,...usage.get(id),limit:id==='local'?null:limit})):null},
    ownershipAccounts:admin?accounts.filter(account=>!account.disabled).map(({id,displayName})=>({id,label:displayName})):null
  };
}
