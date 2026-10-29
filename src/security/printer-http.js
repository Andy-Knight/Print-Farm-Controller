/** Printer credentials must never follow an HTTP redirect. */
export function fetchPrinterResponse(url, options = {}) {
  return fetch(url, {...options, redirect:'error'});
}

export async function readPrinterBytes(response, {maxBytes=8*1024*1024, timeoutMs=10000} = {}) {
  const body=response.body;
  if (!body) return Buffer.alloc(0);
  const reader=body.getReader();
  let timer, complete=false;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Printer response body timed out')),timeoutMs);});
  try {
    const declared=Number(response.headers.get('content-length'));
    if (declared>maxBytes) throw new Error('Printer response exceeds size limit');
    const chunks=[];
    let size=0;
    while (true) {
      const {done,value}=await Promise.race([reader.read(),deadline]);
      if (done) break;
      if (size+value.byteLength>maxBytes) throw new Error('Printer response exceeds size limit');
      size+=value.byteLength;
      chunks.push(Buffer.from(value));
    }
    complete=true;
    return Buffer.concat(chunks,size);
  } finally {
    clearTimeout(timer);
    if (!complete) void reader.cancel().catch(()=>{});
    try {reader.releaseLock();} catch {}
  }
}
export async function readPrinterText(response, options) {
  return (await readPrinterBytes(response,options)).toString('utf8');
}
export async function readPrinterJson(response, options) {
  return JSON.parse(await readPrinterText(response,options));
}
