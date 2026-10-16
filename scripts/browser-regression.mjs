// Chromium smoke regression; npm run test:browser (not part of node --test).
// npm install --include=dev && npx playwright install chromium
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controllerVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const routes = [
  ['/',null],['/queue','queueDialog'],['/library','libraryDialog'],
  ['/maintenance','maintenanceDialog'],['/groups','printerGroupsDialog'],
  ['/reports','reportingDialog'],['/alerts','alertsDialog'],
  ['/backup','backupRecoveryDialog'],['/diagnostics','diagnosticsDialog'],
  ['/licence','licenseDialog']
];

async function portNumber() {
  const server = net.createServer();
  await new Promise((resolve,reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}

async function waitForController(url, processHandle, logs) {
  for (let i = 0; i < 120; i++) {
    if (processHandle.exitCode !== null) throw new Error('Controller exited:\n'+logs.join('').slice(-4000));
    try { if ((await fetch(url, {signal:AbortSignal.timeout(1200)})).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve,250));
  }
  throw new Error('Controller startup timed out:\n'+logs.join('').slice(-4000));
}

async function preactReady(page) {
  await page.waitForFunction(() => {
    const s = window.__PFC_FRONTEND_RENDERER_STATUS__;
    return s && s.bundleLoaded === true && s.preactCount === 13 && s.fallbackCount === 0;
  },null,{timeout:15000});
}

async function reportsLoaded(page,where) {
  await page.waitForFunction(() =>
    document.querySelectorAll('#reportingKpis .reporting-kpi').length >= 8
    && document.querySelector('#reportingStatus')?.textContent?.includes('Reporting period:')
  ,null,{timeout:20000});
  const kpis = await page.locator('#reportingKpis .reporting-kpi').allTextContents();
  assert.ok(kpis.some((s)=>s.includes('Print attempts')),where+' must show report results');
  assert.ok(await page.locator('#reportingRange option').count()>0,where+' range choices');
  assert.ok(await page.locator('#reportingPrinter option').count()>0,where+' printer choices');
}

async function routeSmoke(page,url) {
  console.log('Chromium: checking direct load of all controller routes');
  for (const [route,id] of routes) {
    await page.goto(url+route,{waitUntil:'load'});
    await preactReady(page);
    await page.waitForFunction(([r,pageId])=>
      document.body.dataset.route===r && (!pageId || document.getElementById(pageId)?.hidden===false)
    ,[route,id]);
    if (id) {
      assert.ok((await page.locator('#'+id).innerText()).trim().length>20,route+' must not be blank');
    }
    // Exercise the actual browser refresh on every direct route, not merely
    // a fresh navigation from the dashboard.
    await page.reload({waitUntil:'load'});
    await preactReady(page);
    await page.waitForFunction(([r,pageId])=>
      document.body.dataset.route===r && (!pageId || document.getElementById(pageId)?.hidden===false)
    ,[route,id]);
  }

  console.log('Chromium: report data after direct navigation, page reload and tab changes');
  await page.goto(url+'/reports',{waitUntil:'load'});
  await reportsLoaded(page,'direct report');
  await page.reload({waitUntil:'load'});
  await reportsLoaded(page,'refreshed report');
  await page.locator('[data-reporting-tab="filament"]').click();
  await page.waitForFunction(()=>document.querySelector('#reportingPanelFilament')?.hidden===false);
  await page.locator('[data-reporting-tab="analytics"]').click();
  await page.waitForFunction(()=>document.querySelector('#reportingPanelAnalytics')?.hidden===false);

  console.log('Chromium: click navigation and history Back/Forward');
  await page.locator('#queueBtn').click();
  await page.waitForFunction(()=>location.pathname==='/queue'&&!document.querySelector('#queueDialog').hidden);
  await page.locator('#libraryBtn').click();
  await page.waitForFunction(()=>location.pathname==='/library'&&!document.querySelector('#libraryDialog').hidden);
  await page.goBack({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>location.pathname==='/queue'&&!document.querySelector('#queueDialog').hidden);
  await page.goForward({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>location.pathname==='/library'&&!document.querySelector('#libraryDialog').hidden);

  console.log('Chromium: live Preact state dispatch must rerender reporting');
  await page.goto(url+'/reports',{waitUntil:'load'});
  await reportsLoaded(page,'before live update');
  await page.evaluate(()=>{
    window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state',{
      detail:{...(window.__PFC_REPORTING_UI_STATE__||{}),kpis:[{label:'Synthetic telemetry',value:'2718'}]}
    }));
  });
  await page.waitForFunction(()=>document.querySelector('#reportingKpis')?.textContent?.includes('Synthetic telemetry')
    && document.querySelector('#reportingKpis')?.textContent?.includes('2718'));

  console.log('Chromium: live fleet presentation updates the same keyed printer card');
  // Isolate the Preact bridge check from a real empty-fleet SSE update racing
  // the synthetic test row, while retaining actual Chromium DOM reconciliation.
  await page.route('**/api/events',(route)=>route.fulfill({
    status:200,headers:{'content-type':'text/event-stream'},
    body:': fleet bridge fixture\n\n'
  }));
  await page.goto(url+'/',{waitUntil:'load'});
  await preactReady(page);
  // Preact hooks register event subscriptions in an effect after first paint.
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
    const printer={
      id:'synthetic-fleet-printer',name:'Synthetic printer',visible:true,
      state:'Idle',stateClass:'idle',progress:0,progressText:'0%',
      jobName:'No active job',hostText:'localhost',nozzleLabel:'Nozzle',
      nozzle:'25°C',bed:'25°C',layer:'—',remaining:'—',
      lastSeen:'just now',latency:'1 ms',image:{label:'Synthetic'}
    };
    window.dispatchEvent(new CustomEvent('pfc:dashboard-fleet-state',{
      detail:{printers:[printer]}
    }));
  });
  await page.waitForFunction(()=>document.querySelector('[data-printer-card="synthetic-fleet-printer"] [data-name]')?.textContent==='Synthetic printer');
  await page.evaluate(()=>{
    const printer={
      id:'synthetic-fleet-printer',name:'Synthetic printer',visible:true,
      state:'Printing',stateClass:'printing',progress:46,progressText:'46%',
      jobName:'sample.gcode',hostText:'localhost',nozzleLabel:'Nozzle',
      nozzle:'205°C',bed:'60°C',layer:'22',remaining:'00:30',
      lastSeen:'just now',latency:'2 ms',image:{label:'Synthetic'}
    };
    window.dispatchEvent(new CustomEvent('pfc:dashboard-fleet-state',{
      detail:{printers:[printer]}
    }));
  });
  await page.waitForFunction(()=>{
    const card=document.querySelector('[data-printer-card="synthetic-fleet-printer"]');
    return card && card.querySelector('[data-progress-value]')?.textContent==='46%'
      && card.querySelector('[data-job-name]')?.textContent==='sample.gcode'
      && card.querySelector('[data-nozzle]')?.textContent==='205°C';
  });
  assert.equal(await page.locator('[data-printer-card="synthetic-fleet-printer"]').count(),1,
    'Preact reconciles an existing printer rather than duplicating its card');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pfc:dashboard-fleet-state',{detail:{printers:[]}})));
  await page.waitForFunction(()=>!document.querySelector('[data-printer-card="synthetic-fleet-printer"]'));
  await page.unroute('**/api/events');
}

async function groupEditorSmoke(browser,url) {
  console.log('Chromium: Preact printer group editor owns create/edit/delete and preserves drafts');
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',(e)=>errors.push(e.message));
  page.on('dialog',(dialog)=>dialog.accept());
  let groups=[{id:'seed-group',name:'Existing group',printerIds:[],members:[]}];
  const counts={post:0,patch:0,delete:0};
  await context.route('**/api/events',(route)=>route.fulfill({
    status:200,headers:{'content-type':'text/event-stream'},
    body:': isolated group editor fixture\\n\\n'
  }));
  // Keep this regression safe even when PFC_BROWSER_TEST_BASE_URL is set.
  // All group mutations go to this in-memory Playwright fixture.
  await context.route('**/api/printer-groups**',async (route)=>{
    const request=route.request();
    const method=request.method();
    const pathname=new URL(request.url()).pathname;
    const id=pathname.split('/')[3]||'';
    let status=200,payload={};
    const body=['POST','PATCH'].includes(method) ? request.postDataJSON() : {};
    if(method==='GET' && pathname==='/api/printer-groups'){
      payload={version:1,groups};
    } else if(method==='POST'){
      counts.post++;
      if(groups.some((item)=>item.name.toLowerCase()===String(body.name).toLowerCase())){
        status=400;payload={error:'A printer group with this name already exists'};
      } else {
        const created={id:'created-group',name:body.name,printerIds:body.printerIds,members:[]};
        groups=[...groups,created];payload={group:created};
      }
    } else if(method==='PATCH' && id){
      counts.patch++;
      groups=groups.map((item)=>item.id===id?{...item,name:body.name,printerIds:body.printerIds}:item);
      payload={group:groups.find((item)=>item.id===id)};
    } else if(method==='DELETE' && id){
      counts.delete++;
      groups=groups.filter((item)=>item.id!==id);
      payload={success:true};
    } else {
      status=404;payload={error:'Unknown fixture request'};
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload)});
  });
  try {
    await page.goto(url+'/groups',{waitUntil:'load'});
    await preactReady(page);
    await page.locator('[data-printer-group-edit="seed-group"]').waitFor();
    assert.equal(await page.locator('#printerGroupForm').count(),1,'single active group form');
    assert.equal(await page.locator('#printerGroupsList').count(),1,'single active group list');

    // An SSE/reload-style state publication must not overwrite unsaved inputs.
    await page.evaluate(()=>{
      const current=window.__PFC_PRINTER_GROUPS_UI_STATE__;
      const withPrinters={
        ...current,
        printers:[
          {id:'sample-one',name:'Sample One',manufacturer:'Snapmaker',model:'U1'},
          {id:'sample-two',name:'Sample Two',manufacturer:'FlashForge',model:'AD5M Pro'}
        ]
      };
      window.dispatchEvent(new CustomEvent('pfc:printer-groups-ui-state',{detail:withPrinters}));
      window.__PFC_TEST_GROUP_STATE__=withPrinters;
    });
    await page.locator('[data-printer-group-member][value="sample-one"]').check();
    await page.locator('#printerGroupName').fill('Unsubmitted draft');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pfc:printer-groups-ui-state',{
      detail:window.__PFC_TEST_GROUP_STATE__
    })));
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Unsubmitted draft',
      'external group snapshot must preserve the user draft');
    assert.ok(await page.locator('[data-printer-group-member][value="sample-one"]').isChecked(),
      'group membership draft must survive an external update');

    // Reload to discard the synthetic printer IDs; exercise CRUD against the
    // in-memory group API without a real configured printer.
    await page.reload({waitUntil:'load'});
    await preactReady(page);
    await page.locator('[data-printer-group-edit="seed-group"]').waitFor();
    await page.locator('#printerGroupName').fill('Production');
    await page.locator('#printerGroupSubmit').click();
    await page.waitForTimeout(300);
    console.log('Group editor POST diagnostics:',JSON.stringify({
      counts,dom:await page.evaluate(()=>({
        preact:window.__PFC_PREACT_PRINTER_GROUPS__,
        name:document.querySelector('#printerGroupName')?.value,
        type:document.querySelector('#printerGroupSubmit')?.type,
        error:document.querySelector('#printerGroupError')?.textContent,
        status:document.querySelector('#printerGroupsStatus')?.textContent,
        cards:[...document.querySelectorAll('[data-printer-group-card]')].map(x=>x.dataset.printerGroupCard)
      }))
    }));
    await page.waitForFunction(()=>
      document.querySelector('#printerGroupsStatus')?.textContent?.includes('created.'));
    await page.locator('[data-printer-group-edit="created-group"]').waitFor();
    assert.equal(counts.post,1,'one submit creates exactly one group');

    await page.locator('#printerGroupName').fill('Production');
    await page.locator('#printerGroupSubmit').click();
    await page.locator('#printerGroupError[role="alert"]').getByText('already exists').waitFor();
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Production',
      'failed create keeps entered name');
    assert.equal(counts.post,2,'duplicate submission is rejected without resetting form');

    await page.locator('[data-printer-group-edit="created-group"]').click();
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Production');
    await page.locator('#printerGroupName').fill('Production A');
    await page.locator('#printerGroupSubmit').click();
    await page.waitForFunction(()=>
      document.querySelector('#printerGroupsStatus')?.textContent?.includes('updated.'));
    await page.locator('[data-printer-group-card="created-group"] strong').getByText('Production A').waitFor();
    assert.equal(counts.patch,1,'one edit submits exactly one patch');

    await page.locator('[data-printer-group-delete="created-group"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-printer-group-card="created-group"]'));
    assert.equal(counts.delete,1,'one delete performs exactly one request');
    assert.ok(await page.locator('[data-printer-group-edit="seed-group"]').count(),
      'deleting one group does not remove unrelated groups');
    assert.deepEqual(errors,[],'group editor browser page must not throw');
  } finally {await context.close();}
}

async function queueClickSmoke(browser,url) {
  console.log('Chromium: Preact queue clearance uses a real delegated click and only one POST');
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',(e)=>errors.push(e.message));
  page.on('dialog',(d)=>d.accept());
  let submissions=0;
  const queue={jobs:[],productionBatches:[],bedClearance:[{
    printerId:'browser-1',printerName:'Test printer',fileName:'part.gcode',
    jobStatus:'completed',finishedAt:'2026-10-16T10:00:00Z'
  }]};
  await context.route('**/api/fleet',(route)=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({printers:[],version:controllerVersion,queue})
  }));
  // Suppress real server telemetry in this isolated browser context so the
  // synthetic pending-clearance fixture is not replaced by the empty fleet.
  await context.route('**/api/events',(route)=>route.fulfill({
    status:200,headers:{'content-type':'text/event-stream'},
    body:': isolated fixture\n\n'
  }));
  await context.route('**/api/queue/bed-clearance/browser-1',(route)=>{
    submissions++;
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({queue:{jobs:[],productionBatches:[],bedClearance:[]}})});
  });
  try {
    await page.goto(url+'/queue',{waitUntil:'load'});
    await preactReady(page);
    const button=page.locator('#queueActiveList [data-bed-cleared="browser-1"]');
    await button.waitFor({state:'visible',timeout:12000});
    await page.evaluate(()=>{
      const state=window.__PFC_QUEUE_UI_STATE__;
      window.dispatchEvent(new CustomEvent('pfc:queue-ui-state',{
        detail:{...state,summary:'Live queue updated'}
      }));
    });
    await page.waitForFunction(()=>document.querySelector('#queueSummary')?.textContent?.includes('Live queue updated'));
    await button.click();
    await page.waitForFunction(()=>!document.querySelector('#queueActiveList [data-bed-cleared="browser-1"]'),null,{timeout:12000});
    assert.equal(submissions,1,'one click should submit one clearance request');
    assert.deepEqual(errors,[],'queue browser page must not throw');
  } finally { await context.close(); }
}

async function simulatorSseSmoke(browser,url) {
  console.log('Chromium: real controller SSE with protocol-backed simulated printer');
  const jsonPost=async (endpoint,body)=>{
    const response=await fetch(url+endpoint,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
    });
    const payload=await response.json();
    assert.ok(response.ok,endpoint+' failed ('+response.status+'): '+JSON.stringify(payload));
    return payload;
  };
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const page=await context.newPage();
  const failures=[];
  page.on('pageerror',(error)=>failures.push(error.message));
  await page.addInitScript(()=>{
    window.__PFC_SSE_TEST__={connections:0,events:[],errors:0};
    const NativeEventSource=window.EventSource;
    window.EventSource=class extends NativeEventSource {
      constructor(url,options){
        super(url,options);
        if (String(url).includes('/api/events')) {
          window.__PFC_SSE_TEST__.connections++;
          this.addEventListener('fleet',(event)=>{
            try {
              const payload=JSON.parse(event.data);
              window.__PFC_SSE_TEST__.events.push({
                printers:(payload.printers||[]).map((printer)=>({
                  id:printer.id,online:printer.online,
                  status:printer.status?.status||null,
                  fileName:printer.status?.fileName||null
                }))
              });
              if(window.__PFC_SSE_TEST__.events.length>60)window.__PFC_SSE_TEST__.events.shift();
            } catch(e) {window.__PFC_SSE_TEST__.errors++;}
          });
        }
      }
    };
  });
  try {
    const status=await jsonPost('/api/emulator/status',{enabled:true});
    assert.equal(status.running,true,'integrated simulator starts within the isolated controller');
    const created=await jsonPost('/api/emulator/printers',{
      profileId:'snapmaker-u1',name:'SSE simulator U1',
      ports:{httpPort:0}
    });
    assert.ok(created.printer?.controllerSettings,'simulator provides adapter registration details');

    // Load the actual dashboard through the server. This page is NOT served
    // mocked /api/fleet or /api/events responses; both connect to the running
    // controller's fleet service and true EventSource transport.
    await page.goto(url+'/',{waitUntil:'load'});
    await preactReady(page);
    await page.waitForFunction(()=>window.__PFC_SSE_TEST__?.connections>=1
      && window.__PFC_SSE_TEST__?.events?.length>=1,null,{timeout:12000});
    const registration=await jsonPost('/api/printers',created.printer.controllerSettings);
    const printerId=registration.printer?.id;
    assert.ok(printerId,'virtual printer must be registered with the real controller');
    await page.waitForFunction((id)=>
      document.querySelector('[data-printer-card="'+id+'"] [data-name]')?.textContent==='SSE simulator U1'
      && window.__PFC_SSE_TEST__.events.some((e)=>e.printers.some((p)=>p.id===id&&p.online===true))
    ,printerId,{timeout:25000});

    const count=await page.locator('[data-printer-card="'+printerId+'"]').count();
    assert.equal(count,1,'only one registered printer card rendered');
    const started=await jsonPost('/api/emulator/printers/'+encodeURIComponent(created.printer.id)+'/actions',{
      action:'start',fileName:'calibration-cube.gcode'
    });
    assert.equal(started.printer?.status,'printing','virtual device entered printing state');

    await page.waitForFunction((id)=>{
      const events=window.__PFC_SSE_TEST__?.events||[];
      const received=events.some((e)=>e.printers.some((p)=>p.id===id&&p.status==='printing'));
      const card=document.querySelector('[data-printer-card="'+id+'"]');
      return received && card && card.querySelector('[data-job-name]')?.textContent?.includes('calibration-cube.gcode');
    },printerId,{timeout:30000});
    assert.equal(await page.locator('[data-printer-card="'+printerId+'"]').count(),1,
      'same Preact card updates in place after true protocol polling and SSE');
    const diagnostic=await page.evaluate(()=>({
      connections:window.__PFC_SSE_TEST__.connections,
      events:window.__PFC_SSE_TEST__.events.length,
      errors:window.__PFC_SSE_TEST__.errors
    }));
    assert.ok(diagnostic.events>=2,'SSE must publish both connection and simulator state changes');
    assert.equal(diagnostic.errors,0,'no invalid controller SSE payloads');
    assert.deepEqual(failures,[],'real simulator SSE browser errors');
    console.log('Chromium: simulator protocol -> fleet poll -> real SSE -> Preact card PASS');
  } finally {
    await context.close();
    // Isolated controller process teardown is the safety boundary; no external
    // printer or persistent user configuration is touched by this test.
  }
}

async function main() {
  const externalUrl=process.env.PFC_BROWSER_TEST_BASE_URL||null;
  const dir=externalUrl?null:await fs.mkdtemp(path.join(os.tmpdir(),'pfc-chromium-'));
  const logs=[],errors=[];
  let processHandle=null,browser=null,page=null;
  try {
    const url=externalUrl||('http://127.0.0.1:'+(await portNumber()));
    if (!externalUrl) {
      processHandle=spawn(process.execPath,['src/server.js'],{
        cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:url.split(':').at(-1),
          DATA_DIR:path.join(dir,'data'),LOG_DIR:path.join(dir,'logs'),DISCOVERY_SUBNET:'',EMULATOR_NO_DEFAULTS:'1'},
        stdio:['ignore','pipe','pipe']
      });
      processHandle.stdout.on('data',(x)=>logs.push(String(x)));
      processHandle.stderr.on('data',(x)=>logs.push(String(x)));
      await waitForController(url,processHandle,logs);
    }
    const response=await fetch(url+'/dashboard-preact.js');
    assert.equal(response.status,200,'frontend bundle must exist: npm run build:frontend');
    assert.match(response.headers.get('content-type')||'',/javascript/,
      'SPA HTML is not a valid Preact bundle');

    browser=await chromium.launch({headless:true,args:process.platform==='linux'?['--no-sandbox']:[]});
    const context=await browser.newContext({viewport:{width:1365,height:900}});
    page=await context.newPage();
    page.on('pageerror',(e)=>errors.push(e.message));
    await routeSmoke(page,url);
    await queueClickSmoke(browser,url);
    await groupEditorSmoke(browser,url);
    if(!externalUrl) await simulatorSseSmoke(browser,url);
    assert.deepEqual(errors,[],'browser Javascript errors');
    console.log('Chromium browser regression: PASSED');
  } catch (error) {
    console.error('Chromium regression FAILED:',error.stack||error);
    if (errors.length) console.error('Page errors:',errors);
    if (logs.length) console.error('Server tail:',logs.join('').slice(-3000));
    if (page) {
      await fs.mkdir(path.join(root,'test-artifacts'),{recursive:true});
      await page.screenshot({path:path.join(root,'test-artifacts/browser-failure.png'),fullPage:true}).catch(()=>{});
    }
    process.exitCode=1;
  } finally {
    await browser?.close().catch(()=>{});
    if (processHandle) {
      processHandle.kill();
      await new Promise((resolve)=>{
        if(processHandle.exitCode!==null)return resolve();
        processHandle.once('exit',resolve);
        setTimeout(resolve,3000).unref();
      });
    }
    if(dir) await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

await main();
