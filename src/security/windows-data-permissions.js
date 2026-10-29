import {execFile} from 'node:child_process';
import path from 'node:path';
import {readRuntimeTextAsset,runtimeAssetKeys} from '../runtime-assets.js';
import {resolveControllerRuntimePaths} from '../runtime-paths.js';

const protections=new Map();

/** Protect a dedicated data tree before reading secrets or opening listeners. */
export async function secureWindowsDataDirectories({dataDir,logDir=null,force=false}={}) {
  if(process.platform!=='win32')return;
  const runtime=resolveControllerRuntimePaths();
  const key=JSON.stringify([path.resolve(dataDir),logDir&&path.resolve(logDir)]);
  if(force)protections.delete(key);
  if(!protections.has(key)){
    const pending=(async()=>{
      const script=await readRuntimeTextAsset({key:runtimeAssetKeys.windowsDataPermissions,
        filePath:path.join(runtime.applicationDir,'src','security','windows-data-permissions.ps1')});
      const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const request={dataDir:path.resolve(dataDir),logDir:logDir&&path.resolve(logDir),
        applicationDir:runtime.applicationDir,
        ownerRecord:runtime.runningAsSea?path.join(runtime.applicationDir,'controller-owner.sid'):null};
      try {
        // execFile has no shell; paths arrive as JSON over stdin, never as code.
        await new Promise((resolve,reject)=>{
          const child=execFile(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
            {windowsHide:true,timeout:120000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
              if(error)reject(new Error(stderr.trim()||'Windows ACL helper could not complete'));
              else resolve(stdout);
            });
          child.stdin.on('error',()=>{});
          child.stdin.end(JSON.stringify(request));
        });
      } catch(error) {
        throw new Error(`${error.message}. Startup stopped before loading credentials. Run the Windows installer/permission repair as Administrator for the intended Windows account; do not grant access to all Users.`,{cause:error});
      }
    })();
    protections.set(key,pending);
    pending.catch(()=>protections.delete(key));
  }
  return protections.get(key);
}
