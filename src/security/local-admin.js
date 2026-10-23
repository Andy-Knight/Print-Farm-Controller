/** Interactive, LOCAL-ONLY administrator enrollment / disaster recovery. */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createInterface, emitKeypressEvents} from 'node:readline';
import {AccountStore} from './account-store.js';

async function readVisible(question){
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{return await new Promise(resolve=>rl.question(question,resolve));}
  finally{rl.close();}
}
async function readSecret(question){
  if(!process.stdin.isTTY||!process.stdout.isTTY||!process.stdin.setRawMode)
    throw new Error('Administrator enrollment requires an interactive terminal (TTY).');
  process.stdout.write(question);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value='';
  try{
    return await new Promise((resolve,reject)=>{
      function keypress(character,key){
        if(key?.ctrl&&key.name==='c'){cleanup();reject(new Error('Cancelled'));return;}
        if(key?.name==='return'||key?.name==='enter'){cleanup();resolve(value);return;}
        if(key?.name==='backspace'){value=value.slice(0,-1);return;}
        if(character&&!key?.ctrl&&!key?.meta&&value.length<256&&character>=' '){
          value+=character;
        }
      }
      function cleanup(){process.stdin.off('keypress',keypress);process.stdout.write('\n');}
      process.stdin.on('keypress',keypress);
    });
  }finally{
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
export async function runLocalSecurityCommand(action,{dataDir}={}){
  if(!['setup','recover'].includes(action))throw new Error('Choose setup or recover.');
  if(!process.stdin.isTTY||!process.stdout.isTTY)
    throw new Error('Run in a local interactive terminal. Remote HTTP enrollment is disabled.');
  const store=new AccountStore({dataDir});
  const initialized=await store.initialized();
  if(action==='setup'&&initialized)throw new Error('Users already exist. Use recover only for local disaster recovery.');
  if(action==='recover'&&!initialized)throw new Error('No valid accounts to recover. Use setup for initial enrollment.');
  console.log('Print Farm Controller local administrator '+(action==='setup'?'enrollment':'RECOVERY'));
  if(action==='recover'){
    console.log('Recovery replaces ALL accounts and invalidates all active sessions after restart.');
    console.log('Existing account data will be retained locally as a private backup.');
    if(await readVisible('Type RESET to continue: ')!=='RESET')throw new Error('Cancelled.');
  }
  const username=(await readVisible('Administrator username: ')).trim();
  const displayName=(await readVisible('Display name (optional): ')).trim();
  const password=await readSecret('Password (at least 12 characters): ');
  const repeat=await readSecret('Repeat password: ');
  if(password!==repeat)throw new Error('Passwords did not match.');
  let oldFile=null;
  if(action==='recover'){
    oldFile=store.filePath+'.recovery-'+Date.now()+'.bak';
    await fs.rename(store.filePath,oldFile);
  }
  try{
    const user=await store.bootstrapAdministrator({username,password,displayName});
    console.log('Administrator '+user.username+' provisioned. Restart the controller to enable login.');
  }catch(error){
    if(oldFile){
      await fs.rm(store.filePath,{force:true}).catch(()=>{});
      await fs.rename(oldFile,store.filePath);
    }
    throw error;
  }
}
