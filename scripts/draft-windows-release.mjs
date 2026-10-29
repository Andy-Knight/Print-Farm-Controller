import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileSha256,installerName,releaseVersion,projectRoot} from './windows-release-bundle.mjs';

export function releaseNotes(changelog,version,sha,checksum){
  const text=String(changelog).replaceAll('\r\n','\n');
  const first=text.match(/^## v(\d+\.\d+\.\d+)\s*\n([\s\S]*?)(?=^## v|$(?![\s\S]))/m);
  if(!first||first[1]!==version||!first[2].trim())throw new Error('The newest changelog entry must match the installer version.');
  return `${first[2].trim()}\n\n### Windows download\n\nDownload **${installerName(version)}** from Assets. It includes the bundled camera decoder and matching third-party source/licence notices.\n\nThis automated Windows installer is **unsigned**. Windows may show an unknown-publisher or SmartScreen notice. Review and test this draft before publishing.\n\nVerify the download against **SHA256SUMS.txt**. Source commit: ${sha}.\n\n<!-- pfc-windows-build ${sha} ${checksum} -->\n`;
}

export async function createWindowsReleaseDraft({root=projectRoot,env=process.env,fetchFn=fetch,log=console.log}={}){
  // The writer must never run for PRs, tags or manually selected feature branches.
  if(env.GITHUB_REF!=='refs/heads/main'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))
    throw new Error('Windows release drafts may only be created from main.');
  const repository=env.GITHUB_REPOSITORY,sha=env.GITHUB_SHA,token=env.GH_TOKEN;
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')||!/^[a-f0-9]{40}$/.test(sha||'')||!token)
    throw new Error('Trusted repository, commit and release token are required.');
  const version=releaseVersion(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version),tag='v'+version;
  const directory=path.join(root,'dist','installer'),name=installerName(version);
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'release-metadata.json'),'utf8'));
  if(metadata.version!==version||metadata.commit!==sha||metadata.signing!=='unsigned'||metadata.installer?.name!==name)
    throw new Error('Installer artifact does not match the validated source commit/version.');
  const files=[];
  for(const assetName of [name,'SHA256SUMS.txt','release-metadata.json']){
    const file=path.join(directory,assetName),stat=await fs.stat(file);
    if(!stat.isFile()||stat.size<1||stat.size>512*1024**2)throw new Error('Invalid release asset.');
    files.push({name:assetName,file,size:stat.size,sha256:await fileSha256(file)});
  }
  if(files[0].sha256!==metadata.installer.sha256||files[0].size!==metadata.installer.size||
    await fs.readFile(files[1].file,'utf8')!==`${files[0].sha256}  ${name}\n`)
    throw new Error('Installer checksum or release metadata mismatch.');
  const notes=releaseNotes(await fs.readFile(path.join(root,'CHANGELOG.md'),'utf8'),version,sha,files[0].sha256);
  const base=`https://api.github.com/repos/${repository}`;
  async function request(url,{method='GET',data,asset,allow404=false}={}){
    const body=asset?createReadStream(asset.file):data?JSON.stringify(data):undefined;
    try{
      const response=await fetchFn(url,{method,signal:AbortSignal.timeout(120000),redirect:'error',
        headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
          ...(asset?{'Content-Type':'application/octet-stream','Content-Length':String(asset.size)}:data?{'Content-Type':'application/json'}:{})},
        ...(body?{body}:{}),...(asset?{duplex:'half'}:{})});
      if(allow404&&response.status===404){await response.body?.cancel();return null;}
      if(!response.ok){await response.body?.cancel();throw new Error(`GitHub release request failed (${response.status}); no existing assets were replaced.`);}
      return await response.json();
    }finally{if(asset)body.destroy();}
  }
  let release=await request(`${base}/releases/tags/${tag}`,{allow404:true});
  // The tag lookup is documented for published releases. Authenticated release
  // listings also include drafts, even before their tag has been published.
  if(!release)for(let page=1;page<=100;page++){
    const releases=await request(`${base}/releases?per_page=100&page=${page}`);
    if(!Array.isArray(releases))throw new Error('Invalid GitHub release listing.');
    release=releases.find(item=>item.tag_name===tag);
    if(release||releases.length<100)break;
    if(page===100)throw new Error('Release listing limit reached; no draft was created.');
  }
  if(release&&!release.draft){log(`Release ${tag} is already published; leaving it unchanged.`);return {skipped:true,url:release.html_url};}
  if(release&&[name,'SHA256SUMS.txt','release-metadata.json'].every(assetName=>release.assets?.some(asset=>asset.name===assetName&&asset.state==='uploaded'))){
    log(`Draft ${tag} already has its installer assets; leaving it unchanged.`);return {skipped:true,url:release.html_url};
  }
  if(release&&(release.target_commitish!==sha||!String(release.body).includes(`<!-- pfc-windows-build ${sha} ${files[0].sha256} -->`)))
    throw new Error('An incomplete draft belongs to a different source/build. Review or delete that draft before retrying; existing assets were not changed.');
  if(!release){
    // A pre-existing tag must identify this exact source; never move a tag.
    let ref=await request(`${base}/git/ref/tags/${tag}`,{allow404:true});
    for(let depth=0;ref?.object?.type==='tag'&&depth<5;depth++)ref=await request(`${base}/git/tags/${ref.object.sha}`);
    if(ref&&(ref.object?.type!=='commit'||ref.object.sha!==sha))throw new Error('Existing release tag does not identify this source commit.');
    release=await request(`${base}/releases`,{method:'POST',data:{tag_name:tag,target_commitish:sha,name:`Print Farm Controller ${tag}`,body:notes,draft:true,prerelease:false}});
  }
  if(!release.draft||!Number.isSafeInteger(release.id)||release.id<1)throw new Error('GitHub did not return a valid draft release.');
  for(const asset of files){
    const existing=release.assets?.find(item=>item.name===asset.name);
    if(existing){
      if(existing.state!=='uploaded'||existing.size!==asset.size||existing.digest!==`sha256:${asset.sha256}`)
        throw new Error('An existing draft asset differs from this build. Review the draft before retrying.');
      continue;
    }
    // Construct the trusted upload destination; never follow a response URL with a token.
    const uploaded=await request(`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,{method:'POST',asset});
    if(uploaded.state!=='uploaded'||uploaded.size!==asset.size||uploaded.digest!==`sha256:${asset.sha256}`)
      throw new Error('GitHub asset verification failed; the release remains a draft.');
  }
  log(`Windows release draft ready: ${release.html_url}`);
  return {skipped:false,url:release.html_url};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await createWindowsReleaseDraft();
