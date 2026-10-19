import { evaluateQueueCompatibility } from './queue-compatibility.js';

/**
 * A read-only preview of automatic queue compatibility for configured
 * printers at the moment the Library is refreshed. Never bypasses queue
 * preflight: readiness can change as printers or spool assignments change.
 */
export function attachLibraryReadiness(files, printers, {
  resolveAdapter,
  getState
} = {}) {
  const candidates = (printers || []).map((printer)=>{
    try {
      return { printer, adapter:resolveAdapter(printer), state:getState(printer.id) || printer };
    } catch { return null; }
  }).filter(Boolean);
  return files.map((file)=>{
    const requirements = file.requirements || {};
    const logical = Array.isArray(requirements.logicalTools) ? requirements.logicalTools : [];
    if (!requirements.source || requirements.warning || !logical.length) {
      return {
        ...file,readiness:{
          level:'attention',message:requirements.warning || 'Sliced file requirements need review before queueing',
          readyPrinters:0,checkedPrinters:candidates.length
        }
      };
    }
    if (!candidates.length) return {
      ...file,readiness:{level:'attention',message:'No configured printers available for compatibility checks',readyPrinters:0,checkedPrinters:0}
    };
    const results = candidates.map(({printer,adapter,state})=>
      evaluateQueueCompatibility({
        job:{fileName:file.fileName,requirements,printerTarget:file.printerTarget},
        printer,state,adapter
      })
    );
    // The queue evaluator deliberately tolerates printers that do not report
    // every filament field. A green indicator, however, must NOT imply these
    // unverified conditions have already been checked.
    const unverifiedMaterial=logical.some((tool)=>!tool.material);
    const ready = results.filter((x,index)=>{
      if(x.category!=='ready' || unverifiedMaterial) return false;
      const {state,adapter}=candidates[index];
      const status=state?.status || {};
      if (adapter?.capabilities?.materialSlotMapping) {
        return Array.isArray(status.materialSources) && status.materialSources.length>0;
      }
      return Array.isArray(status.tools) && status.tools.length>0
        && logical.every((tool)=>status.tools.some((head)=>
          head?.filament?.material &&
          head?.filament?.present!==false &&
          (tool.nozzleDiameter==null || Number.isFinite(Number(head.nozzleDiameter)))));
    });
    const maybe = results.filter((x)=>x.category!=='incompatible');
    let level, message;
    if (ready.length) {
      level='ready';
      message=ready.length+' printer'+(ready.length===1?' is':'s are')+' currently eligible; queue preflight will recheck';
    } else if(maybe.length) {
      level='attention';
      message=maybe.flatMap((x)=>x.reasons || []).find((x)=>x.text)?.text || 'Printer/material availability requires review';
    } else {
      level='incompatible';
      message=results.flatMap((x)=>x.reasons || []).find((x)=>x.text)?.text || 'No configured printer supports this file';
    }
    return {
      ...file,
      readiness:{level,message,readyPrinters:ready.length,checkedPrinters:candidates.length}
    };
  });
}
