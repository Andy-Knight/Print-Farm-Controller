import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function releaseVersion(value){
  if(typeof value!=='string'||!/^\d+\.\d+\.\d+$/.test(value))throw new Error('A numeric major.minor.patch version is required.');
  return value;
}
export function installerName(version){return `PrintFarmController-Setup-v${releaseVersion(version)}.exe`;}
export async function fileSha256(file){
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
export async function prepareWindowsReleaseBundle({root=projectRoot,sha=process.env.GITHUB_SHA}={}){
  if(!/^[a-f0-9]{40}$/.test(sha||''))throw new Error('A full source commit SHA is required.');
  const version=releaseVersion(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
  const directory=path.join(root,'dist','installer'),name=installerName(version),file=path.join(directory,name);
  const stat=await fs.stat(file);
  if(!stat.isFile()||stat.size<1024||stat.size>512*1024**2)throw new Error('Invalid Windows installer size.');
  const handle=await fs.open(file,'r');
  try{const signature=Buffer.alloc(2);await handle.read(signature,0,2,0);if(signature.toString()!=='MZ')throw new Error('The installer is not a Windows executable.');}
  finally{await handle.close();}
  const checksum=await fileSha256(file);
  const metadata={version,commit:sha,signing:'unsigned',installer:{name,size:stat.size,sha256:checksum}};
  await fs.writeFile(path.join(directory,'SHA256SUMS.txt'),`${checksum}  ${name}\n`);
  await fs.writeFile(path.join(directory,'release-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
  return metadata;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const metadata=await prepareWindowsReleaseBundle();
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`version=${metadata.version}\n`);
  console.log(`Prepared unsigned installer, SHA-256 and source metadata for v${metadata.version}`);
}
