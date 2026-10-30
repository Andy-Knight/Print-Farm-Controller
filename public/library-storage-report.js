const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const colours=['#328de2','#20b37b','#ab85d7','#d28a58','#ef515d','#26a8ae','#c48c28','#6b83c7'];
export function storageBytes(value){
  if(!Number.isFinite(value)||value<0)return '—';
  const units=['B','KiB','MiB','GiB','TiB'];let index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index++;}
  return value.toLocaleString(undefined,{maximumFractionDigits:index?1:0})+' '+units[index];
}

export function storageReportModel(report,days=30){
  const end=Date.parse(report.at),start=end-Number(days)*86400000;
  const rows=(report.accounts||[]).map((row,index)=>({...row,colour:colours[index%colours.length],
    label:row.status==='deleted'?`${row.label} (${String(row.id).slice(-6)})`:row.label}));
  const payload=rows.reduce((sum,row)=>sum+row.bytes,0);
  const samples=(report.history||[]).filter(point=>Date.parse(point.at)>=start&&Date.parse(point.at)<=end);
  // The current measurement is real, even if the hourly retained sample is older.
  if(!samples.length||samples.at(-1).at!==report.at)samples.push({at:report.at,bytes:report.bytes,limit:report.limit});
  return {...report,rows,payload,samples,percent:report.limit>0?report.bytes/report.limit*100:0};
}

function storagePie(model){
  if(!model.payload)return '<div class="reporting-empty">No account storage is in use.</div>';
  let angle=-Math.PI/2;
  const sectors=model.rows.filter(row=>row.bytes>0).map(row=>{
    const fraction=row.bytes/model.payload,next=angle+fraction*Math.PI*2;
    const title=escape(`${row.label}: ${storageBytes(row.bytes)} (${(fraction*100).toFixed(1)}%)`);
    const shape=fraction>=1?'<circle cx="120" cy="120" r="104"'
      :`<path d="M120 120 L${120+104*Math.cos(angle)} ${120+104*Math.sin(angle)} A104 104 0 ${fraction>.5?1:0} 1 ${120+104*Math.cos(next)} ${120+104*Math.sin(next)} Z"`;
    angle=next;return `${shape} fill="${row.colour}" tabindex="0"><title>${title}</title></${fraction>=1?'circle':'path'}>`;
  });
  return `<svg class="library-storage-pie" viewBox="0 0 240 240" role="img" aria-label="Print Library file storage by quota owner">${sectors.join('')}</svg>`;
}

function storageTrend(model){
  const points=model.samples,width=760,height=260,left=90,right=22,top=24,bottom=44;
  const max=Math.max(model.limit,...points.flatMap(point=>[point.bytes,point.limit]),1)*1.08;
  const first=Date.parse(points[0].at),last=Date.parse(points.at(-1).at),span=Math.max(1,last-first);
  const x=point=>left+(Date.parse(point.at)-first)/span*(width-left-right);
  const y=value=>top+(1-value/max)*(height-top-bottom);
  const path=key=>points.map((point,index)=>{
    const separated=index&&Date.parse(point.at)-Date.parse(points[index-1].at)>90*60000;
    return `${index&&!separated?'H':'M'}${x(point).toFixed(2)}${index&&!separated?' V':' '}${y(point[key]).toFixed(2)}`;
  }).join(' ');
  const grid=Array.from({length:5},(_,index)=>{
    const value=max*index/4,at=y(value);
    return `<line x1="${left}" x2="${width-right}" y1="${at}" y2="${at}" class="reporting-grid-line"/><text x="${left-10}" y="${at+4}" text-anchor="end" class="reporting-axis-text">${storageBytes(value)}</text>`;
  }).join('');
  const markers=points.map(point=>`<circle cx="${x(point)}" cy="${y(point.bytes)}" r="3" class="library-storage-point"><title>${escape(new Date(point.at).toLocaleString()+': '+storageBytes(point.bytes)+' used / '+storageBytes(point.limit)+' limit')}</title></circle>${points.length===1?`<circle cx="${x(point)}" cy="${y(point.limit)}" r="3" fill="var(--ds-warning,#c48c28)"><title>Configured maximum: ${escape(storageBytes(point.limit))}</title></circle>`:''}`).join('');
  const dates=[points[0],...(points.length>1?[points.at(-1)]:[])].map((point,index)=>`<text x="${x(point)}" y="${height-12}" text-anchor="${index?'end':'start'}" class="reporting-axis-text">${escape(new Date(point.at).toLocaleDateString())}</text>`).join('');
  return `<div class="reporting-chart-legend"><span><i class="reporting-legend-dot library-used"></i>Library on disk</span><span><i class="reporting-legend-dot library-limit"></i>Configured maximum</span></div><svg class="reporting-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Print Library disk usage over time against its configured maximum">${grid}<path d="${path('limit')}" class="reporting-series library-limit"/><path d="${path('bytes')}" class="reporting-series library-used"/>${markers}${dates}</svg>`;
}

export function renderStorageReport(report,days=30){
  const model=storageReportModel(report,days);
  const rows=model.rows.map(row=>`<tr><th scope="row"><i class="reporting-legend-dot" style="background:${row.colour}"></i> ${escape(row.label)}</th><td>${row.files}</td><td>${escape(storageBytes(row.bytes))}</td><td>${model.payload?(row.bytes/model.payload*100).toFixed(1)+'%':'—'}</td><td>${row.limit?escape(storageBytes(row.limit)):'Overall limit only'}</td></tr>`).join('');
  return `<section class="reporting-section"><div class="reporting-section-head"><div><h3>Print Library capacity</h3><span class="subtle">Measured ${escape(new Date(model.at).toLocaleString())}</span></div></div><p class="library-storage-total"><strong>${escape(storageBytes(model.bytes))}</strong> / ${escape(storageBytes(model.limit))} · ${model.percent.toFixed(1)}% used</p><p class="subtle">The global limit includes print files, previews and metadata. Account usage counts print-file bytes charged to each quota owner.</p></section>
    <section class="reporting-section"><div class="reporting-section-head"><h3>Storage by account</h3></div><div class="library-storage-breakdown">${storagePie(model)}<div class="reporting-table-content"><table class="auth-users-table"><thead><tr><th>Account</th><th>Files</th><th>Used</th><th>Share</th><th>Allowance</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No accounts or library files.</td></tr>'}</tbody></table></div></div></section>
    <section class="reporting-section"><div class="reporting-section-head"><h3>Storage over time</h3></div>${storageTrend(model)}<p class="subtle">Latest observation per hour, retained for up to 12 months. Recording starts on upgrade; gaps mean no observations were recorded. ${model.samples.length===1?'Only one observation is available so far.':''}</p></section>`;
}
