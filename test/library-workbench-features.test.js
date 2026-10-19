import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEstimatedPrintSeconds,parseGcodePrintRequirements} from '../src/file-print-requirements.js';
import {attachLibraryReadiness} from '../src/library-readiness.js';
import {
  libraryMaterials,libraryPrintSeconds,libraryWeightGrams,libraryTimeLabel,
  libraryWeightLabel,librarySortAndFilter,libraryPage,LIBRARY_PAGE_SIZE
} from '../public/library-utils.js';

const file=(id,extra={})=>({
  id,fileName:id+'.3mf',addedAt:'2026-10-18T12:00:00Z',
  requirements:{source:'gcode-bounded-scan',usageReliable:true,
    logicalTools:[{index:0,material:'ASA',filamentGrams:25,nozzleDiameter:.4}],
    estimatedPrintSeconds:3600},
  tags:[],favourite:false,costEstimate:{complete:true,totalCost:1.5,currency:'GBP'},
  usage:{completedPrints:1},...extra
});
test('Slicer duration parser reads only explicitly recognised duration fields',()=>{
  assert.equal(parseEstimatedPrintSeconds('; estimated printing time (normal mode) = 1h 25m 36s'),5136);
  assert.equal(parseEstimatedPrintSeconds('; estimated printing time = 2d 1h 2m'),176520);
  assert.equal(parseEstimatedPrintSeconds(';TIME:125'),125);
  assert.equal(parseEstimatedPrintSeconds('G1 X10 Y10\n; something else = 1h 10m'),null);
  assert.equal(parseEstimatedPrintSeconds('; estimated printing time = 123'),null);
  assert.equal(parseGcodePrintRequirements('; filament_type = ASA\n; filament used [g] = 30\n; estimated printing time (normal mode) = 1h 10m').estimatedPrintSeconds,4200);
});
test('File production metadata never fabricates missing filament weights',()=>{
  const x=file('part');
  assert.deepEqual(libraryMaterials(x),['ASA']);
  assert.equal(libraryWeightGrams(x),25);
  assert.equal(libraryPrintSeconds(x),3600);
  assert.equal(libraryTimeLabel(3600),'1h');
  assert.equal(libraryWeightLabel(0),'0 g');
  assert.equal(libraryWeightGrams(file('unknown',{requirements:{usageReliable:false,logicalTools:[{filamentGrams:0}]}})),null);
  assert.equal(libraryPrintSeconds(file('no-time',{requirements:{logicalTools:[]}})),null);
  assert.equal(libraryTimeLabel(null),'Not reported');
});
test('Facet filtering and stable numeric/lexical sorting preserve input records',()=>{
  const files=[
    file('bravo',{tags:['VW T6','Production'],favourite:true,costEstimate:{complete:true,totalCost:.2},usage:{completedPrints:9}}),
    file('Alpha',{tags:['Camping'],favourite:false,costEstimate:{complete:true,totalCost:2},requirements:{
      source:'gcode-bounded-scan',usageReliable:true,logicalTools:[{material:'PETG',filamentGrams:10}],estimatedPrintSeconds:500
    }}),
    file('charlie',{tags:['Production'],favourite:true,costEstimate:{complete:false,totalCost:null},
      requirements:{source:'gcode-bounded-scan',usageReliable:false,logicalTools:[{material:'ASA',filamentGrams:null}],estimatedPrintSeconds:null}})
  ];
  assert.deepEqual(librarySortAndFilter(files,{sort:'name',direction:'asc'}).map(x=>x.id),['Alpha','bravo','charlie']);
  assert.deepEqual(librarySortAndFilter(files,{sort:'cost',direction:'asc'}).map(x=>x.id),['bravo','Alpha','charlie']);
  assert.deepEqual(librarySortAndFilter(files,{sort:'cost',direction:'desc'}).map(x=>x.id),['Alpha','bravo','charlie']);
  assert.deepEqual(librarySortAndFilter(files,{sort:'duration',direction:'asc'}).map(x=>x.id),['Alpha','bravo','charlie']);
  assert.deepEqual(librarySortAndFilter(files,{material:'ASA',tag:'Production',favourites:true}).map(x=>x.id),['bravo','charlie']);
  assert.deepEqual(librarySortAndFilter(files,{cost:'missing'}).map(x=>x.id),['charlie']);
  assert.deepEqual(librarySortAndFilter(files,{query:'Camping'}).map(x=>x.id),['Alpha']);
  assert.equal(files[0].fileName,'bravo.3mf','sorting must not change the input objects');
});
test('Client-side paging never renders thousands of rows at once',()=>{
  const all=Array.from({length:550},(_,i)=>file('part-'+i));
  assert.equal(LIBRARY_PAGE_SIZE,80);
  const first=libraryPage(all,0);
  assert.equal(first.items.length,80);
  assert.equal(first.count,550);
  assert.equal(first.pages,7);
  assert.equal(first.from,1);
  const last=libraryPage(all,999);
  assert.equal(last.page,6);
  assert.equal(last.from,481);
  assert.equal(last.to,550);
  assert.equal(last.items.length,70);
});
test('Live readiness uses actual compatibility evaluator and does not bypass queue checks',()=>{
  const printers=[{id:'configured',name:'Sample',adapterType:'sample',model:'Model A'}];
  const adapter={capabilities:{fileUpload:true,localFiles:true,printLocalFile:true},uploadExtensions:['.3mf'],limits:{toolCount:1}};
  const ready=attachLibraryReadiness([file('ok')],printers,{
    resolveAdapter:()=>adapter,
    getState:()=>({online:true,status:{status:'idle',tools:[{index:0,nozzleDiameter:.4,filament:{present:true,material:'ASA'}}]}})
  });
  assert.equal(ready[0].readiness.level,'ready');
  const offline=attachLibraryReadiness([file('ok')],printers,{
    resolveAdapter:()=>adapter,getState:()=>({online:false,status:{status:'offline'}})
  });
  assert.equal(offline[0].readiness.level,'attention');
  const incompatible=attachLibraryReadiness([file('bad',{printerTarget:{adapterType:'other',model:'other'}})],printers,{
    resolveAdapter:()=>adapter,getState:()=>({online:true,status:{status:'idle'}})
  });
  assert.equal(incompatible[0].readiness.level,'incompatible');
  assert.equal(attachLibraryReadiness([file('missing')],[],{
    resolveAdapter:()=>adapter,getState:()=>null
  })[0].readiness.level,'attention');
});
test('Library UI binds all sorting, filters, tags, favourites and pagers to Preact and fallback',()=>{
  const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const html=read('public/index.html'),app=read('public/app.js'),preact=read('ui/print-library.jsx'),css=read('public/print-library-polish.css'),server=read('src/server.js');
  for (const id of ['libraryPrinterFilter','libraryMaterialFilter','libraryTagFilter','libraryCostFilter','libraryReadinessFilter','libraryFavouritesFilter','librarySortSelect','librarySortDirectionBtn','libraryFavouriteSelectedBtn','libraryMetadataTags','libraryMetadataFavourite']) {
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(app,/librarySortAndFilter\(files, libraryFilters\(\)\)/);
  assert.match(app,/libraryPage\(visible,libraryCurrentPage,LIBRARY_PAGE_SIZE\)/);
  assert.match(app,/data-library-page/);
  assert.match(preact,/LibraryPagination/);
  assert.match(preact,/library-readiness/);
  assert.match(preact,/library-production-meta/);
  assert.match(preact,/library-tags/);
  assert.match(server,/attachLibraryReadiness/);
  assert.match(server,/tags:body.tags/);
  assert.match(server,/favourite:body.favourite/);
  assert.match(css,/library-advanced-filters/);
});
