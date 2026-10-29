/** Validate provider-generated destinations before attaching credentials or data. */
export function trustedCloudUrl(value,{origin,domains=[]}={}) {
  const url=new URL(value);
  const host=url.hostname.toLowerCase();
  const approved=origin ? url.origin===origin : domains.some(domain=>host===domain||host.endsWith(`.${domain}`));
  if(url.protocol!=='https:'||url.username||url.password||url.port||!approved)
    throw new Error('Cloud destination is outside the approved HTTPS provider origin');
  return url.href;
}

export const MICROSOFT_FILE_DOMAINS=['1drv.com','sharepoint.com'];

// Graph content redirects are preauthenticated. Never copy the Graph bearer
// token, caller headers or request body onto the provider download request.
export async function fetchMicrosoftDownload(fetchFn,value) {
  let next=value;
  for(let redirects=0;redirects<=3;redirects++){
    const url=trustedCloudUrl(next,{domains:MICROSOFT_FILE_DOMAINS});
    const response=await fetchFn(url,{redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('location');
    void response.body?.cancel().catch(()=>{});
    if(!location)throw new Error('Cloud download redirect has no destination');
    next=new URL(location,url).href;
  }
  throw new Error('Cloud download redirect limit exceeded');
}
