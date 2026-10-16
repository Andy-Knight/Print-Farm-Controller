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
    await page.locator('#printerGroupsTabCreate[aria-selected="true"]').waitFor();
    // The direct /groups route initializes while app.js is still fetching the
    // group cache. Do not click another tab before that first publication.
    await page.waitForFunction(() => document.querySelector('#printerGroupsTabExisting')
      ?.textContent?.includes('(1)'));
    assert.equal(await page.locator('#printerGroupForm').count(),1,'create tab owns its form');
    assert.equal(await page.locator('#printerGroupsList').count(),0,'existing list not rendered in create tab');
    await page.locator('#printerGroupsTabExisting').click();
    await page.locator('[data-printer-group-edit="seed-group"]').waitFor();
    assert.equal(await page.locator('#printerGroupForm').count(),0,'list tab starts without an editor');
    assert.equal(await page.locator('#printerGroupsList').count(),1,'existing list is visible in second tab');
    await page.locator('#printerGroupsTabCreate').click();

    // An SSE/reload-style state publication must not overwrite unsaved inputs.
    await page.evaluate(()=>{
      const current=window.__PFC_PRINTER_GROUPS_UI_STATE__;
      const withPrinters={
        ...current,
        printers:[
          {id:'sample-one',name:'Sample One',manufacturer:'Snapmaker',model:'U1'},
          {id:'sample-two',name:'Sample Two',manufacturer:'FlashForge',model:'AD5M Pro'},
          ...Array.from({length:180},(_,i)=>({
            id:'bulk-'+i,name:'Printer '+String(i).padStart(3,'0'),
            manufacturer:'Test manufacturer',model:'Model '+i
          }))
        ]
      };
      window.dispatchEvent(new CustomEvent('pfc:printer-groups-ui-state',{detail:withPrinters}));
      window.__PFC_TEST_GROUP_STATE__=withPrinters;
    });
    const layout=await page.locator('#printerGroupMembers').evaluate((panel)=>{
      const header=panel.querySelector('th');
      return {
        rowCount:panel.querySelectorAll('tbody tr').length,
        scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,
        overflowY:getComputedStyle(panel).overflowY,
        headerPosition:getComputedStyle(header).position
      };
    });
    assert.equal(layout.rowCount,182,'all 182 simulated printer choices are in one table');
    assert.ok(layout.scrollHeight>layout.clientHeight,'large membership list scrolls inside a bounded panel');
    assert.equal(layout.overflowY,'auto','membership table is independently scrollable');
    assert.equal(layout.headerPosition,'sticky','membership column headers stay in place');

    // All tabular surfaces use the same controller table design system in
    // both themes. The empty Alerts view has no table, so use a detached
    // DOM fixture with the production class names to exercise its CSS.
    const tableStyles=await page.evaluate(()=>{
      const wrapper=document.createElement('div');
      wrapper.style.position='fixed';
      wrapper.style.left='-5000px';
      wrapper.innerHTML=`<div class="alert-history-table">
        <div class="alert-history-head">Alert heading</div>
      </div><div class="frontend-renderer-table">
        <table><thead><tr><th>Renderer</th></tr></thead></table>
      </div><div class="material-table-head">Toolhead</div>`;
      document.body.append(wrapper);
      const root=document.documentElement;
      const initial=root.getAttribute('data-theme');
      const props=(el)=>{
        const computed=getComputedStyle(el);
        return {
          background:computed.backgroundColor,
          color:computed.color,
          size:computed.fontSize,
          weight:computed.fontWeight,
          spacing:computed.letterSpacing,
          transform:computed.textTransform
        };
      };
      const result={};
      try {
        for(const theme of ['dark','light']){
          root.setAttribute('data-theme',theme);
          const group=props(document.querySelector('.printer-group-members-table th'));
          const dashboard=props(document.querySelector('.fleet-table-header'));
          const alerts=props(wrapper.querySelector('.alert-history-head'));
          const renderer=props(wrapper.querySelector('.frontend-renderer-table th'));
          const toolhead=props(wrapper.querySelector('.material-table-head'));
          const memberSurface=getComputedStyle(document.querySelector('#printerGroupMembers'));
          const alertSurface=getComputedStyle(wrapper.querySelector('.alert-history-table'));
          result[theme]={group,dashboard,alerts,renderer,toolhead,
            memberSurface:{background:memberSurface.backgroundColor,border:memberSurface.borderTopColor},
            alertSurface:{background:alertSurface.backgroundColor,border:alertSurface.borderTopColor}};
        }
      } finally {
        if(initial===null)root.removeAttribute('data-theme');
        else root.setAttribute('data-theme',initial);
        wrapper.remove();
      }
      return result;
    });
    for(const [theme,styles] of Object.entries(tableStyles)){
      for(const type of ['dashboard','alerts','renderer','toolhead']){
        assert.deepEqual(styles.group,styles[type],
          theme+' table headings must use the shared header appearance: '+type);
      }
      assert.deepEqual(styles.memberSurface,styles.alertSurface,
        theme+' printer membership panel must match alert table surface and border');
      assert.equal(styles.group.transform,'uppercase',
        theme+' table header labels must be uppercase');
      assert.equal(styles.group.weight,'800',
        theme+' table header labels must use the common weight');
    }

    await page.locator('[data-printer-group-member][value="sample-one"]').check();
    await page.locator('[data-printer-group-member][value="bulk-179"]').check();
    await page.locator('#printerGroupMemberSearch').fill('Printer 179');
    assert.equal(await page.locator('#printerGroupMembers tbody tr').count(),1,
      'search narrows choices to the matching printer');
    assert.ok(await page.locator('[data-printer-group-member][value="bulk-179"]').isChecked(),
      'matching printer retains selection during filtering');
    await page.locator('[data-printer-group-clear-visible]').click();
    assert.equal(await page.locator('[data-printer-group-member][value="bulk-179"]').isChecked(),false,
      'clear visible deselects the filtered printer');
    await page.locator('[data-printer-group-select-visible]').click();
    assert.ok(await page.locator('[data-printer-group-member][value="bulk-179"]').isChecked(),
      'select visible restores filtered selection');
    await page.locator('#printerGroupMemberSearch').fill('');
    assert.ok(await page.locator('[data-printer-group-member][value="sample-one"]').isChecked(),
      'select/clear filtered items must not change hidden selections');
    assert.match(await page.locator('#printerGroupMemberCount').innerText(),/2 selected/);
    const stickyHeader=await page.locator('#printerGroupMembers').evaluate((panel)=>{
      panel.scrollTop=220;
      return {
        wrapperTop:panel.getBoundingClientRect().top,
        headerTop:panel.querySelector('th').getBoundingClientRect().top
      };
    });
    assert.ok(stickyHeader.headerTop>=stickyHeader.wrapperTop-2
      && stickyHeader.headerTop<=stickyHeader.wrapperTop+4,
      'the table header stays visible while its body is scrolled');
    await page.locator('#printerGroupName').fill('Unsubmitted draft');
    await page.locator('#printerGroupsTabExisting').click();
    assert.equal(await page.locator('#printerGroupForm').count(),0,'tab switch hides create form');
    await page.locator('#printerGroupsTabCreate').click();
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Unsubmitted draft',
      'switching tabs does not discard a create draft');
    assert.ok(await page.locator('[data-printer-group-member][value="sample-one"]').isChecked(),
      'switching tabs retains selected members');
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
    await page.locator('#printerGroupsTabCreate[aria-selected="true"]').waitFor();
    // The direct /groups route initializes while app.js is still fetching the
    // group cache. Do not click another tab before that first publication.
    await page.waitForFunction(() => document.querySelector('#printerGroupsTabExisting')
      ?.textContent?.includes('(1)'));
    await page.locator('#printerGroupsTabExisting').click();
    await page.locator('[data-printer-group-edit="seed-group"]').waitFor();
    await page.locator('#printerGroupsTabCreate').click();
    await page.locator('#printerGroupName').fill('Production');
    await page.locator('#printerGroupSubmit').click();
    await page.waitForFunction(()=>
      document.querySelector('#printerGroupsStatus')?.textContent?.includes('created.'));
    await page.locator('[data-printer-group-edit="created-group"]').waitFor();
    assert.equal(await page.locator('#printerGroupsTabExisting').getAttribute('aria-selected'),'true',
      'successfully created groups appear immediately on the existing-groups tab');
    assert.equal(await page.locator('#printerGroupForm').count(),0,
      'successful create does not leave an edit form in the existing-groups tab');
    assert.equal(counts.post,1,'one submit creates exactly one group');

    await page.locator('#printerGroupsTabCreate').click();
    await page.locator('#printerGroupName').fill('Production');
    await page.locator('#printerGroupSubmit').click();
    await page.locator('#printerGroupError[role="alert"]').getByText('already exists').waitFor();
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Production',
      'failed create keeps entered name');
    assert.equal(counts.post,2,'duplicate submission is rejected without resetting form');

    await page.locator('#printerGroupsTabExisting').click();
    await page.locator('[data-printer-group-edit="created-group"]').click();
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Production');
    await page.locator('#printerGroupName').fill('Production A');
    await page.locator('#printerGroupsTabCreate').click();
    assert.equal(await page.locator('#printerGroupForm').count(),1,
      'create tab stays independent from the in-progress group edit');
    await page.locator('#printerGroupsTabExisting').click();
    assert.equal(await page.locator('#printerGroupName').inputValue(),'Production A',
      'in-progress edit draft survives tab switching');
    await page.locator('#printerGroupSubmit').click();
    await page.waitForFunction(()=>
      document.querySelector('#printerGroupsStatus')?.textContent?.includes('updated.'));
    await page.locator('[data-printer-group-card="created-group"] strong').getByText('Production A').waitFor();
    assert.equal(counts.patch,1,'one edit submits exactly one patch');
    assert.equal(await page.locator('#printerGroupForm').count(),0,
      'saving an edit closes the edit form while retaining the existing-groups list');

    await page.locator('[data-printer-group-edit="seed-group"]').click();
    await page.locator('#printerGroupCancelEdit').click();
    assert.equal(await page.locator('#printerGroupsTabExisting').getAttribute('aria-selected'),'true',
      'cancel edit remains on the group-management tab');
    assert.equal(await page.locator('#printerGroupForm').count(),0,
      'cancel edit closes the edit form');

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

// Compare the actual control edges (not just the outer table cells) with
// the shared Toolhead table headings. A generic dialog "form {padding:22px}"
// previously indented every Preact form independently of the grid.
async function checkToolheadFieldAlignment(page, name, {filamentMode, nozzleMode=null, headingRequired=true}) {
  const measured=await page.evaluate(({filamentMode,nozzleMode})=>{
    const panel=document.querySelector('#printerDialog #detailTabToolheads .material-panel');
    const headings=[...(panel?.querySelector('.material-table-head')?.children||[])];
    const row=panel?.querySelector('.material-tool-row') || panel?.querySelector('.material-tool');
    const filament=row?.querySelector(`[data-preact-toolhead-editor="${filamentMode}"]`);
    const nozzle=nozzleMode?row?.querySelector(`[data-preact-toolhead-editor="${nozzleMode}"]`):null;
    const x=(element)=>element?.getBoundingClientRect().left ?? null;
    const formPadding=(element)=>element?getComputedStyle(element).paddingLeft:null;
    return {
      headers:headings.map(x),
      materialField:x(filament?.querySelector('[data-toolhead-material]')),
      colourField:x(filament?.querySelector('.color-family-dropdown')),
      nozzleField:x(nozzle?.querySelector('[data-toolhead-nozzle]')),
      filamentFormPadding:formPadding(filament),
      nozzleFormPadding:formPadding(nozzle),
      materialCell:x(row?.querySelector('.material-tool-configuration')),
      nozzleCell:x(row?.querySelector('.material-tool-nozzle')),
    };
  },{filamentMode,nozzleMode});
  if (headingRequired) assert.ok(measured.headers.length>=3,
    name+' must show the shared Toolhead, Live information and Filament configuration headings');
  if (nozzleMode) assert.equal(measured.headers.length,4,
    name+' must show Nozzle as the fourth heading');
  if (measured.headers.length>=3) {
    assert.ok(measured.materialField!==null
      &&Math.abs(measured.materialField-measured.headers[2])<=3,
      name+' filament-type field must start at the Filament configuration column edge: '+JSON.stringify(measured));
    // Colour is the second field of a single Filament configuration column,
    // so its x-coordinate is one field width + shared gap after the first.
    assert.ok(measured.colourField!==null
      &&measured.colourField>measured.materialField
      &&measured.colourField-measured.materialField<=180,
      name+' colour field must stay within the Filament configuration group: '+JSON.stringify(measured));
    if(nozzleMode) {
      assert.ok(measured.colourField<measured.headers[3],
        name+' colour must not overlap the Nozzle column: '+JSON.stringify(measured));
      assert.ok(measured.nozzleField!==null&&Math.abs(measured.nozzleField-measured.headers[3])<=3,
        name+' nozzle selector must begin under Nozzle heading: '+JSON.stringify(measured));
    }
  }
  assert.equal(measured.filamentFormPadding,'0px',name+' filament editor needs no dialogue-form indentation');
  if(nozzleMode) assert.equal(measured.nozzleFormPadding,'0px',
    name+' nozzle editor needs no dialogue-form indentation');
  return measured;
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

    // Exercise the real printer-details UI and controller name API against the
    // isolated simulated printer. No physical printer receives this request.
    console.log('Chromium: interactive Preact printer details controller-name editor');
    await page.locator('[data-printer-card="'+printerId+'"] [data-open]').click();
    await page.locator('[data-preact-toolhead-editor="u1-filament"]').first().waitFor({state:'visible',timeout:15000});
    assert.equal(await page.locator('[data-preact-toolhead-editor="u1-filament"]').count(),4,
      'every U1 toolhead has a Preact-controlled filament configuration form');
    assert.equal(await page.locator('[data-preact-toolhead-editor="u1-filament"] [data-toolhead-save]').count(),4,
      'each U1 tool has its own save button and pending state');
    await checkToolheadFieldAlignment(page,'Snapmaker U1',{
      filamentMode:'u1-filament',nozzleMode:null,headingRequired:true
    });
    await page.locator('#printerDialog[open] [data-detail-tab="management"]').click();
    const renameField=page.locator('#printerDialog [data-preact-printer-name-editor] [data-printer-name]');
    await renameField.waitFor({state:'visible',timeout:15000});
    assert.equal(await renameField.inputValue(),'SSE simulator U1');
    assert.ok(await page.locator('#printerDialog [data-rename]').isDisabled(),
      'unchanged name is not submitted');
    await renameField.fill('Unsaved U1 name');
    await page.evaluate(()=>{
      const state=window.__PFC_PRINTER_DETAIL_STATE__;
      window.dispatchEvent(new CustomEvent('pfc:printer-detail-state',{
        detail:{...state,health:'Synthetic ongoing telemetry refresh'}
      }));
    });
    assert.equal(await renameField.inputValue(),'Unsaved U1 name',
      'telemetry publication must preserve an unsaved controller name');
    await page.locator('#printerDialog [data-printer-name-reset]').click();
    assert.equal(await renameField.inputValue(),'SSE simulator U1','reset restores the controller name');

    await page.route('**/api/printers/*/name',async (route)=>{
      await route.fulfill({status:409,contentType:'application/json',
        body:JSON.stringify({error:'Simulated name conflict'})});
    });
    await renameField.fill('Conflict U1');
    await page.locator('#printerDialog [data-rename]').click();
    await page.locator('#printerDialog [data-printer-name-error]').getByText('Simulated name conflict').waitFor();
    assert.equal(await renameField.inputValue(),'Conflict U1',
      'failed rename retains the unsaved name for correction');
    await page.unroute('**/api/printers/*/name');

    let renameRequests=0;
    page.on('request',(request)=>{
      if(request.method()==='PUT'&&request.url().endsWith('/api/printers/'+encodeURIComponent(printerId)+'/name'))
        renameRequests++;
    });
    await renameField.fill('Preact renamed U1');
    await page.locator('#printerDialog [data-rename]').click();
    await page.waitForFunction(()=>
      document.querySelector('#printerDialog [data-detail-name]')?.textContent==='Preact renamed U1'
      && document.querySelector('#printerDialog [data-rename-status]')?.textContent?.includes('Controller name changed')
    ,null,{timeout:15000});
    assert.equal(await renameField.inputValue(),'Preact renamed U1');
    assert.equal(renameRequests,1,'one save must issue exactly one controller rename request');
    await page.locator('#printerDialog [data-detail-close]').click();
    await page.locator('#printerDialog').waitFor({state:'hidden'});

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
    console.log('Chromium: Preact toolhead controller designations via simulated AD5M Pro');
    const ad5m=await jsonPost('/api/emulator/printers',{
      profileId:'flashforge-ad5m-pro',name:'Controller metadata test AD5M',
      ports:{httpPort:0,tcpPort:0,cameraPort:0}
    });
    assert.ok(ad5m.printer?.controllerSettings,'AD5M emulator registration details');
    const ad5mRegistered=await jsonPost('/api/printers',ad5m.printer.controllerSettings);
    const ad5mId=ad5mRegistered.printer?.id;
    assert.ok(ad5mId,'AD5M emulator is registered with the isolated controller');
    await page.waitForFunction((id)=>
      Boolean(document.querySelector('[data-printer-card="'+id+'"] [data-open]'))
    ,ad5mId,{timeout:30000});
    await page.locator('[data-printer-card="'+ad5mId+'"] [data-open]').click();
    const materialEditor=page.locator('[data-preact-toolhead-editor="controller-filament"]');
    const nozzleEditor=page.locator('[data-preact-toolhead-editor="controller-nozzle"]');
    await materialEditor.waitFor({state:'visible',timeout:15000});
    await nozzleEditor.waitFor({state:'visible'});
    await checkToolheadFieldAlignment(page,'Flashforge AD5M Pro',{
      filamentMode:'controller-filament',nozzleMode:'controller-nozzle'
    });
    // AD5M/AD5M Pro have a single T0 row, not a card with the designation
    // panels positioned underneath. Both forms must stay in that same row,
    // sharing column alignment with the U1-style toolhead tables.
    const ad5mLayout=await page.evaluate(() => {
      const panel=document.querySelector('#printerDialog #detailTabToolheads .material-panel');
      const head=panel?.querySelector('.material-table-head');
      const row=panel?.querySelector('.material-tool-row[data-material-tool="0"]');
      const material=row?.querySelector('.material-tool-configuration [data-preact-toolhead-control="controller-filament"]');
      const nozzle=row?.querySelector('.material-tool-nozzle [data-preact-toolhead-control="controller-nozzle"]');
      const rect=(element)=>element?.getBoundingClientRect().toJSON();
      return {
        panelWide:panel?.classList.contains('material-panel-wide'),
        table:panel?.querySelector('.material-grid')?.classList.contains('multi-tool-table'),
        headingLabels:[...(head?.children||[])].map((node)=>node.textContent.trim()),
        rowCount:panel?.querySelectorAll('.material-tool-row').length,
        cellCount:row?.children.length,
        material:!!material,nozzle:!!nozzle,
        materialBorder:material?getComputedStyle(material).borderTopWidth:null,
        materialMargin:material?getComputedStyle(material).marginTop:null,
        materialPadding:material?getComputedStyle(material).paddingTop:null,
        identity:rect(row?.querySelector('.material-tool-identity')),
        information:rect(row?.querySelector('.material-tool-information')),
        configuration:rect(row?.querySelector('.material-tool-configuration')),
        nozzleCell:rect(row?.querySelector('.material-tool-nozzle'))
      };
    });
    assert.equal(ad5mLayout.panelWide,true,'AD5M uses full-width toolhead panel');
    assert.equal(ad5mLayout.table,true,'AD5M uses shared U1-style toolhead table');
    assert.deepEqual(ad5mLayout.headingLabels,
      ['Toolhead','Live information','Filament configuration','Nozzle'],
      'AD5M table uses same four headings as multi-toolhead variants');
    assert.equal(ad5mLayout.rowCount,1,'AD5M displays exactly one T0 row');
    assert.equal(ad5mLayout.cellCount,4,'T0 row contains identity, live info, filament and nozzle cells');
    assert.ok(ad5mLayout.material&&ad5mLayout.nozzle,
      'filament and nozzle Preact editors are inside T0 rather than separate below the table');
    assert.equal(ad5mLayout.materialBorder,'0px',
      'the in-row filament designation must not draw a stray horizontal divider');
    assert.equal(ad5mLayout.materialMargin,'0px',
      'in-row filament designation must align with adjacent toolhead fields');
    assert.equal(ad5mLayout.materialPadding,'0px',
      'in-row filament designation does not need legacy section spacing');
    const positions=[ad5mLayout.identity,ad5mLayout.information,
      ad5mLayout.configuration,ad5mLayout.nozzleCell];
    assert.ok(positions.every((box)=>box&&Math.abs(box.top-positions[0].top)<3),
      'toolhead number, live material, filament controls and nozzle share one visual row');
    assert.ok(positions.every((box,i)=>i===0||box.left>=positions[i-1].right-3),
      'toolhead controls must not overlap adjacent columns');

    const materialSelect=materialEditor.locator('[data-toolhead-material]');
    await materialSelect.selectOption('PETG');
    await materialEditor.locator('.color-family-dropdown summary').click();
    await materialEditor.locator('[data-toolhead-color-option="blue"]').click();
    assert.ok(await materialEditor.locator('[data-toolhead-save]').isEnabled(),
      'changed filament type and colour can be submitted');
    await page.evaluate(()=>{
      const detail=window.__PFC_PRINTER_DETAIL_STATE__;
      window.dispatchEvent(new CustomEvent('pfc:printer-detail-state',{
        detail:{...detail,health:'Updated while editing',toolheadControls:detail.toolheadControls}
      }));
    });
    assert.equal(await materialSelect.inputValue(),'PETG',
      'toolhead filament selection survives telemetry publications');
    assert.ok((await materialEditor.locator('.color-family-selected').innerText()).includes('Blue'),
      'toolhead colour family is preserved as well');
    await page.route('**/api/printers/*/material-designation',(route)=>route.fulfill({
      status:409,contentType:'application/json',
      body:JSON.stringify({error:'Synthetic designation conflict'})
    }));
    await materialEditor.locator('[data-toolhead-save]').click();
    await materialEditor.locator('[data-toolhead-error]').getByText('Synthetic designation conflict').waitFor();
    assert.equal(await materialSelect.inputValue(),'PETG','failed submit keeps pending values');
    await page.unroute('**/api/printers/*/material-designation');
    await materialEditor.locator('[data-toolhead-save]').click();
    await materialEditor.getByText('Filament designation saved.').waitFor({timeout:12000});
    assert.ok(await materialEditor.locator('[data-toolhead-save]').isDisabled(),
      'success resets the dirty flag');
    const nozzleSelect=nozzleEditor.locator('[data-toolhead-nozzle]');
    await nozzleSelect.selectOption('0.6');
    await nozzleEditor.locator('[data-toolhead-save]').click();
    await nozzleEditor.getByText('Nozzle designation saved.').waitFor({timeout:12000});
    assert.equal(await nozzleSelect.inputValue(),'0.6');
    assert.ok(await nozzleEditor.locator('[data-toolhead-save]').isDisabled(),
      'success resets nozzle selection dirty state');
    await page.locator('#printerDialog [data-detail-close]').click();
    console.log('Chromium: simulated AD5M Preact toolhead designations PASS');

    // Regression for CORE One+ compact fields. Legacy Prusa wrappers are
    // two-column grids: the Preact form must span both tracks so material and
    // colour controls use the same 160px standard as the other printers.
    console.log('Chromium: Prusa CORE One+ toolhead filament field widths');
    const prusa=await jsonPost('/api/emulator/printers',{
      profileId:'prusa-core-one-plus',name:'Width regression CORE One+',
      ports:{httpPort:0}
    });
    assert.ok(prusa.printer?.controllerSettings,'Prusa simulator registration details');
    const prusaRegistered=await jsonPost('/api/printers',prusa.printer.controllerSettings);
    const prusaId=prusaRegistered.printer?.id;
    assert.ok(prusaId,'Prusa emulator registered with isolated controller');
    await page.waitForFunction((id)=>Boolean(
      document.querySelector('[data-printer-card="'+id+'"] [data-open]')
    ),prusaId,{timeout:30000});
    await page.locator('[data-printer-card="'+prusaId+'"] [data-open]').click();
    const prusaForm=page.locator('#printerDialog [data-preact-toolhead-editor="prusa-filament"]').first();
    await prusaForm.waitFor({state:'visible',timeout:15000});
    await checkToolheadFieldAlignment(page,'Prusa CORE One+',{
      filamentMode:'prusa-filament',headingRequired:false
    });
    const widths=await prusaForm.evaluate((form)=>{
      const bounds=(selector)=>form.querySelector(selector)?.getBoundingClientRect().width||0;
      return {
        type:bounds('[data-toolhead-material]'),
        color:bounds('.color-family-dropdown'),
        form:form.getBoundingClientRect().width,
        wrapper:form.parentElement?.getBoundingClientRect().width||0
      };
    });
    assert.ok(widths.form>=widths.type*2,
      'Prusa Preact editor spans full legacy wrapper width');
    for(const key of ['type','color']) {
      assert.ok(Math.abs(widths[key]-160)<=2,
        'CORE One+ '+key+' field width matches standard 160px control, got '+JSON.stringify(widths));
    }
    await page.locator('#printerDialog [data-detail-close]').click();
    console.log('Chromium: CORE One+ filament dropdown width PASS');
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
