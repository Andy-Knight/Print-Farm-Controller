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
    // Library readiness means that an online, correctly configured printer
    // can run the file once queued; the printer need not be idle *now*.
    // In particular, another idle printer with the wrong filament must not
    // override a material-compatible printer that is already printing.
    // This is display-only: the queue's live preflight still waits for idle.
    const temporary=new Set(['busy','reserved','operation_busy']);
    const ready = results.flatMap((result,index)=>{
      const reasons=result.reasons || [];
      const waiting=result.category==='blocked' && reasons.length>0
        && reasons.every((reason)=>temporary.has(reason.code));
      if ((result.category!=='ready' && !waiting) || unverifiedMaterial) return [];
      const {state,adapter}=candidates[index];
      if (state?.online!==true) return [];
      const status=state?.status || {};
      const materialVerified=adapter?.capabilities?.materialSlotMapping
        ? Array.isArray(status.materialSources) && status.materialSources.length>0
        : Array.isArray(status.tools) && status.tools.length>0
          && logical.every((tool)=>status.tools.some((head)=>
            head?.filament?.material &&
            head?.filament?.present!==false &&
            (tool.nozzleDiameter==null || Number.isFinite(Number(head.nozzleDiameter)))));
      return materialVerified ? [{result,waiting}] : [];
    });
    const eligible=results.map((result,index)=>({result,state:candidates[index].state}))
      .filter(({result})=>result.category!=='incompatible');
    let level, message;
    if (ready.length) {
      level='ready';
      const available=ready.filter(({waiting})=>!waiting).length;
      const waiting=ready.length-available;
      const matching=ready.length+' printer'+(ready.length===1?' has':'s have')+' matching material and nozzle configuration';
      message=waiting
        ? matching+'; '+(available ? available+' available now, ' : '')
          +waiting+' '+(waiting===1?'is':'are')+' currently busy or reserved. You can queue this file now; printing starts when an eligible printer is idle and passes live preflight'
        : matching+' and '+(available===1?'is':'are')+' available; queue preflight will recheck';
    } else if(!eligible.length) {
      level='incompatible';
      // When a file targets a specific model, unrelated printers will fail
      // with printer_target_mismatch. These are not useful diagnostics: show
      // the actual reason from a matching printer (e.g. unsupported .3mf).
      const matchingResults=file.printerTarget
        ? results.filter((result)=>!(result.reasons || []).some(
          (reason)=>reason.code==='printer_target_mismatch'))
        : results;
      message=matchingResults.length
        ? matchingResults.flatMap((result)=>result.reasons || []).find((reason)=>reason.text)?.text
          || 'No configured printer supports this file'
        : `No configured printer matches the designated model ${file.printerTarget.model}`;
    } else {
      // An offline compatible printer cannot verify its current spool state.
      // Do not mistake stale telemetry for a problem with the stored file.
      const online=eligible.filter(({result,state})=>state?.online===true
        && !(result.reasons||[]).some((reason)=>reason.code==='offline'));
      const offline=eligible.filter(({result,state})=>state?.online!==true
        || (result.reasons||[]).some((reason)=>reason.code==='offline'));
      const attention=online.find(({result})=>{
        const reasons=result.reasons || [];
        return unverifiedMaterial || result.category==='needs_review'
          || !reasons.length || reasons.some((reason)=>!temporary.has(reason.code));
      });
      const busy=online.find(({result})=>result.reasons?.some((reason)=>temporary.has(reason.code)));
      if(attention) {
        level='attention';
        message=(attention.result.reasons||[]).find((reason)=>!temporary.has(reason.code))?.text
          || 'Printer or filament configuration needs verification before queueing';
      } else if(busy) {
        level='busy';
        message=busy.result.printerName+' is busy; queue preflight will recheck availability';
      } else if(offline.length) {
        level='offline';
        message=offline.length===1
          ? offline[0].result.printerName+' is offline; material and nozzle compatibility will be verified when it reconnects'
          : offline.length+' compatible printer candidates are offline; compatibility will be rechecked when they reconnect';
      } else {
        level='attention';
        message='Printer or filament configuration needs verification before queueing';
      }
    }
    return {
      ...file,
      readiness:{level,message,readyPrinters:ready.length,checkedPrinters:candidates.length}
    };
  });
}
