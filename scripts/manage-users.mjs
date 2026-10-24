import {resolveControllerRuntimePaths} from '../src/runtime-paths.js';
import {runLocalSecurityCommand} from '../src/security/local-admin.js';
const action=process.argv[2];
runLocalSecurityCommand(action,{dataDir:resolveControllerRuntimePaths().dataDir}).catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
