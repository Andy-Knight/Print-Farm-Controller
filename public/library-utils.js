// Print Library selection workbench — deterministic sorting, filtering and
// bounded DOM pagination, shared by Preact and the fallback HTML renderer.
export const LIBRARY_PAGE_SIZE = 80;
export const LIBRARY_SORT_KEYS = Object.freeze([
  'added','name','uploader','printer','material','cost','lots','salePrice','prints','lastPrinted','duration','weight','readiness'
]);

export function libraryMaterials(file) {
  return [...new Set((file?.requirements?.logicalTools || []).map((tool)=>
    String(tool?.material || '').trim()).filter(Boolean))];
}
export function libraryPrintSeconds(file) {
  const value = file?.requirements?.estimatedPrintSeconds;
  return typeof value==='number' && Number.isFinite(value) && value>0 ? value : null;
}
export function libraryWeightGrams(file) {
  const tools=file?.requirements?.logicalTools;
  if (!Array.isArray(tools) || !tools.length || !file?.requirements?.usageReliable) return null;
  if (tools.some(tool=>typeof tool?.filamentGrams!=='number' || !Number.isFinite(tool.filamentGrams) || tool.filamentGrams<0)) return null;
  return tools.reduce((total,tool)=>total+tool.filamentGrams,0);
}
export function libraryTimeLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds<=0) return 'Not reported';
  const mins=Math.max(1,Math.ceil(seconds/60));
  const days=Math.floor(mins/1440);
  const hours=Math.floor(mins%1440/60);
  const minutes=mins%60;
  return [days&&days+'d',hours&&hours+'h',minutes&&minutes+'m'].filter(Boolean).join(' ');
}
export function libraryWeightLabel(grams) {
  return typeof grams==='number' && Number.isFinite(grams) && grams>=0
    ? grams.toLocaleString('en-GB',{maximumFractionDigits:2})+' g' : 'Not reported';
}

// Keep the persisted adapter:model keys used by filtering, but expose the
// same readable manufacturer/model labels used by Library printer targeting.
export function libraryPrinterFilterOptions(files, labelForTarget = (target) => target?.model) {
  const labels = new Map();
  for (const file of files || []) {
    const target = file?.printerTarget;
    const value = target ? [target.adapterType, target.model].filter(Boolean).join(':') : '';
    if (!value || labels.has(value)) continue;
    labels.set(value, String(labelForTarget(target) || target.model || value));
  }
  return [...labels].map(([value, label]) => ({value, label}))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, {numeric:true, sensitivity:'base'})
      || a.value.localeCompare(b.value, undefined, {numeric:true, sensitivity:'base'}));
}

export function librarySortAndFilter(files, options={}) {
  const query=String(options.query || '').toLocaleLowerCase().trim();
  const printer=String(options.printer || '');
  const material=String(options.material || '');
  const tag=String(options.tag || '');
  const category=String(options.category || '');
  const cost=String(options.cost || '');
  const readiness=String(options.readiness || '');
  const favourites=options.favourites===true;
  const sort=LIBRARY_SORT_KEYS.includes(options.sort) ? options.sort : 'added';
  const dir=options.direction==='asc' ? 1 : -1;
  const filtered=(files || []).filter(file=>{
    const uploader=options.uploader||'';
    if(uploader==='mine'&&(!options.currentUserId||file.uploader?.id!==options.currentUserId))return false;
    if(['legacy','deleted'].includes(uploader)&&(file.uploader?.status||'legacy')!==uploader)return false;
    if(uploader&&!['mine','legacy','deleted'].includes(uploader)&&file.uploader?.id!==uploader)return false;
    const mats=libraryMaterials(file);
    const printerText=file.printerTarget ? [file.printerTarget.adapterType,file.printerTarget.model].filter(Boolean).join(':') : '';
    if (printer && (printer==='any' ? Boolean(file.printerTarget) : printerText!==printer)) return false;
    if (material && !mats.some(x=>x.toLocaleLowerCase()===material.toLocaleLowerCase())) return false;
    if (tag && !(file.tags || []).some(x=>x.toLocaleLowerCase()===tag.toLocaleLowerCase())) return false;
    if (category && String(file.category || '').toLocaleLowerCase()!==category.toLocaleLowerCase()) return false;
    if (favourites && file.favourite!==true) return false;
    if (cost==='available' && file.costEstimate?.complete!==true) return false;
    if (cost==='missing' && file.costEstimate?.complete===true) return false;
    if (readiness && file.readiness?.level!==readiness) return false;
    if (query) {
      const fields=[
        file.fileName,file.description,file.category,file.uploader?.label,printerText, ...(file.tags || []),
        ...mats, ...(file.requirements?.logicalTools || []).flatMap(x=>
          [x.color,x.nozzleDiameter,x.filamentPreset,x.filamentVendor]),file.sha256
      ].filter(x=>x!=null).join(' ').toLocaleLowerCase();
      if (!fields.includes(query)) return false;
    }
    return true;
  });
  const numeric=(file,key)=>{
    switch(key) {
      case 'cost':return file.costEstimate?.complete ? Number(file.costEstimate.totalCost) : null;
      case 'lots':return Number(file.lotsPerPrint) || 1;
      case 'salePrice':return file.saleEstimate?.complete===true
        && Number.isFinite(file.saleEstimate.sellingPricePerLot)
        ? file.saleEstimate.sellingPricePerLot : null;
      case 'prints':return Number(file.usage?.completedPrints || 0);
      case 'duration':return libraryPrintSeconds(file);
      case 'weight':return libraryWeightGrams(file);
      case 'lastPrinted':{const time=Date.parse(file.usage?.lastPrintedAt || '');return Number.isFinite(time)?time:null;}
      case 'added':{const time=Date.parse(file.addedAt || file.stagedAt || '');return Number.isFinite(time)?time:null;}
      default:return null;
    }
  };
  const name=(file,key)=>{
    if(key==='uploader')return String(file.uploader?.label||'Unknown / legacy');
    if (key==='printer') return String(file.printerTarget?.model || 'Any supported printer');
    if (key==='material') return libraryMaterials(file).join(', ');
    if (key==='readiness') return String(file.readiness?.level || '');
    return String(file.fileName || '');
  };
  return filtered.sort((a,b)=>{
    if (['added','lastPrinted','cost','lots','salePrice','prints','duration','weight'].includes(sort)) {
      const left=numeric(a,sort),right=numeric(b,sort);
      // Monetary figures in different currencies are not directly
      // comparable. Group currency codes first without inventing FX rates.
      if (['cost','salePrice'].includes(sort) && left!==null && right!==null) {
        const leftCurrency=String(sort==='cost' ? a.costEstimate?.currency || '' : a.saleEstimate?.currency || '');
        const rightCurrency=String(sort==='cost' ? b.costEstimate?.currency || '' : b.saleEstimate?.currency || '');
        const currencyOrder=leftCurrency.localeCompare(rightCurrency);
        if(currencyOrder) return currencyOrder;
      }
      // Unknowns always below known values, in either sort direction.
      if (left===null && right!==null) return 1;
      if (right===null && left!==null) return -1;
      if (left!==null && right!==null && left!==right) return (left-right)*dir;
    } else {
      const diff=name(a,sort).localeCompare(name(b,sort),undefined,{numeric:true,sensitivity:'base'});
      if(diff) return diff*dir;
    }
    return String(a.fileName || '').localeCompare(String(b.fileName || ''),undefined,{numeric:true,sensitivity:'base'})
      || String(a.id || '').localeCompare(String(b.id || ''));
  });
}

export function libraryPage(items,page,pageSize=LIBRARY_PAGE_SIZE) {
  const count=items.length;
  const pages=Math.max(1,Math.ceil(count/pageSize));
  const index=Math.max(0,Math.min(pages-1,Math.trunc(Number(page)||0)));
  return {items:items.slice(index*pageSize,(index+1)*pageSize),page:index,
    pages,count,from:count?index*pageSize+1:0,to:Math.min(count,(index+1)*pageSize)};
}
