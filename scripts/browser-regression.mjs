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
    return window.__PFC_FRONTEND_BOOTED__ === true && s && s.bundleLoaded === true
      && s.preactCount === 13 && s.fallbackCount === 0;
  },null,{timeout:15000});
  // Authenticated bootstrap loads auxiliary modules and route data asynchronously.
  // Synthetic Library fixtures must not race the initial server response.
  if(await page.evaluate(()=>document.body.dataset.route==='/library')){
    await page.waitForFunction(()=>
      Boolean(window.__PFC_LIBRARY_UI_STATE__)
      && !(document.querySelector('#libraryStatus')?.textContent||'').includes('Loading')
    ,null,{timeout:15000});
  }
}

async function reportsLoaded(page,where) {
  await page.waitForFunction(() =>
    document.querySelectorAll('#reportingKpis .reporting-kpi').length >= 4
    && document.querySelector('#reportingStatus')?.textContent?.includes('Reporting period:')
  ,null,{timeout:20000});
  const kpis = await page.locator('#reportingKpis .reporting-kpi').allTextContents();
  assert.ok(kpis.some((s)=>s.includes('Total print jobs')),where+' must show report results');
  assert.ok(await page.locator('#reportingRange option').count()>0,where+' range choices');
  assert.ok(await page.locator('#reportingPrinter option').count()>0,where+' printer choices');
}

/**
 * Phase-1 visual contract: computed design tokens, semantic filter states,
 * keyboard focus, reduced motion and responsive cards in BOTH themes.
 * Optional full-page captures are written only if PFC_VISUAL_CAPTURE_DIR is set;
 * the test never compares screenshots against brittle machine-specific pixels.
 */
async function designSystemSmoke(browser,url) {
  console.log('Chromium: SaaS design-system light/dark + desktop/mobile visual contract');
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',(event)=>errors.push(event.message));
  await context.route('**/api/events',(route)=>route.fulfill({
    status:200,headers:{'content-type':'text/event-stream'},
    body:': design-system fixture\\n\\n'
  }));
  const captureDir=process.env.PFC_VISUAL_CAPTURE_DIR
    ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR) : null;
  if(captureDir)await fs.mkdir(captureDir,{recursive:true});
  try {
    await page.goto(url+'/',{waitUntil:'load'});
    await preactReady(page);
    assert.equal(await page.locator('link[href="/design-system.css"]').count(),1,
      'the design-system stylesheet must load after existing styles');
    await page.waitForFunction(()=>document.querySelectorAll('#summary .ui-stat-card').length===4);
    const css=await page.evaluate(()=>({
      tokens:getComputedStyle(document.documentElement).getPropertyValue('--ds-surface').trim(),
      source:[...document.styleSheets].some(s=>s.href?.endsWith('/design-system.css'))
    }));
    assert.ok(css.tokens,'tokens resolve from the loaded design system');
    assert.equal(css.source,true,'design system must be a real stylesheet, not a route fallback');
    // The Preact fleet subscription uses useEffect; wait for it to attach
    // before firing the isolated synthetic telemetry fixture.
    await page.waitForTimeout(250);
    // Mixed-length names and model descriptions recreate the user's screenshot.
    // Synthetic presentation only; no hardware or printer APIs are modified.
    await page.evaluate(()=>{
      const printers=[
        ['design-system-example','A5M-Pro1','192.168.4.114 · Adventurer 5M Pro'],
        ['long-model','A5M-Pro2','192.168.4.116 · Adventurer 5M Pro'],
        ['short-model','U1-1','192.168.4.187 · Snapmaker U1'],
        ['short-model-2','FF1-Virt','127.0.0.1 · Adventurer 5M Pro'],
        ['short-model-3','A1-Mini','127.0.0.1 · A1 Mini']
      ].map(([id,name,hostText])=>({
        id,name,hostText,visible:true,
        state:id==='design-system-example' ? 'OFFLINE' : 'Idle',
        stateClass:id==='design-system-example' ? 'offline' : 'idle',
        maintenance:{state:id==='design-system-example' ? 'due' : 'none',actionText:'Maintenance'},
        progress:25,progressText:'25%',jobName:'demo.gcode',nozzleLabel:'Nozzle',
        nozzle:'210°C',bed:'60°C',layer:'10',remaining:'01:25',
        lastSeen:'just now',latency:'2 ms',image:{label:'Synthetic'}
      }));
      window.dispatchEvent(new CustomEvent('pfc:dashboard-fleet-state',{detail:{printers}}));
      // The no-printers backend response hides the fleet container; reveal
      // our in-memory Preact fixture to measure the real layout geometry.
      document.querySelector('#fleetViewport')?.classList.remove('hidden');
      document.querySelector('#fleet')?.classList.remove('hidden');
      document.querySelector('#empty')?.classList.add('hidden');
    });
    // The original empty-farm controller can keep #fleet hidden while a
    // synthetic Preact state is mounted; verify the component and computed
    // token styling without pretending the controller registered hardware.
    await page.locator('[data-printer-card="design-system-example"] .ui-metric').first()
      .waitFor({state:'attached',timeout:12000});
    // Measure rendered Chromium geometry rather than inspecting CSS source.
    // Cards sharing a grid row must always share one image baseline.
    for(const width of [1365,1800]){
      await page.setViewportSize({width,height:980});
      const groups=await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('#fleet:not(.table-view) > .card.ui-printer-surface')]
          .filter(card=>getComputedStyle(card).display!=='none');
        const rows=new Map();
        for(const card of cards){
          const cardBox=card.getBoundingClientRect();
          const imageBox=card.querySelector('[data-printer-image-slot]').getBoundingClientRect();
          const head=card.querySelector('.card-head');
          const headBox=head.getBoundingClientRect();
          const key=Math.round(cardBox.top);
          if(!rows.has(key))rows.set(key,[]);
          const body=card.querySelector('.card-body');
          const bodyRect=body.getBoundingClientRect();
          const image=card.querySelector('.printer-model-image');
          const imageStyle=image&&getComputedStyle(image);
          const invisibleStrips=[...card.querySelectorAll('.bed-level-strip,.license-strip,.preheat-strip,.bed-clearance-strip')]
            .every(strip=>getComputedStyle(strip).display==='none');
          rows.get(key).push({
            name:card.querySelector('[data-name]')?.textContent,
            imageTop:imageBox.top,imageBottom:imageBox.bottom,
            bodyTop:bodyRect.top,
            hiddenStrips:invisibleStrips,
            photoFit:imageStyle?.objectFit,
            photoBottomPadding:imageStyle?Number.parseFloat(imageStyle.paddingBottom):null,
            imageHeight:imageBox.height,
            cardMarginBottom:Number.parseFloat(getComputedStyle(card).marginBottom),
            headBottom:headBox.bottom,headScroll:head.scrollHeight,headHeight:head.clientHeight
          });
        }
        return [...rows.values()];
      });
      assert.equal(groups.flat().length,5,'all five synthetic printers must be rendered');
      assert.ok(groups.some(group=>group.length>=3),'desktop layout should show 3+ cards per row');
      for(const group of groups){
        const y=group.map(item=>item.imageTop);
        assert.ok(Math.max(...y)-Math.min(...y)<=1.5,
          'images must align for wrapped and short names at '+width+'px: '+JSON.stringify(group));
        for(const card of group) {
          assert.ok(card.headScroll<=card.headHeight+1,
            'long printer headings must grow rather than clip: '+JSON.stringify(card));
          assert.ok(card.headBottom<=card.imageTop+1.5,
            'card heading must not overlap its image');
          if(card.hiddenStrips) {
            assert.ok(Math.abs(card.bodyTop-card.imageBottom)<=2.5,
              'hidden activity strips must not leave a blank band below printer images: '+JSON.stringify(card));
          }
          assert.ok(card.cardMarginBottom>=10,
            'printer cards still need their own outer row spacing');
          if(card.photoFit) {
            assert.equal(card.photoFit,'contain',
              'printer photos should stay contained rather than cropped');
            assert.ok(card.photoBottomPadding>=18,
              'printer images need room above lower slot border: '+JSON.stringify(card));
            assert.ok(card.imageHeight>=150,
              'printer model image slot must retain a useful visible height');
          }
        }
      }
    }
    await page.setViewportSize({width:1365,height:900});
    // Regression: table status pills must show the entire OFFLINE label
    // alongside the maintenance icon, including the coloured dot.
    await page.evaluate(()=>{
      document.querySelector('#fleetViewport')?.classList.add('table-view');
      document.querySelector('#fleet')?.classList.add('table-view');
    });
    for(const theme of ['dark','light']){
      await page.evaluate((name)=>{
        if(document.documentElement.dataset.theme!==name)
          document.querySelector('#themeToggle')?.click();
      },theme);
      const pill=await page.evaluate(()=>{
        const row=document.querySelector('[data-printer-card="design-system-example"]');
        const badge=row.querySelector('[data-printer-state]');
        const actions=row.querySelector('.card-head-actions');
        const maintenance=row.querySelector('[data-maintenance-status-icon]');
        const r=badge.getBoundingClientRect(), a=actions.getBoundingClientRect();
        const m=maintenance.getBoundingClientRect();
        const pseudo=getComputedStyle(badge,'::before');
        return {
          label:badge.textContent.trim(),
          textWidth:badge.scrollWidth,badgeWidth:badge.clientWidth,
          badgeRight:r.right,actionsRight:a.right,
          badgeLeft:r.left,maintenanceRight:m.right,
          dotWidth:pseudo.width,
          overflow:getComputedStyle(badge).textOverflow
        };
      });
      assert.equal(pill.label,'OFFLINE');
      assert.ok(pill.textWidth<=pill.badgeWidth+1,
        theme+' OFFLINE text should fit inside the coloured badge: '+JSON.stringify(pill));
      assert.ok(pill.badgeRight<=pill.actionsRight+1,
        theme+' OFFLINE badge should fit in its table column: '+JSON.stringify(pill));
      assert.ok(Number.parseFloat(pill.dotWidth)>=6,
        theme+' OFFLINE status dot should remain visible: '+JSON.stringify(pill));
      assert.ok(pill.badgeLeft>=pill.maintenanceRight,
        theme+' OFFLINE status should not overlap maintenance icon: '+JSON.stringify(pill));
    }
    await page.evaluate(()=>{
      document.querySelector('#fleetViewport')?.classList.remove('table-view');
      document.querySelector('#fleet')?.classList.remove('table-view');
    });
    for(const theme of ['dark','light']){
      // Use the real controller theme action: app.js also updates the inline
      // colorScheme style and accessible toggle, not only data-theme.
      await page.evaluate((name)=>{
        if(document.documentElement.dataset.theme!==name)
          document.querySelector('#themeToggle')?.click();
      },theme);
      const result=await page.evaluate(()=>{
        const root=document.documentElement;
        const cards=[...document.querySelectorAll('#summary .ui-stat-card')];
        const printer=document.querySelector('[data-printer-card="design-system-example"]');
        const metric=printer?.querySelector('.ui-metric');
        const sheet=getComputedStyle(root);
        return {
          theme:root.dataset.theme,
          scheme:sheet.colorScheme,
          surface:sheet.getPropertyValue('--ds-surface').trim(),
          text:sheet.getPropertyValue('--ds-text').trim(),
          cards:cards.map(x=>({
            tone:x.dataset.tone,
            label:x.querySelector('.summary-card-label')?.textContent?.trim(),
            count:x.querySelector('b')?.textContent?.trim(),
            background:getComputedStyle(x).backgroundImage,
            bounds:x.getBoundingClientRect().toJSON()
          })),
          printer:printer?.getBoundingClientRect().toJSON(),
          metricBackground:metric&&getComputedStyle(metric).backgroundColor,
          metricText:metric&&getComputedStyle(metric.querySelector('b')).color
        };
      });
      assert.equal(result.theme,theme,'controller has switched to '+theme+' theme');
      assert.equal(result.scheme,theme,'browser computes '+theme+' colour scheme');
      assert.ok(result.surface&&result.text,'theme tokens resolve');
      assert.deepEqual(result.cards.map(x=>x.tone),['neutral','success','working','warning']);
      assert.ok(result.cards.every(x=>x.label&&x.count),
        'summary status labels remain above counts');
      assert.ok(result.printer,'synthetic Preact printer card remains mounted on the dashboard');
      assert.ok(result.metricBackground&&result.metricText,
        'printer metrics have readable themed foreground/background');
      if(captureDir)await page.screenshot({
        path:path.join(captureDir,`dashboard-${theme}-desktop.png`),fullPage:true,
        animations:'disabled'
      });
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{
      if(document.documentElement.dataset.theme!=='light')
        document.querySelector('#themeToggle')?.click();
    });
    const mobile=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('#summary .ui-stat-card')];
      return cards.map(x=>x.getBoundingClientRect().toJSON());
    });
    assert.equal(mobile.length,4,'mobile summary retains all four actionable filters');
    assert.ok(mobile.every(b=>b.left>=0&&b.right<=390.5),
      'summary cards do not overflow phone viewport: '+JSON.stringify(mobile));
    if(captureDir)await page.screenshot({
      path:path.join(captureDir,'dashboard-light-mobile.png'),fullPage:true,
      animations:'disabled'
    });
    await page.emulateMedia({reducedMotion:'reduce'});
    const motion=await page.evaluate(()=>{
      const target=document.querySelector('#summary .ui-stat-card');
      const styles=getComputedStyle(target);
      return {animation:styles.animationDuration,transition:styles.transitionDuration};
    });
    assert.ok(motion.transition.split(',').every(s=>Number.parseFloat(s)===0),
      'reduced-motion mode disables decorative card transitions');
    assert.deepEqual(errors,[],'design-system browser interactions must not throw');
  }finally{await context.close();}
}


async function dashboardPhase3Smoke(browser,url) {
  console.log('Chromium: Phase 3 dashboard hierarchy, filters, card/table and mobile layout');
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',(error)=>errors.push(error.message));
  await context.route('**/api/events',(route)=>route.fulfill({
    status:200,headers:{'content-type':'text/event-stream'},
    body:': dashboard visual fixture\\n\\n'
  }));
  const captureDir=process.env.PFC_VISUAL_CAPTURE_DIR
    ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR) : null;
  if(captureDir)await fs.mkdir(captureDir,{recursive:true});
  try{
    await page.goto(url+'/',{waitUntil:'load'});
    await preactReady(page);
    await page.locator('.dashboard-hero-copy h2').getByText('Farm overview').waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('#summary .dashboard-stat-detail').length===4);
    assert.equal(await page.locator('#dashboardFleetHeadingRoot h2').innerText(),'Printers');
    const initial=await page.evaluate(()=>({
      stats:[...document.querySelectorAll('#summary [data-dashboard-filter]')].map(n=>n.dataset.dashboardFilter),
      hero:document.querySelector('.dashboard-hero').getBoundingClientRect().toJSON(),
      cards:[...document.querySelectorAll('#summary [data-dashboard-filter]')].map(n=>n.getBoundingClientRect().toJSON()),
      summaries:[...document.querySelectorAll('#summary .dashboard-stat-detail')].map(n=>n.textContent)
    }));
    assert.deepEqual(initial.stats,['all','online','printing','attention']);
    assert.equal(initial.summaries.length,4,'every operational metric has useful supporting context');
    assert.ok(initial.hero.width>600,'hero fills the available workspace');
    assert.ok(Math.max(...initial.cards.map(n=>n.top))-Math.min(...initial.cards.map(n=>n.top))<=1,
      'all four summary cards align on desktop');
    await page.evaluate(()=>{
      const state={counts:{all:12,online:10,printing:1,attention:2},
        activeFilter:'all',groups:[],groupId:'',viewMode:'cards'};
      window.__PFC_DASHBOARD_STATE__=state;
      window.dispatchEvent(new CustomEvent('pfc:dashboard-state',{detail:state}));
    });
    await page.waitForFunction(()=>document.querySelector('#summary [data-dashboard-filter="all"] b')?.textContent==='12'
      &&document.querySelector('#dashboardFleetHeadingRoot [data-dashboard-fleet-summary]')?.textContent?.includes('12'));
    // Dashboard summary cards match Analytics outline ring styling, using
    // measured group ratios rather than arbitrary fill amounts or fake trends.
    const measurements=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('#summary .dashboard-summary-kpi')];
      return cards.map(card=>({
        key:card.dataset.dashboardFilter,
        count:card.querySelector('.dashboard-stat-body > b')?.textContent,
        svg:card.querySelector('.dashboard-stat-icon svg'),
        gauge:card.querySelector('.dashboard-stat-gauge'),
        meter:card.querySelector('.dashboard-stat-meter'),
        accent:card.querySelector('.dashboard-stat-accent')
      })).map(row=>({
        key:row.key,count:row.count,
        hasSvg:!!row.svg,
        stroke:row.svg?.getAttribute('stroke'),
        size:row.gauge?.getBoundingClientRect().width,
        gaugeColor:row.gauge && getComputedStyle(row.gauge).backgroundImage,
        gaugeBackground:row.gauge && getComputedStyle(row.gauge).backgroundColor,
        meter:row.meter?.getAttribute('aria-valuenow') ?? null,
        hasAccent:!!row.accent
      }));
    });
    assert.deepEqual(measurements.map(row=>row.key),['all','online','printing','attention']);
    assert.ok(measurements.every(row=>row.hasSvg&&row.stroke==='currentColor'&&row.size>=50),
      'four Analytics-style outlined circular icons must be visible');
    assert.equal(measurements[0].meter,null,'total printers is a count, not fake 100% progress');
    assert.equal(measurements[1].meter,'83.3');
    assert.equal(measurements[2].meter,'8.3');
    assert.equal(measurements[3].meter,'16.7');
    assert.ok(measurements[0].gaugeBackground &&
      measurements.slice(1).every(row=>row.gaugeColor?.includes('conic-gradient')),
      'decorative total-printer ring and measured status rings must both render');
    // A zero-attention state is a success (green check), not a warning.
    await page.evaluate(()=>{
      const state={counts:{all:12,online:10,printing:1,attention:0},
        activeFilter:'all',groups:[],groupId:'',viewMode:'cards'};
      window.__PFC_DASHBOARD_STATE__=state;
      window.dispatchEvent(new CustomEvent('pfc:dashboard-state',{detail:state}));
    });
    await page.waitForFunction(()=>document.querySelector('#summary [data-dashboard-filter="attention"]')?.dataset.tone==='success');
    assert.equal(await page.locator('#summary [data-dashboard-filter="attention"] .dashboard-stat-meter').getAttribute('aria-valuenow'),'0');
    // Empty fleet: show neutral decorative circles and no invented percentages.
    await page.evaluate(()=>{
      const state={counts:{all:0,online:0,printing:0,attention:0},
        activeFilter:'all',groups:[],groupId:'',viewMode:'cards'};
      window.__PFC_DASHBOARD_STATE__=state;
      window.dispatchEvent(new CustomEvent('pfc:dashboard-state',{detail:state}));
    });
    await page.waitForFunction(()=>document.querySelectorAll('#summary .dashboard-stat-gauge-neutral').length===4);
    assert.equal(await page.locator('#summary .dashboard-stat-meter').count(),0);
    // Restore the real-count fixture for click and theme regression checks.
    await page.evaluate(()=>{
      const state={counts:{all:12,online:10,printing:1,attention:2},
        activeFilter:'all',groups:[],groupId:'',viewMode:'cards'};
      window.__PFC_DASHBOARD_STATE__=state;
      window.dispatchEvent(new CustomEvent('pfc:dashboard-state',{detail:state}));
    });
    await page.waitForFunction(()=>document.querySelector('#summary [data-dashboard-filter="attention"]')?.dataset.tone==='warning');
    // The dashboard summary text always remains beside its ring, including
    // narrow two-column layouts. This checks real rendered positions rather
    // than assuming a flex/grid declaration alone prevents stacking.
    for(const width of [1365,900,620,390,320]){
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>{
        const rect=(node)=>node.getBoundingClientRect();
        return [...document.querySelectorAll('#summary .dashboard-summary-kpi')].map(card=>{
          const icon=rect(card.querySelector('.dashboard-stat-gauge'));
          const text=rect(card.querySelector('.dashboard-stat-body'));
          const outer=rect(card);
          return {
            key:card.dataset.dashboardFilter,
            icon:{left:icon.left,right:icon.right,top:icon.top,bottom:icon.bottom},
            text:{left:text.left,right:text.right,top:text.top,bottom:text.bottom},
            card:{left:outer.left,right:outer.right,top:outer.top,bottom:outer.bottom},
            grid:getComputedStyle(card).gridTemplateColumns,
            number:card.querySelector('.dashboard-stat-body > b')?.textContent
          };
        });
      });
      assert.equal(layout.length,4,'all four dashboard filters render at '+width+'px');
      for(const row of layout){
        assert.ok(row.text.left>=row.icon.right+3,
          'label, count and bar must stay to the RIGHT of icon at '+width+'px: '+JSON.stringify(row));
        assert.ok(row.icon.top<row.text.bottom && row.icon.bottom>row.text.top,
          'summary text must remain beside (not below) icon at '+width+'px: '+JSON.stringify(row));
        assert.ok(row.text.right<=row.card.right-6,
          'summary text must fit within its card at '+width+'px: '+JSON.stringify(row));
        assert.ok(row.card.left>=-1 && row.card.right<=width+1,
          'summary cards must not overflow '+width+'px viewport: '+JSON.stringify(row));
        assert.ok(row.grid.includes('px'),'status card must use explicit column geometry');
      }
    }
    await page.setViewportSize({width:1365,height:900});
    await page.evaluate(()=>{
      window.__PFC_PHASE3_ACTIONS__=[];
      window.addEventListener('pfc:dashboard-action',(event)=>{
        window.__PFC_PHASE3_ACTIONS__.push(event.detail);
      });
    });
    await page.locator('#summary [data-dashboard-filter="attention"]').click();
    assert.ok((await page.evaluate(()=>window.__PFC_PHASE3_ACTIONS__))
      .some(event=>event.type==='filter'&&event.value==='attention'),
      'summary stat uses controller filter event');
    // A legacy bottom margin on the group filter previously raised both the
    // "Printer group" heading and its select above the two switch controls.
    // Exercise a visible printer group, not the default hidden filter.
    await page.evaluate(()=>{
      const state={...window.__PFC_DASHBOARD_STATE__,
        groups:[{id:'alignment-fixture',name:'Alignment fixture',printerCount:2}],
        groupId:''};
      window.__PFC_DASHBOARD_STATE__=state;
      window.dispatchEvent(new CustomEvent('pfc:dashboard-state',{detail:state}));
    });
    await page.locator('#dashboardGroupFilterBar:not(.hidden) #dashboardGroupFilter').waitFor();
    for (const width of [1920,1512,1365,1280]) {
      await page.setViewportSize({width,height:900});
      const controls=await page.evaluate(()=>{
        const rect=selector=>{
          const r=document.querySelector(selector).getBoundingClientRect();
          return {top:r.top,left:r.left,right:r.right,height:r.height};
        };
        return {
          labels:[
            rect('#dashboardGroupFilterBar label'),
            rect('.dashboard-hero .dashboard-view-control:not(.dashboard-operations-control) .dashboard-view-label'),
            rect('.dashboard-hero .dashboard-operations-control .dashboard-view-label')
          ],
          fields:[
            rect('#dashboardGroupFilter'),
            rect('#dashboardViewToggle'),
            rect('#farmOperationsToggle')
          ],
          groupMargin:getComputedStyle(document.querySelector('#dashboardGroupFilterBar')).marginBottom
        };
      });
      assert.equal(controls.groupMargin,'0px','legacy group-filter bottom spacing must not shift the Dashboard row');
      assert.ok(Math.max(...controls.labels.map(r=>r.top))-Math.min(...controls.labels.map(r=>r.top))<=2,
        'all three Dashboard field headings must align at '+width+'px: '+JSON.stringify(controls));
      assert.ok(Math.max(...controls.fields.map(r=>r.top))-Math.min(...controls.fields.map(r=>r.top))<=2,
        'group dropdown and both switches must align vertically at '+width+'px: '+JSON.stringify(controls));
    }
    await page.setViewportSize({width:1365,height:900});
    // Farm operations must live on the Dashboard, never in shell navigation.
    assert.equal(await page.locator('#batchModeBtn, #batchModeMenuBtn, #topbarOverflow').count(), 0);
    const operations=page.locator('#farmOperationsToggle');
    assert.equal(await operations.getAttribute('role'),'switch');
    assert.equal(await operations.getAttribute('aria-checked'),'false');
    await operations.click();
    await page.waitForFunction(()=>document.querySelector('#farmOperationsToggle')?.getAttribute('aria-checked')==='true'
      && !document.querySelector('#batchToolbar')?.classList.contains('hidden')
      && document.querySelector('#fleet')?.classList.contains('selection-mode'));
    await operations.click();
    await page.waitForFunction(()=>document.querySelector('#farmOperationsToggle')?.getAttribute('aria-checked')==='false'
      && document.querySelector('#batchToolbar')?.classList.contains('hidden')
      && !document.querySelector('#fleet')?.classList.contains('selection-mode'));
    const toggle=page.locator('#dashboardViewToggle');
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('#fleetViewport')?.classList.contains('table-view')
      &&document.querySelector('#dashboardFleetHeadingRoot [data-dashboard-current-view]')?.textContent==='Table view');
    await toggle.click();
    await page.waitForFunction(()=>!document.querySelector('#fleetViewport')?.classList.contains('table-view')
      &&document.querySelector('#dashboardFleetHeadingRoot [data-dashboard-current-view]')?.textContent==='Card view');
    for(const theme of ['dark','light']){
      await page.evaluate((name)=>{
        if(document.documentElement.dataset.theme!==name)
          document.querySelector('#themeToggle')?.click();
      },theme);
      const info=await page.evaluate(()=>{
        const card=document.querySelector('#summary .ui-stat-card');
        const head=document.querySelector('.dashboard-hero-copy h2');
        return {
          colorScheme:getComputedStyle(document.documentElement).colorScheme,
          statBackground:getComputedStyle(card).backgroundImage,
          statBorder:getComputedStyle(card).borderTopColor,
          headColor:getComputedStyle(head).color,
          detailColor:getComputedStyle(document.querySelector('#summary .dashboard-stat-detail')).color
        };
      });
      assert.equal(info.colorScheme,theme);
      assert.ok(info.statBackground!=='none'&&info.statBorder&&info.headColor&&info.detailColor);
      if(captureDir)await page.screenshot({path:path.join(captureDir,`dashboard-phase3-${theme}-desktop.png`),
        animations:'disabled',fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>({
      hero:document.querySelector('.dashboard-hero').getBoundingClientRect().toJSON(),
      cards:[...document.querySelectorAll('#summary [data-dashboard-filter]')].map(n=>n.getBoundingClientRect().toJSON()),
      view:document.querySelector('#dashboardViewToggle').getBoundingClientRect().toJSON(),
      ops:document.querySelector('#farmOperationsToggle').getBoundingClientRect().toJSON(),
      heading:document.querySelector('#dashboardFleetHeadingRoot').getBoundingClientRect().toJSON()
    }));
    assert.ok(mobile.cards.every(r=>r.left>=-1&&r.right<=391),
      'summary cards remain inside a 390px phone viewport');
    assert.ok(mobile.view.left>=0&&mobile.view.right<=391,'dashboard view switch stays visible on mobile');
    assert.ok(mobile.ops.left>=0&&mobile.ops.right<=391,'Farm operations switch stays visible on mobile');
    assert.ok(mobile.heading.left>=0&&mobile.heading.right<=391);
    if(captureDir)await page.screenshot({path:path.join(captureDir,'dashboard-phase3-light-mobile.png'),
      animations:'disabled',fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

// Validate actual compact Dashboard table geometry on MacBook CSS viewports.
// Use a standalone DOM fixture so telemetry/Preact cannot replace the row
// while viewport measurements run; all selectors are the production classes.
async function dashboardCompactTableSmoke(browser,url) {
  console.log('Chromium: Dashboard table fits laptop widths with visible Actions');
  const context=await browser.newContext({viewport:{width:1512,height:900}});
  const page=await context.newPage();
  try {
    await page.goto(url+'/',{waitUntil:'load'});
    await preactReady(page);
    await page.evaluate(()=>{
      const fixture=document.createElement('div');
      fixture.id='pfcDashboardTableWidthFixture';
      fixture.className='fleet-viewport table-view';
      const headers=['Printer','Status','Current job','Progress','Nozzle','Bed',
        'Layer','Remaining','Filament','Last seen','Actions'];
      fixture.innerHTML=`
        <div class="fleet-table-header">
          ${headers.map(title=>'<span>'+title+'</span>').join('')}
        </div>
        <section class="fleet table-view"><article class="card">
          <div class="card-head">
            <div class="card-title-area"><h3>Production printer 001</h3></div>
            <div class="card-head-actions">
              <button class="maintenance-status-icon-button" aria-label="Maintenance">⚙</button>
              <span class="badge">OFFLINE</span>
            </div>
          </div>
          <div class="printer-image-slot"><div class="dashboard-filament-overlay">ASA</div></div>
          <div class="card-body">
            <div class="job"><span class="job-name">Large production batch</span></div>
            <div class="progress"><span></span></div>
            <div class="metrics">
              <div class="metric"><span>Nozzle</span><b>250°C</b></div>
              <div class="metric"><span>Bed</span><b>95°C</b></div>
              <div class="metric"><span>Layer</span><b>120/250</b></div>
              <div class="metric"><span>Remaining</span><b>1h 42m</b></div>
            </div>
            <div class="health-line"><span>Seen 2s ago</span></div>
          </div>
          <div class="card-footer"><div class="card-footer-actions">
            <button type="button">Pause</button>
            <button type="button">Open printer</button>
          </div></div>
        </article></section>`;
      document.querySelector('#fleetViewport').before(fixture);
    });
    const scenarios=[
      {width:1920,cols:11},{width:1512,cols:11},{width:1440,cols:9},
      {width:1365,cols:9},{width:1280,cols:9},{width:1200,cols:8},
      {width:1100,cols:6},{width:900,cols:6},{width:760,cols:5},
      {width:560,cols:3},{width:390,cols:3},{width:320,cols:2}
    ];
    for (const {width,cols} of scenarios){
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>{
        const container=document.querySelector('#pfcDashboardTableWidthFixture');
        const header=container.querySelector('.fleet-table-header');
        const row=container.querySelector('.fleet.table-view .card');
        const actions=row.querySelector('.card-footer-actions');
        const rect=(el)=>el.getBoundingClientRect();
        const heads=[...header.children].filter(el=>getComputedStyle(el).display!=='none');
        const cells=[
          row.querySelector('.card-title-area'),row.querySelector('.card-head-actions'),
          row.querySelector('.job'),row.querySelector('.progress'),
          ...row.querySelectorAll('.metric'),
          row.querySelector('.printer-image-slot'),row.querySelector('.health-line'),
          actions
        ].filter(el=>getComputedStyle(el).display!=='none');
        return {container:rect(container).toJSON(),header:rect(header).toJSON(),
          row:rect(row).toJSON(),actions:rect(actions).toJSON(),
          clientWidth:container.clientWidth,scrollWidth:container.scrollWidth,
          visibleHeaders:heads.map(el=>el.textContent),
          headerColumns:heads.map(el=>rect(el).toJSON()),
          cellColumns:cells.map(el=>rect(el).toJSON()),
          buttonWidths:[...actions.querySelectorAll('button')].map(el=>({
            scroll:el.scrollWidth,client:el.clientWidth
          }))
        };
      });
      assert.equal(layout.visibleHeaders.length,cols,'expected column density at '+width+'px');
      assert.equal(layout.visibleHeaders.at(-1),'Actions','Actions must remain in final visible column');
      assert.ok(layout.scrollWidth<=layout.clientWidth+2,
        'Dashboard table must fit viewport at '+width+'px: '+JSON.stringify(layout));
      assert.ok(layout.actions.right<=layout.container.right+2 &&
        layout.actions.left>=layout.container.left-2,
        'Action buttons must stay onscreen at '+width+'px: '+JSON.stringify(layout));
      assert.equal(layout.headerColumns.length,layout.cellColumns.length,
        'heading and cell visibility must match at '+width+'px: '+JSON.stringify(layout));
      for(let col=0;col<layout.headerColumns.length;col++){
        const h=layout.headerColumns[col],cell=layout.cellColumns[col];
        // Progress is intentionally an inset bar (7px side margins) rather
        // than an edge-aligned text cell. Test that it fits its grid track.
        if(layout.visibleHeaders[col]==='Progress'){
          assert.ok(cell.left>=h.left-1&&cell.right<=h.right+1,
            'progress bar stays inside its grid track at '+width+'px: '+JSON.stringify(layout));
        }else{
          assert.ok(Math.abs(h.left-cell.left)<=2,
            'header/data cell column alignment '+col+' at '+width+'px: '+JSON.stringify(layout));
        }
      }
      assert.ok(layout.buttonWidths.every(({scroll,client})=>scroll<=client+2),
        'both action buttons must fit their labels at '+width+'px: '+JSON.stringify(layout));
    }
    console.log('Chromium: compact Dashboard table widths and Actions PASS');
  } finally { await context.close(); }
}

async function workspaceShellSmoke(browser,url) {
  console.log('Chromium: breadcrumb-free workspace, sidebar and mobile navigation');
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',(error)=>errors.push(error.message));
  const captureDir=process.env.PFC_VISUAL_CAPTURE_DIR
    ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR) : null;
  if(captureDir)await fs.mkdir(captureDir,{recursive:true});
  await context.route('**/api/events',(route)=>route.fulfill({
    status:200,headers:{'content-type':'text/event-stream'},
    body:': shell fixture\\n\\n'
  }));
  try {
    await page.goto(url+'/reports',{waitUntil:'load'});
    await preactReady(page);
    assert.equal(await page.locator('#workspaceTrailRoot, .workspace-trail-root, [aria-label="Breadcrumb"]').count(),0,
      'breadcrumb elements must be absent in all route states');
    const reportContext=await page.evaluate(()=>({
      title:document.querySelector('#topbarContextTitle')?.textContent,
      subtitle:document.querySelector('#topbarContextSubtitle')?.textContent,
      pageTitle:document.querySelector('#reportingDialog .ui-page-title')?.textContent
    }));
    assert.equal(reportContext.title,'Farm management');
    assert.equal(reportContext.subtitle,'Review farm performance, material costs and selling prices');
    assert.equal(reportContext.pageTitle,'Reports & finance');
    assert.equal(await page.locator('#reportsBtn').getAttribute('aria-current'),'page',
      'active navigation item has current-page semantics');
    assert.equal(await page.locator('.sidebar-section-label').count(),2,
      'operations and farm management are visually grouped');
    assert.ok(await page.locator('.sidebar-nav .sidebar-icon svg').count()>=9,
      'main sidebar uses consistently sized SVG navigation icons');
    assert.equal(await page.locator('#controllerSidebar').evaluate(n=>n.inert),false,
      'desktop navigation is always available');
    await page.locator('[data-dashboard-home]').click();
    await page.waitForFunction(()=>location.pathname==='/'&&document.body.dataset.route==='/' &&
      document.querySelector('#topbarContextTitle')?.textContent==='Dashboard');
    assert.equal(await page.locator('[data-dashboard-home]').getAttribute('aria-current'),'page',
      'sidebar routes users back to Dashboard');
    assert.equal(await page.locator('#topbarContextSubtitle').textContent(),
      'Monitor and manage your print farm');
    assert.equal(await page.locator('#workspaceTrailRoot, .workspace-trail-root').count(),0);
    await page.goBack();
    await page.waitForFunction(()=>location.pathname==='/reports'&&document.body.dataset.route==='/reports' &&
      document.querySelector('#topbarContextTitle')?.textContent==='Farm management');
    assert.equal(await page.locator('#reportsBtn').getAttribute('aria-current'),'page',
      'browser back preserves current sidebar state');
    await page.goForward();
    await page.waitForFunction(()=>location.pathname==='/'&&document.body.dataset.route==='/');
    assert.equal(await page.locator('#topbarContextTitle').textContent(),'Dashboard');
    assert.equal(await page.locator('#workspaceTrailRoot, .workspace-trail-root').count(),0);
    const compactTopbar=await page.evaluate(()=>({
      height:document.querySelector('.modern-topbar').getBoundingClientRect().height,
      mainTopGap:Number.parseFloat(getComputedStyle(document.querySelector('body > main')).paddingTop)
    }));
    assert.ok(compactTopbar.height>=60&&compactTopbar.height<=76,
      'topbar height must stay compact when breadcrumbs are removed');
    assert.equal(compactTopbar.mainTopGap,18,'every desktop route uses the same topbar-to-heading spacing');
    const desktop=await page.evaluate(()=>({
      sidebar:document.querySelector('#controllerSidebar').getBoundingClientRect().toJSON(),
      header:document.querySelector('.modern-topbar').getBoundingClientRect().toJSON(),
      main:document.querySelector('body > main').getBoundingClientRect().toJSON()
    }));
    assert.ok(desktop.sidebar.width>=215&&desktop.sidebar.width<=275,
      'desktop sidebar retains practical width');
    assert.ok(desktop.main.left>=desktop.sidebar.right-2,'workspace does not overlap fixed sidebar');
    assert.ok(desktop.header.left>=desktop.sidebar.right-2,'header aligns with workspace');
    if(captureDir){
      await page.screenshot({path:path.join(captureDir,'workspace-dark-desktop.png'),
        animations:'disabled',fullPage:true});
      await page.locator('#themeToggle').click();
      await page.screenshot({path:path.join(captureDir,'workspace-light-desktop.png'),
        animations:'disabled',fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    await page.reload({waitUntil:'load'});
    await preactReady(page);
    const toggle=page.locator('#sidebarToggle');
    assert.ok(await toggle.isVisible(),'mobile navigation toggle is available');
    assert.equal(await page.locator('#controllerSidebar').evaluate(n=>n.inert),true,
      'closed offscreen mobile navigation is inert');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('sidebar-open')),true);
    assert.equal(await page.locator('#controllerSidebar').evaluate(n=>n.inert),false);
    assert.ok(await page.locator('.sidebar-item.active').evaluate(el=>document.activeElement===el),
      'drawer autofocuses active navigation for keyboard users');
    if(captureDir)await page.screenshot({path:path.join(captureDir,'workspace-light-mobile-drawer.png'),
      animations:'disabled',fullPage:true});
    await page.locator('#reportsBtn').click();
    await page.waitForFunction(()=>location.pathname==='/reports'
      &&document.body.dataset.route==='/reports');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false',
      'navigation selection closes drawer');
    assert.equal(await page.locator('#controllerSidebar').evaluate(n=>n.inert),true);
    await toggle.click();
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','Escape closes drawer');
    assert.ok(await toggle.evaluate(el=>document.activeElement===el),'Escape returns focus to menu toggle');
    await toggle.click();
    // Wait for the real painted backdrop before a pointer dismissal. Forcing
    // clicks through the opening transition can target underlying content.
    await page.waitForFunction(()=>{
      const backdrop=document.querySelector('#sidebarBackdrop');
      return backdrop && Number.parseFloat(getComputedStyle(backdrop).opacity)>=.98
        && getComputedStyle(backdrop).visibility==='visible';
    });
    await page.mouse.click(370,430);
    await page.waitForFunction(()=>document.querySelector('#sidebarToggle')?.getAttribute('aria-expanded')==='false');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','backdrop closes drawer');
    await toggle.click();
    await page.locator('.sidebar-quick-add').click();
    await page.locator('#addPrinterDialog[open]').waitFor({state:'visible'});
    assert.equal(await toggle.getAttribute('aria-expanded'),'false',
      'quick add uses existing add printer dialog and closes navigation');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors,[],'new shell interactions must not produce page errors');
  }finally {await context.close();}
}

async function workspaceHeadingSmoke(page,url) {
  console.log('Chromium: shared page heading visual contract across all main routes');
  const headingStyle=async(selector)=>page.evaluate((selector)=>{
    const wrapper=document.querySelector(selector);
    if(!wrapper)throw new Error('Missing page heading: '+selector);
    const eyebrow=wrapper.querySelector('.ui-page-eyebrow');
    const title=wrapper.querySelector('.ui-page-title');
    const description=wrapper.querySelector('.ui-page-description');
    if(!eyebrow||!title||!description)throw new Error('Incomplete page heading '+selector);
    function metrics(el){
      const css=getComputedStyle(el);
      return {
        fontFamily:css.fontFamily,
        fontSize:css.fontSize,
        fontWeight:css.fontWeight,
        lineHeight:css.lineHeight,
        letterSpacing:css.letterSpacing,
        color:css.color,
        marginTop:css.marginTop,
        marginBottom:css.marginBottom
      };
    }
    return {
      eyebrow:metrics(eyebrow),title:metrics(title),description:metrics(description),
      eyebrowText:eyebrow.textContent.trim(),
      headingText:title.textContent.trim()
    };
  },selector);
  for(const theme of ['dark','light']){
    await page.goto(url+'/',{waitUntil:'load'});
    await preactReady(page);
    await page.evaluate((name)=>{
      if(document.documentElement.dataset.theme!==name)
        document.querySelector('#themeToggle')?.click();
    },theme);
    const expected=await headingStyle('.dashboard-hero.ui-page-heading');
    assert.equal(expected.headingText,'Farm overview');
    for(const [route,id] of routes.filter(([route,id])=>Boolean(id))){
      await page.goto(url+route,{waitUntil:'load'});
      await preactReady(page);
      await page.waitForFunction((id)=>document.getElementById(id)?.hidden===false,id);
      const actual=await headingStyle('#'+id+' .dialog-head.ui-page-heading');
      for(const part of ['eyebrow','title','description']){
        assert.deepEqual(actual[part],expected[part],
          theme+' '+route+' '+part+' style must match Dashboard heading');
      }
      assert.ok(actual.headingText,'route page must retain its own title: '+route);
      assert.ok(actual.eyebrowText,'route page must retain its category: '+route);
      const groupRoutes=['/maintenance','/groups','/reports','/alerts','/backup','/diagnostics'];
      const workspaceTitles={'/queue':'Queue & history','/library':'Print library','/licence':'Licence'};
      const topbarTitle=(await page.locator('#topbarContextTitle').textContent()).trim();
      const subtitle=(await page.locator('#topbarContextSubtitle').textContent()).trim();
      if(groupRoutes.includes(route)){
        assert.equal(topbarTitle,'Farm management',
          'Farm management sections retain their common topbar title: '+route);
        assert.notEqual(topbarTitle,actual.headingText,'the topbar must not duplicate the page title');
      } else {
        assert.equal(topbarTitle,workspaceTitles[route],'non-management route keeps its own topbar title');
      }
      assert.ok(subtitle.length>0,'route retains its unique descriptive topbar subtitle: '+route);
      const requestedEyebrows={
        '/library':'FARM FILE LIBRARY',
        '/backup':'FARM PROTECTION',
        '/diagnostics':'FARM CONTROLLER DIAGNOSTICS'
      };
      if(Object.hasOwn(requestedEyebrows,route)) {
        assert.equal(actual.eyebrowText,requestedEyebrows[route],
          'blue page eyebrow must use the farm-specific label: '+route);
      }
    }
    // Queue and library own reactive summary elements; they must not
    // disappear when styles are standardised.
    await page.goto(url+'/queue',{waitUntil:'load'});
    await preactReady(page);
    assert.equal(await page.locator('#queueSummary.ui-page-description').count(),1);
    await page.goto(url+'/library',{waitUntil:'load'});
    await preactReady(page);
    assert.equal(await page.locator('#librarySummary.ui-page-description').count(),1);
  }
  // Mobile heading typography must be the same on each page as well.
  await page.setViewportSize({width:390,height:844});
  await page.goto(url+'/',{waitUntil:'load'});
  await preactReady(page);
  const mobile=await headingStyle('.dashboard-hero.ui-page-heading');
  await page.goto(url+'/queue',{waitUntil:'load'});
  await preactReady(page);
  const queueMobile=await headingStyle('#queueDialog .dialog-head.ui-page-heading');
  for(const part of ['eyebrow','title','description'])
    assert.deepEqual(queueMobile[part],mobile[part],
      'mobile queue page '+part+' must match Dashboard');
  await page.setViewportSize({width:1365,height:900});
}

// Phase 4.1: verify that the same real Preact icon-tab treatment is applied
// on all five route pages, rather than just the Printer Details modal.
async function sharedTabNavigationSmoke(page,url) {
  const views=[
    ['/maintenance','maintenanceDialog'],
    ['/groups','printerGroupsDialog'],
    ['/reports','reportingDialog'],
    ['/alerts','alertsDialog'],
    ['/backup','backupRecoveryDialog']
  ];
  const captureDir=process.env.PFC_VISUAL_CAPTURE_DIR
    ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR) : null;
  if(captureDir)await fs.mkdir(captureDir,{recursive:true});
  for(const theme of ['dark','light']){
    for(const [route,id] of views){
      await page.setViewportSize({width:1365,height:900});
      await page.goto(url+route,{waitUntil:'load'});
      await preactReady(page);
      await page.waitForFunction((id)=>document.getElementById(id)?.hidden===false,id);
      await page.evaluate((theme)=>{document.documentElement.dataset.theme=theme;},theme);
      const selector='#'+id+' [data-pfc-tabs][role="tablist"]';
      await page.locator(selector+' [role="tab"]').first().waitFor({state:'visible'});
      const state=await page.evaluate((id)=>{
        const nav=document.querySelector('#'+id+' [data-pfc-tabs]');
        const items=[...nav.querySelectorAll('[role="tab"]')];
        const selected=items.filter(tab=>tab.getAttribute('aria-selected')==='true');
        const style=selected[0]?getComputedStyle(selected[0]):null;
        return {
          count:items.length,
          missingIcons:items.filter(tab=>
            !String(getComputedStyle(tab,'::before').maskImage||'').includes('data:image/svg+xml')).length,
          selected:selected.length,
          background:getComputedStyle(nav).backgroundColor,
          activeBackground:style?.backgroundColor,
          textColor:style?.color,
          underlineColor:style?.borderBottomColor,
          underlineWidth:style?.borderBottomWidth
        };
      },id);
      assert.ok(state.count>=2,route+' must have multiple real tabs');
      assert.equal(state.missingIcons,0,route+' all tabs must display local monochrome icons');
      assert.equal(state.selected,1,route+' must have one selected tab');
      assert.equal(state.background,'rgba(0, 0, 0, 0)',route+' navigation rail should be transparent');
      assert.equal(state.activeBackground,'rgba(0, 0, 0, 0)',route+' selected tab should not be filled');
      assert.equal(state.textColor,state.underlineColor,route+' active blue underline should match label');
      assert.ok(parseFloat(state.underlineWidth)>=2,route+' active underline must be visible');
      if(captureDir && (route==='/maintenance'||route==='/backup')){
        await page.screenshot({path:path.join(captureDir,
          'phase4-1-'+id+'-'+theme+'-desktop.png')});
      }
      // Existing page-specific keyboard navigation remains authoritative.
      await page.locator(selector+' [role="tab"]').last().focus();
      await page.keyboard.press('Home');
      await page.waitForFunction((id)=>{
        const tabs=[...document.querySelectorAll('#'+id+' [data-pfc-tabs] [role="tab"]')];
        return tabs[0]?.getAttribute('aria-selected')==='true';
      },id);
    }
  }
  // The longest rail is Backup: one row with horizontal scrolling on Android.
  await page.setViewportSize({width:390,height:844});
  await page.goto(url+'/backup',{waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>document.querySelector('#backupRecoveryDialog')?.hidden===false);
  const mobile=await page.evaluate(()=>{
    const rail=document.querySelector('#backupRecoveryDialog [data-pfc-tabs]');
    const tabs=[...rail.querySelectorAll('[role="tab"]')];
    const tops=tabs.map(x=>x.getBoundingClientRect().top);
    return {
      overflow:getComputedStyle(rail).overflowX,
      scrollWidth:rail.scrollWidth,
      clientWidth:rail.clientWidth,
      rows:Math.max(...tops)-Math.min(...tops)
    };
  });
  assert.equal(mobile.overflow,'auto','mobile backup tab rail must scroll');
  assert.ok(mobile.scrollWidth>mobile.clientWidth,'mobile backup tabs must overflow on one scrollable row');
  assert.ok(mobile.rows<=2,'mobile tabs must stay aligned on a single row');
  if(captureDir)await page.screenshot({path:path.join(captureDir,'phase4-1-backup-light-mobile.png')});
  await page.setViewportSize({width:1365,height:900});
  console.log('Chromium: Phase 4.1 shared icon tabs, themes, keyboard, mobile PASS');
}

// Print Library live Preact cost cards: current material estimate vs genuinely
// unavailable cost, visually consistent on light/dark desktop and mobile.
async function libraryCostSmoke(page,url) {
  await page.goto(url+'/library',{waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>window.__PFC_PREACT_LIBRARY__===true);
  assert.equal(await page.locator('link[href="/print-library-polish.css"]').count(),1,
    'Print Library cost styling must load');
  const rows=[
    {id:'browser-cost-available',fileName:'Sample part.3mf',sizeText:'14 KB',description:'Sample print',
      printerTarget:'',requirements:'PLA · 1 tool',colours:[],meta:'Not printed yet',warning:'',
      previewUrl:'',deleteDisabled:false,deleteTitle:'',
      cost:{available:true,value:'£0.55',detail:'Current filament catalogue prices · 25 g sliced · Estimate only, excludes overheads.'}},
    {id:'browser-cost-unavailable',fileName:'Unknown cost.gcode',sizeText:'8 KB',description:'',
      printerTarget:'',requirements:'PLA · 1 tool',colours:[],meta:'Not printed yet',warning:'',
      previewUrl:'',deleteDisabled:false,deleteTitle:'',
      cost:{available:false,value:'Unavailable',detail:'Multiple PLA catalogue entries exist; assign one to this file'}}
  ];
  const inject=async()=>{
    await page.evaluate((files)=>{
      window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{
        detail:{summary:'2 files · test fixtures',files,emptyText:'No files'}
      }));
    },rows);
    await page.locator('[data-library-file="browser-cost-available"] [data-library-cost]').waitFor();
  };
  const dir=process.env.PFC_VISUAL_CAPTURE_DIR
    ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR) : null;
  if(dir)await fs.mkdir(dir,{recursive:true});
  for(const theme of ['dark','light']){
    await page.setViewportSize({width:1365,height:900});
    await page.evaluate(name=>{document.documentElement.dataset.theme=name;},theme);
    await inject();
    const observed=await page.evaluate(()=>{
      const complete=document.querySelector('[data-library-file="browser-cost-available"] [data-library-cost]');
      const missing=document.querySelector('[data-library-file="browser-cost-unavailable"] [data-library-cost]');
      return {
        title:complete?.querySelector('.library-print-cost-label')?.textContent,
        available:complete?.querySelector('.library-print-cost-value')?.textContent,
        unavailable:missing?.querySelector('.library-print-cost-value')?.textContent,
        note:complete?.querySelector('.library-print-cost-detail')?.textContent,
        background:complete?getComputedStyle(complete.closest('.library-list')).backgroundColor:null,
        icon:complete?getComputedStyle(complete.querySelector('.library-print-cost-icon')).maskImage:null
      };
    });
    assert.equal(observed.title,'Estimated material cost / print');
    assert.equal(observed.available,'£0.55');
    assert.equal(observed.unavailable,'Unavailable');
    assert.match(observed.note,/excludes overheads/);
    assert.notEqual(observed.background,'rgba(0, 0, 0, 0)','library table surface must be theme-aware');
    assert.ok(observed.icon?.includes('data:image/svg+xml'),'cost icon should come from local CSS');
    if(dir)await page.screenshot({path:path.join(dir,'print-library-cost-'+theme+'-desktop.png')});
  }
  await page.setViewportSize({width:390,height:844});
  await inject();
  const card=page.locator('[data-library-file="browser-cost-available"]');
  const geometry=await card.evaluate((element)=>{
    const card=element.getBoundingClientRect();
    const cost=element.querySelector('[data-library-cost]').getBoundingClientRect();
    return {cardRight:card.right,costRight:cost.right,costLeft:cost.left,cardLeft:card.left};
  });
  assert.ok(geometry.costLeft>=geometry.cardLeft-2 && geometry.costRight<=geometry.cardRight+2,
    'mobile cost card should not overflow the print library entry');
  if(dir)await page.screenshot({path:path.join(dir,'print-library-cost-light-mobile.png')});
  await page.setViewportSize({width:1365,height:900});
  console.log('Chromium: Print Library current material cost display PASS');
}

// Browser smoke against real API-backed temporary library files (never run
// mutations against an external configured controller). Verifies that the
// selected row, toolbar and existing queue/edit/delete workflows still work.
// Validate the narrowed desktop Print Library table against browser geometry
// and retain responsive cards before the fixed tracks would overflow.
async function libraryCompactTableSmoke(page,url) {
  await page.setViewportSize({width:1920,height:900});
  await page.goto(url+'/library',{waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>window.__PFC_PREACT_LIBRARY__===true);
  // The controller may perform two overlapping Print Library refreshes on a
  // direct /library load (startup and route activation). Wait for an actual
  // controller-published state, not Preact's initial placeholder summary.
  await page.waitForFunction(()=>Boolean(window.__PFC_LIBRARY_UI_STATE__?.summary));
  const fixture=[{
    id:'compact-table-fixture',fileName:'Batch production ASA part.gcode',
    sizeText:'24 KB',description:'Production part',printerTarget:'AD5M Pro',
    requirements:'ASA · 0.4 mm nozzle',colours:[],warning:'',
    previewUrl:'',selected:false,
    cost:{available:true,value:'£0.64',detail:'20g ASA filament'},
    sale:{available:true,lots:3,perLot:'£2.44',price:'£7.32',detail:'Includes tax'},
    historyCount:'2 completed prints',historyLast:'Last printed recently',
    historyAdded:'Added recently'
  }];
  // This smoke tests presentational geometry with a synthetic row, without
  // adding files to a real/external controller. A late independent API refresh
  // must not replace the fixture before the geometry assertions execute.
  // Restore it only during this visual check, then remove the test listener.
  await page.evaluate(files=>{
    const fixtureState={summary:'1 file · compact table regression',files,emptyText:'No files'};
    const replay=(event)=>{
      if(event?.detail?.summary===fixtureState.summary)return;
      window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{detail:fixtureState}));
    };
    window.__PFC_COMPACT_TABLE_REPLAY__=replay;
    window.addEventListener('pfc:library-ui-state',replay);
  },fixture);
  for(const viewport of [
    {width:1920,height:900,desktop:true},
    {width:1365,height:900,desktop:true},
    {width:1300,height:900,desktop:false},
    {width:390,height:844,desktop:false}
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate((files)=>{
      document.querySelector('#libraryTableHead').hidden=false;
      window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{
        detail:{summary:'1 file · compact table regression',files,emptyText:'No files'}
      }));
    },fixture);
    await page.waitForFunction(()=>document.querySelectorAll('#libraryList .library-file-row').length===1
      && document.querySelector('#libraryList [data-library-file="compact-table-fixture"]'));
    const topControls=await page.evaluate(()=>{
      const rect=(selector)=>{
        const node=document.querySelector(selector);
        const r=node.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width};
      };
      return {
        toolbar:rect('#libraryDialog .library-toolbar'),
        search:rect('#librarySearchInput'),
        upload:rect('#libraryUploadBtn'),
        actions:rect('#libraryDialog .library-action-toolbar'),
        buttons:['libraryQueueSelectedBtn','libraryEditSelectedBtn',
          'libraryFavouriteSelectedBtn','libraryDeleteSelectedBtn'].map(id=>rect('#'+id)),
        feedback:rect('#librarySelectionStatus')
      };
    });
    if(viewport.desktop){
      for(const action of [topControls.upload,...topControls.buttons])
        assert.ok(Math.abs(action.bottom-topControls.search.bottom)<=4,
          'desktop Print Library search, Add file and all four selected-file actions share one line: '+JSON.stringify({viewport,topControls}));
      assert.ok(topControls.feedback.top>=topControls.toolbar.bottom-2,
        'selection status stays below the shared button row');
    } else {
      assert.ok(topControls.actions.left>=topControls.toolbar.left-2 &&
        topControls.actions.right<=topControls.toolbar.right+2,
        'responsive actions must remain within their toolbar');
    }
    const geometry=await page.evaluate(()=>{
      const box=(el)=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
      const header=document.querySelector('#libraryTableHead');
      const row=document.querySelector('#libraryList .library-file-row');
      const main=document.querySelector('body > main');
      const headings=Array.from(header.children).map(box);
      const cells=Array.from(row.children).filter(el=>el.classList.contains('library-cell')).map(box);
      const sale=row.querySelector('.library-sale-cell');
      const history=row.querySelector('.library-history-cell');
      return {
        main:box(main),header:box(header),row:box(row),
        visible:getComputedStyle(header).display!=='none',
        headings,cells,sale:box(sale),history:box(history),
        windowWidth:window.innerWidth,docWidth:document.documentElement.scrollWidth
      };
    });
    if(viewport.desktop){
      assert.ok(geometry.visible,'desktop Print Library retains sortable table header');
      assert.ok(geometry.header.width<=1302,'table should be capped at approximately 1300px');
      assert.ok(geometry.header.right<=geometry.main.right+1,
        'table must fit within the sidebar-constrained workspace');
      assert.equal(geometry.headings.length,9);
      assert.equal(geometry.cells.length,9);
      const saleTrack=geometry.headings[7],historyTrack=geometry.headings[8];
      assert.ok(saleTrack.width<=180&&historyTrack.width<=160,
        'sale and history columns must not reserve large empty gaps: '+JSON.stringify({saleTrack,historyTrack,viewport}));
      assert.ok(Math.abs(geometry.history.left-geometry.sale.right)<=14,
        'price and history columns should be tightly adjacent');
      for(let col=0;col<9;col++){
        assert.ok(Math.abs(geometry.headings[col].left-geometry.cells[col].left)<=8,
          'table heading/body tracks must stay aligned at column '+col);
      }
    } else {
      assert.equal(geometry.visible,false,'narrow workspace should use responsive cards instead of squeezed columns');
      assert.ok(geometry.row.right<=geometry.main.right+2,
        'responsive library cards must fit the page without horizontal clipping');
    }
    assert.ok(geometry.docWidth<=geometry.windowWidth+2,
      'compact library must not introduce horizontal page scrolling');
  }
  await page.evaluate(()=>{
    window.removeEventListener('pfc:library-ui-state',window.__PFC_COMPACT_TABLE_REPLAY__);
    delete window.__PFC_COMPACT_TABLE_REPLAY__;
  });
  await page.setViewportSize({width:1365,height:900});
  console.log('Chromium: compact Print Library columns and responsive geometry PASS');
}

async function librarySelectionSmoke(page,url,{mutateFixture = true} = {}) {
  await page.setViewportSize({width:1365,height:900});
  await page.goto(url+'/library',{waitUntil:'load'});
  await preactReady(page);
  if(!mutateFixture) return;
  const names=['ui-selection-first.gcode','ui-selection-second.gcode'];
  for(const [i,name] of names.entries()){
    const response=await page.evaluate(async ({name,i})=>{
      const body='; filament_type = PLA\\n; filament used [g] = '+(10+i)+'\\nT0\\nG1 X10\\n';
      const request=await fetch('/api/library',{
        method:'POST',
        headers:{'x-file-name':name},
        body:new Blob([body],{type:'application/octet-stream'})
      });
      return {status:request.status,data:await request.json()};
    },{name,i});
    assert.ok([200,201].includes(response.status),'fixture upload must succeed');
  }
  await page.reload({waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>document.querySelectorAll('#libraryList [data-library-file]').length===2);
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isDisabled(),true);
  assert.equal(await page.locator('#libraryEditSelectedBtn').isDisabled(),true);
  assert.equal(await page.locator('#libraryDeleteSelectedBtn').isDisabled(),true);
  assert.equal(await page.locator('#libraryTableHead').isVisible(),true);
  assert.ok((await page.locator('#libraryTableHead').textContent()).includes('Estimated cost'));
  assert.ok((await page.locator('#libraryTableHead').textContent()).includes('Sale lots'));
  assert.equal((await page.locator('#libraryTableHead [data-library-sort="salePrice"]').textContent()).trim(),'Min. sell price');
  assert.equal(await page.locator('#libraryTableHead [data-library-sort="salePrice"]').getAttribute('aria-label'),
    'Sort by minimum sell price per lot');
  assert.equal(await page.locator('#libraryTableHead > *').count(),9);
  assert.equal(await page.locator('#libraryList .library-file-row').first()
    .locator('.library-lots-cell').count(),1);
  assert.equal(await page.locator('#libraryList .library-file-row').first()
    .locator('.library-sale-cell').count(),1);
  const rows=page.locator('#libraryList .library-file-row');
  const firstId=await rows.nth(0).getAttribute('data-library-file');
  const secondId=await rows.nth(1).getAttribute('data-library-file');

  // Regression: selecting a row deep within a scrollable Print Library must
  // keep its position, including selection-button and keyboard activation.
  // Stretch these *real library records* inside an isolated browser fixture
  // so two files are enough to exercise the overflowing viewport reliably.
  await page.evaluate(()=>{
    const list=document.querySelector('#libraryList');
    list.style.maxHeight='250px';
    list.style.overflowY='auto';
    list.querySelectorAll('.library-file-row').forEach(row=>{row.style.minHeight='360px';});
    list.scrollTop=345;
  });
  const scrollBefore=await page.locator('#libraryList').evaluate(node=>node.scrollTop);
  assert.ok(scrollBefore>200,'fixture must be scrolled well below the top row');
  const secondRow=page.locator('[data-library-file="'+secondId+'"]');
  const stillScrolled=async label=>{
    const current=await page.locator('#libraryList').evaluate(node=>node.scrollTop);
    assert.ok(Math.abs(current-scrollBefore)<=3,label+' must not reset the Print Library scroll offset');
  };
  await secondRow.locator('.library-file-title').click();
  assert.equal(await secondRow.getAttribute('data-library-selected'),'true');
  await stillScrolled('row click');
  await secondRow.locator('[data-library-select]').click();
  assert.equal(await secondRow.getAttribute('data-library-selected'),'false');
  await stillScrolled('selection-button deselect');
  await secondRow.locator('[data-library-select]').click();
  assert.equal(await secondRow.getAttribute('data-library-selected'),'true');
  await stillScrolled('selection-button select');
  await secondRow.locator('[data-library-select]').focus();
  await page.keyboard.press('Space');
  assert.equal(await secondRow.getAttribute('data-library-selected'),'false');
  await stillScrolled('keyboard deselect');
  await page.evaluate(()=>{
    const list=document.querySelector('#libraryList');
    list.style.removeProperty('max-height');
    list.style.removeProperty('overflow-y');
    list.querySelectorAll('.library-file-row').forEach(row=>{row.style.removeProperty('min-height');});
    list.scrollTop=0;
  });

  await rows.nth(0).locator('[data-library-select]').click();
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isEnabled(),true);
  assert.equal(await page.locator('#libraryEditSelectedBtn').isEnabled(),true);
  assert.equal(await page.locator('#libraryDeleteSelectedBtn').isEnabled(),true);
  assert.equal(await page.locator('[data-library-file="'+firstId+'"]').getAttribute('data-library-selected'),'true');
  await page.locator('#libraryQueueSelectedBtn').click();
  await page.waitForFunction(()=>document.querySelector('#queueAddDialog')?.open===true);
  assert.equal(await page.locator('#libraryDialog').isVisible(),true,'library route stays visible behind queue modal');
  await page.locator('[data-queue-add-close]').first().click();
  await page.locator('#libraryEditSelectedBtn').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===true);
  await page.locator('[data-library-metadata-close]').first().click();
  await page.locator('[data-library-file="'+secondId+'"]').click();
  assert.equal(await page.locator('[data-library-file="'+secondId+'"]').getAttribute('data-library-selected'),'true');
  assert.equal(await page.locator('[data-library-file="'+firstId+'"]').getAttribute('data-library-selected'),'false');
  // Clicking the same selection button a second time clears the selection.
  await page.locator('[data-library-file="'+secondId+'"] [data-library-select]').click();
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isDisabled(),true);
  await page.locator('[data-library-file="'+firstId+'"] [data-library-select]').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isEnabled(),true,'keyboard activation selects the row');
  // An item hidden by search must not remain queueable or deletable.
  const otherFileName=await page.locator('[data-library-file="'+secondId+'"] .library-file-title').innerText();
  await page.locator('#librarySearchInput').fill(otherFileName.trim());
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isDisabled(),true);
  assert.equal(await page.locator('#librarySelectionStatus').innerText(),'Select a file to enable actions');
  await page.locator('#librarySearchInput').fill('');
  await page.locator('[data-library-file="'+firstId+'"] [data-library-select]').click();
  await page.reload({waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>document.querySelectorAll('#libraryList [data-library-file]').length===2);
  // The initial state after a full browser reload is intentionally unselected.
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isDisabled(),true);
  // Test category/tags/favourites against persisted file metadata, not just
  // synthetic DOM fixtures. All controls must keep the table and actions safe.
  const patched=await page.evaluate(async (id)=>{
    const response=await fetch('/api/library/'+encodeURIComponent(id),{
      method:'PATCH',headers:{'content-type':'application/json'},
      body:JSON.stringify({category:'Production fixtures',tags:['Test ASA','Production'],favourite:true})
    });
    return {status:response.status,data:await response.json()};
  },firstId);
  assert.equal(patched.status,200,'editing category/tag metadata should persist');
  await page.reload({waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>document.querySelectorAll('#libraryList .library-file-row').length===2);
  assert.ok(await page.locator('[data-library-file="'+firstId+'"] .library-category').count());
  assert.ok(await page.locator('[data-library-file="'+firstId+'"] .library-fav-mark').count());
  assert.ok((await page.locator('[data-library-file="'+firstId+'"] .library-tags').innerText()).includes('Production'));
  await page.locator('#libraryAdvancedFilters > summary').click();
  // The direction button is a peer of the labelled sort/batch fields. Their
  // native input boxes must share the same top and bottom in both themes:
  // global label margins previously pushed the button 12px too low.
  for (const theme of ['dark','light']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const bounds=await page.evaluate(()=>{
      const rect=(id)=>{
        const box=document.getElementById(id).getBoundingClientRect();
        return {top:box.top,bottom:box.bottom,height:box.height};
      };
      return {
        sort:rect('librarySortSelect'),
        direction:rect('librarySortDirectionBtn'),
        quantity:rect('libraryEstimateQuantity')
      };
    });
    for (const [name,box] of [['direction',bounds.direction],['quantity',bounds.quantity]]) {
      assert.ok(Math.abs(box.top-bounds.sort.top)<=1,
        theme+': '+name+' should align with Sort by top edge: '+JSON.stringify(bounds));
      assert.ok(Math.abs(box.bottom-bounds.sort.bottom)<=1,
        theme+': '+name+' should align with Sort by bottom edge: '+JSON.stringify(bounds));
      assert.ok(Math.abs(box.height-42)<=1,theme+': '+name+' should use standard 42px control height');
    }
  }
  await page.locator('#libraryCategoryFilter').selectOption('Production fixtures');
  assert.equal(await page.locator('.library-file-row').count(),1,'category filter narrows rows');
  await page.locator('#libraryTagFilter').selectOption('Test ASA');
  assert.equal(await page.locator('.library-file-row').count(),1,'tag facet combines with category');
  await page.locator('#libraryFavouritesFilter').check();
  assert.equal(await page.locator('.library-file-row').count(),1,'favourites facet restricts rows');
  await page.locator('#libraryFavouritesFilter').uncheck();
  await page.locator('#libraryCategoryFilter').selectOption('');
  await page.locator('#libraryTagFilter').selectOption('');
  const materials=await page.locator('#libraryMaterialFilter option').evaluateAll((items)=>
    items.map((item)=>item.value).filter(Boolean));
  if(materials.length){
    await page.locator('#libraryMaterialFilter').selectOption(materials[0]);
    const count=await page.locator('.library-file-row').count();
    assert.ok(count>=1 && count<=2,'material filter narrows to matching sliced files');
  }
  await page.locator('#libraryClearFiltersBtn').click();
  assert.equal(await page.locator('.library-file-row').count(),2,'clear filters restores full set');
  await page.locator('[data-library-sort="name"]').click();
  assert.equal(await page.locator('[data-library-sort="name"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.library-file-row').first().locator('.library-file-title').innerText(),/ui-selection-first|ui-selection-second/);
  await page.locator('#librarySortSelect').selectOption('added');
  await page.locator('#libraryEstimateQuantity').fill('5');
  await page.locator('#libraryEstimateQuantity').dispatchEvent('change');
  assert.equal(await page.locator('#libraryEstimateQuantity').inputValue(),'5','batch quantity remains user-editable');
  await page.locator('#libraryAdvancedFilters > summary').click();
  assert.equal(await page.locator('.library-file-row').count(),2);
  for(const theme of ['dark','light']){
    await page.evaluate(x=>{document.documentElement.dataset.theme=x;},theme);
    const dimensions=await page.locator('.library-file-row').first().evaluate((node)=>{
      const tableHead=document.querySelector('#libraryTableHead');
      const root=getComputedStyle(document.documentElement);
      const heading=getComputedStyle(tableHead);
      const row=getComputedStyle(node);
      const parent=getComputedStyle(node.parentElement);
      const first=tableHead.firstElementChild;
      return {
        display:row.display,
        columns:row.gridTemplateColumns,
        headerColumns:heading.gridTemplateColumns,
        textColor:heading.color,
        headerBackground:heading.backgroundColor,
        sharedText:root.getPropertyValue('--pfc-table-header-text').trim(),
        sharedBackground:root.getPropertyValue('--pfc-table-header-background').trim(),
        sharedHover:root.getPropertyValue('--pfc-table-hover').trim(),
        sharedSelected:root.getPropertyValue('--pfc-table-selected').trim(),
        rowBackground:row.backgroundColor,
        cellBackground:getComputedStyle(node.querySelector('.library-target-cell')).backgroundColor,
        parentBackground:parent.backgroundColor,
        headingFontWeight:heading.fontWeight,
        headingTextTransform:heading.textTransform,
        headingPadding:getComputedStyle(first).padding
      };
    });
    assert.equal(dimensions.display,'grid');
    assert.equal(dimensions.columns.split(' ').length,9,'desktop library has nine aligned columns');
    const tracks=(value)=>value.split(' ').map(parseFloat);
    const headTracks=tracks(dimensions.headerColumns);
    const rowTracks=tracks(dimensions.columns);
    assert.equal(headTracks.length,rowTracks.length,'heading and body must have identical column count');
    assert.ok(headTracks.every((width,i)=>Math.abs(width-rowTracks[i])<=0.25),
      'heading and row columns must align within subpixel rendering tolerance');
    assert.equal(dimensions.headingTextTransform,'uppercase','heading follows canonical uppercase convention');
    assert.equal(dimensions.textColor,'rgb(255, 255, 255)','all table headings must stay white in both themes');
    assert.equal(dimensions.cellBackground,'rgba(0, 0, 0, 0)','table cells must not introduce individual coloured backgrounds');
    assert.ok(dimensions.sharedText && dimensions.sharedBackground && dimensions.sharedHover && dimensions.sharedSelected,
      'library should inherit existing shared table system tokens');
  }
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#libraryTableHead')).display==='none');
  const overflow=await page.evaluate(()=>{
    const list=document.querySelector('#libraryList').getBoundingClientRect();
    const card=document.querySelector('.library-file-row').getBoundingClientRect();
    return {listLeft:list.left,listRight:list.right,cardLeft:card.left,cardRight:card.right};
  });
  assert.ok(overflow.cardLeft>=overflow.listLeft-2 && overflow.cardRight<=overflow.listRight+2,
    'mobile rows must fit in the scroll-free list');
  await page.locator('[data-library-select]').first().click();
  assert.equal(await page.locator('#libraryDeleteSelectedBtn').isEnabled(),true);
  if(process.env.PFC_VISUAL_CAPTURE_DIR){
    const output=path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR);
    await fs.mkdir(output,{recursive:true});
    await page.screenshot({path:path.join(output,'library-selected-mobile.png'),fullPage:true});
  }
  // Clean up fixture files, preserving other records.
  for(const id of [firstId,secondId]){
    await page.locator('#librarySearchInput').fill('');
    await page.locator('[data-library-file="'+id+'"] [data-library-select]').click();
    if(await page.locator('#libraryDeleteSelectedBtn').isDisabled()){
      await page.locator('[data-library-file="'+id+'"] [data-library-select]').click();
    }
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#libraryDeleteSelectedBtn').click();
    await page.waitForFunction((id)=>!document.querySelector('[data-library-file="'+id+'"]'),id);
  }
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isDisabled(),true);
  await page.setViewportSize({width:1365,height:900});
  console.log('Chromium: Print Library table, selection, toolbar, queue/edit/delete and mobile PASS');
}

// Edit/Add modal: the label sits above its input, only the central form
// body scrolls, and header and save/cancel remain visible on small screens.
async function verifyLibraryEditorLayout(page,editor) {
  const prefix=editor==='add'?'libraryAdd':'libraryMetadata';
  assert.equal(await page.locator('#'+prefix+'SundryCurrency').count(),0,
    editor+': no manual sundry currency selection in this dialog');
  const metrics=await page.evaluate(prefix=>{
    const modal=document.getElementById(prefix+'Dialog');
    const header=modal.querySelector('.dialog-head');
    const body=modal.querySelector('.library-editor-body');
    const footer=modal.querySelector('.library-editor-footer');
    const lots=document.getElementById(prefix+'LotsPerPrint');
    const sundrySection=modal.querySelector('.library-pricing-fields');
    const sectionHeading=sundrySection.querySelector('.library-pricing-head h3');
    const config=sundrySection.querySelector('.library-pricing-config');
    const rect=node=>{
      const r=node.getBoundingClientRect();
      return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};
    };
    const fields=[lots].map(control=>{
      const label=control.closest('label');
      const range=document.createRange();
      range.selectNodeContents(label.firstChild);
      return {
        text:rect(range),
        input:rect(control),
        label:rect(label),
        display:getComputedStyle(label).display,
        direction:getComputedStyle(label).flexDirection
      };
    });
    const start={head:rect(header),foot:rect(footer),body:rect(body)};
    const maxScroll=body.scrollHeight-body.clientHeight;
    body.scrollTop=maxScroll;
    const end={head:rect(header),foot:rect(footer),scrollTop:body.scrollTop};
    body.scrollTop=0;
    return {fields,start,end,maxScroll,bodyOverflow:getComputedStyle(body).overflowY,
      footerButtons:[...footer.querySelectorAll('button')].map(btn=>rect(btn)),
      dialogRect:rect(modal),
      pricingSection:rect(sundrySection),pricingHeading:rect(sectionHeading),
      pricingHeadingTag:sectionHeading.tagName,
      pricingHeadingText:sectionHeading.textContent.trim(),
      pricingConfigStyle:getComputedStyle(config).display,
      pricingColumns:getComputedStyle(config).gridTemplateColumns,
      pricingConfigLabels:[...config.querySelectorAll(':scope > label')].map(label=>rect(label)),
      pricingBackground:getComputedStyle(sundrySection).backgroundColor,
      pricingPanelBorder:getComputedStyle(sundrySection).borderTopWidth};
  },prefix);
  for (const [index,field] of metrics.fields.entries()) {
    const label='Sale lots per print';
    assert.equal(field.display,'flex',editor+': '+label+' stacks in a flex label');
    assert.equal(field.direction,'column',editor+': '+label+' uses a column');
    assert.ok(field.input.top>=field.text.bottom+3,
      editor+': '+label+' input sits underneath its heading: '+JSON.stringify(field));
    assert.ok(Math.abs(field.input.left-field.label.left)<=2,
      editor+': '+label+' input has same left alignment as its label');
  }
  assert.equal(metrics.pricingHeadingTag,'H3',editor+': pricing panel uses a semantic section heading');
  assert.equal(metrics.pricingHeadingText,'Sundry costs and sale lots');
  assert.ok(metrics.pricingHeading.top>=metrics.pricingSection.top+8,
    editor+': section title must be inside the panel, not clipped into the top border');
  assert.ok(metrics.pricingHeading.left>=metrics.pricingSection.left+8
    && metrics.pricingHeading.right<=metrics.pricingSection.right-8,
    editor+': section title should remain within the panel horizontally');
  assert.ok(metrics.pricingHeading.bottom<metrics.pricingConfigLabels[0].top,
    editor+': section title must not overlap its controls');
  assert.equal(metrics.pricingConfigStyle,'grid',editor+': sale lots retain standard layout');
  assert.equal(metrics.pricingConfigLabels.length,1,
    editor+': there must be no file-specific sundry currency selector');
  assert.ok(metrics.pricingBackground!=='rgba(0, 0, 0, 0)' && metrics.pricingPanelBorder!=='0px',
    editor+': standard panel has a surface and border');
  assert.equal(metrics.bodyOverflow,'auto',editor+': central body should scroll');
  assert.ok(metrics.maxScroll>20,editor+': fixture must have overflowing fields');
  assert.ok(metrics.end.scrollTop>20,editor+': only form fields should scroll');
  assert.ok(Math.abs(metrics.start.head.top-metrics.end.head.top)<1
    && Math.abs(metrics.start.foot.bottom-metrics.end.foot.bottom)<1,
    editor+': header and action footer must not move on body scroll');
  assert.ok(metrics.footerButtons.every(b=>b.top>=metrics.dialogRect.top-1
    && b.bottom<=metrics.dialogRect.bottom+1),
    editor+': action buttons must be visible within the dialog viewport');
}

// The add dialog must capture product metadata on first upload, while the edit
// dialog can modify sundries and sales-lot allocations for existing files.
async function libraryPricingSmoke(page,url,{mutateFixture=true}={}) {
  if(!mutateFixture) return;
  await page.setViewportSize({width:1365,height:900});
  await page.goto(url+'/reports',{waitUntil:'load'});
  await preactReady(page);
  await page.locator('[data-reporting-tab="pricing"]').click();
  await page.waitForFunction(()=>{
    const panel=document.querySelector('#reportingPanelPricing');
    return panel?.hidden===false && !document.querySelector('#reportingPricingFields')?.disabled;
  });
  assert.equal(await page.locator('#reportingPanelAnalytics').evaluate(node=>node.hidden),true);
  assert.equal(await page.locator('#reportingPanelFilament').evaluate(node=>node.hidden),true);
  await page.locator('#reportingProfitPercent').fill('30');
  await page.locator('#reportingProfitMethod').selectOption('markup');
  await page.locator('#reportingTaxRate').fill('20');
  await page.locator('#reportingLabourHourlyRate').fill('18');
  assert.equal(await page.locator('#filamentCurrency').count(),0);
  await page.locator('#reportingCurrency').selectOption('EUR');
  await page.locator('#reportingPricingSaveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#reportingPricingStatus')?.textContent.includes('saved'));
  const settings=await page.evaluate(async()=> (await (await fetch('/api/library/pricing')).json()).settings);
  assert.equal(settings.profitPercent,30);
  assert.equal(settings.profitMethod,'markup');
  assert.equal(settings.taxRate,20);
  assert.equal(settings.labourHourlyRate,18);
  assert.equal(settings.currency,'EUR');
  await page.locator('[data-reporting-tab="filament"]').click();
  await page.locator('[data-reporting-tab="pricing"]').click();
  await page.waitForFunction(()=>
    document.querySelector('#reportingProfitPercent')?.value==='30' &&
    !document.querySelector('#reportingPricingFields')?.disabled);
  assert.equal(await page.locator('#reportingProfitMethod').inputValue(),'markup',
    'pricing tab must load persisted global settings after switching tabs');
  assert.equal(await page.locator('#reportingTaxRate').inputValue(),'20',
    'pricing tab must reload the persisted tax rate');
  assert.equal(await page.locator('#reportingLabourHourlyRate').inputValue(),'18');
  assert.equal(await page.locator('#reportingCurrency').inputValue(),'EUR');
  const createdCurrencyFixture=await page.evaluate(async()=>{
    const res=await fetch('/api/filaments',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({material:'ASA',costPerKg:20,brand:'Browser currency test'})});
    if(!res.ok)throw Error('Failed to seed global currency test filament');
    return (await res.json()).filament;
  });
  assert.equal(createdCurrencyFixture.currency,'EUR');
  await page.goto(url+'/library',{waitUntil:'load'});
  await preactReady(page);
  assert.equal(await page.locator('#libraryPricingSettingsBtn').count(),0,
    'global price settings no longer belong in the Print Library toolbar');
  await page.setViewportSize({width:1024,height:600});
  await page.locator('#libraryUploadBtn').click();
  await verifyLibraryEditorLayout(page,'add');
  const name='pricing-sundry-browser-fixture.gcode';
  const sliced='; filament_type = ASA\n; filament used [g] = 12\nT0\nG1 X20\n';
  await page.locator('#libraryFileInput').setInputFiles({
    name,mimeType:'application/octet-stream',buffer:Buffer.from(sliced)
  });
  await page.locator('#libraryAddCategory').fill('Production pricing');
  await page.locator('#libraryAddTags').fill('Hardware, Bulk lot');
  await page.locator('#libraryAddLotsPerPrint').fill('4');
  await page.locator('[data-library-add-sundry="add"]').click();
  const itemChoices=page.locator('#libraryAddSundries [data-sundry-label] option:not([disabled])');
  assert.deepEqual(await itemChoices.allTextContents(),
    ['Packaging','Postage','Hardware','Labour','Miscellaneous']);
  await page.locator('#libraryAddSundries [data-sundry-label]').selectOption('Labour');
  assert.equal(await page.locator('#libraryAddSundries [data-sundry-minutes]').isVisible(),true);
  assert.equal(await page.locator('#libraryAddSundries [data-sundry-qty]').isVisible(),false);
  assert.equal(await page.locator('#libraryAddSundries [data-sundry-cost]').isVisible(),false);
  await page.locator('#libraryAddSundries [data-sundry-minutes]').fill('15');
  await page.locator('#libraryAddSundries [data-sundry-label]').selectOption('Hardware');
  assert.equal(await page.locator('#libraryAddSundries [data-sundry-qty]').isVisible(),true);
  const addRemove=page.locator('#libraryAddSundries [data-remove-sundry]');
  const addRemoveStyle=await addRemove.evaluate(btn=>{
    const style=getComputedStyle(btn);
    return {tag:btn.tagName,colour:style.color,border:style.borderTopColor,background:style.backgroundColor,
      backgroundImage:style.backgroundImage,klass:btn.className};
  });
  assert.match(addRemoveStyle.klass,/danger/);
  assert.equal(addRemoveStyle.border,addRemoveStyle.colour,'outlined Remove uses red themed text and border');
  assert.equal(addRemoveStyle.background,'rgba(0, 0, 0, 0)','Remove must not be solid red');
  assert.equal(addRemoveStyle.backgroundImage,'none');
  await page.locator('#libraryAddSundries [data-sundry-qty]').fill('4');
  const addUnitCost=page.locator('#libraryAddSundries [data-sundry-cost]');
  assert.equal(await addUnitCost.inputValue(),'0.00','new sundry unit costs have two decimal places');
  assert.equal(await addUnitCost.getAttribute('step'),'0.01');
  await addUnitCost.fill('1');
  await addUnitCost.blur();
  assert.equal(await addUnitCost.inputValue(),'1.00','whole monetary values show two decimals on blur');
  await addUnitCost.fill('0.25');
  await addUnitCost.blur();
  assert.equal(await addUnitCost.inputValue(),'0.25');
  await page.locator('#libraryAddForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#libraryAddDialog')?.open===false);

  const list=async()=>page.evaluate(async()=> (await (await fetch('/api/library')).json()).files);
  const files=await list();
  const added=files.find(file=>file.fileName===name);
  assert.ok(added,'file created using add-dialog metadata inputs');
  assert.equal(added.category,'Production pricing');
  assert.deepEqual(added.tags,['Hardware','Bulk lot']);
  assert.deepEqual(added.sundryCosts,[{label:'Hardware',quantity:4,unitCost:0.25}]);
  assert.equal(added.lotsPerPrint,4);
  assert.equal(added.saleEstimate.sundriesCost,1);
  assert.equal(added.saleEstimate.profitPercent,30);
  assert.equal(added.saleEstimate.taxRate,20);
  assert.equal(added.costEstimate.currency,'EUR');
  assert.equal(added.costEstimate.totalCost,0.24);
  assert.equal(added.saleEstimate.currency,'EUR');
  if (added.saleEstimate.complete) {
    assert.ok(added.saleEstimate.sellingPrice>=added.saleEstimate.sellingPriceExTax);
  }
  assert.equal(await page.locator('[data-library-file="'+added.id+'"] .library-sale-price').count(),1);

  await page.locator('[data-library-file="'+added.id+'"] [data-library-select]').click();
  await page.locator('#libraryEditSelectedBtn').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===true);
  await verifyLibraryEditorLayout(page,'metadata');
  const derivedCurrency=await page.locator('#libraryMetadataCostCurrency').innerText();
  const currentCost=added.costEstimate?.complete && added.costEstimate.currency
    ? added.costEstimate.currency : 'Not available until filament costing is complete';
  assert.equal(derivedCurrency,currentCost);
  assert.equal(await page.locator('#libraryMetadataLotsPerPrint').inputValue(),'4');
  assert.equal(await page.locator('#libraryMetadataSundries .library-sundry-row').count(),1);
  assert.equal(await page.locator('#libraryMetadataSundries [data-sundry-label]').inputValue(),'Hardware');
  assert.equal(await page.locator('#libraryMetadataSundries [data-sundry-cost]').inputValue(),'0.25',
    'previously saved unit cost is shown with two decimal places');
  // Unsaved Remove is only a form edit: cancelling must restore the stored row.
  const removeEdit=page.locator('#libraryMetadataSundries [data-remove-sundry]').first();
  const removeStyle=await removeEdit.evaluate(node=>{
    const style=getComputedStyle(node);
    return {colour:style.color,border:style.borderTopColor,background:style.backgroundColor};
  });
  assert.equal(removeStyle.colour,removeStyle.border,'Edit Details Remove is red outlined');
  assert.equal(removeStyle.background,'rgba(0, 0, 0, 0)');
  await removeEdit.click();
  assert.equal(await page.locator('#libraryMetadataSundries .library-sundry-row').count(),0);
  assert.equal((await list()).find(file=>file.id===added.id).sundryCosts.length,1,
    'unsaved removal must not persist');
  await page.locator('[data-library-metadata-close]').last().click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===false);
  await page.locator('#libraryEditSelectedBtn').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===true);
  assert.equal(await page.locator('#libraryMetadataSundries .library-sundry-row').count(),1,
    'cancelled removal should be restored when reopening');
  await page.locator('#libraryMetadataLotsPerPrint').fill('2');
  await page.locator('[data-library-add-sundry="metadata"]').click();
  await page.locator('#libraryMetadataSundries .library-sundry-row').nth(1).locator('[data-sundry-label]').selectOption('Packaging');
  await page.locator('#libraryMetadataSundries .library-sundry-row').nth(1).locator('[data-sundry-qty]').fill('1');
  const editUnitCost=page.locator('#libraryMetadataSundries .library-sundry-row').nth(1).locator('[data-sundry-cost]');
  assert.equal(await editUnitCost.inputValue(),'0.00');
  await editUnitCost.fill('0.5');
  await editUnitCost.blur();
  assert.equal(await editUnitCost.inputValue(),'0.50','entered currency preserves trailing zero');
  await page.locator('#libraryMetadataForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===false);
  const edited=(await list()).find(file=>file.id===added.id);
  assert.equal(edited.lotsPerPrint,2);
  assert.equal(edited.sundryCosts.length,2);
  assert.equal(edited.saleEstimate.sundriesCost,1.5);
  await page.locator('#libraryEditSelectedBtn').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===true);
  await page.locator('[data-library-add-sundry="metadata"]').click();
  const labourRow=page.locator('#libraryMetadataSundries .library-sundry-row').last();
  await labourRow.locator('[data-sundry-label]').selectOption('Labour');
  assert.equal(await labourRow.locator('[data-sundry-minutes]').isVisible(),true);
  assert.equal(await labourRow.locator('[data-sundry-qty]').isVisible(),false);
  assert.equal(await labourRow.locator('[data-sundry-cost]').isVisible(),false);
  await labourRow.locator('[data-sundry-minutes]').fill('30');
  await page.locator('#libraryMetadataForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===false);
  const labourSaved=(await list()).find(file=>file.id===added.id);
  assert.deepEqual(labourSaved.sundryCosts.at(-1),{label:'Labour',minutes:30});
  assert.equal(labourSaved.saleEstimate.labourCost,9);
  assert.equal(labourSaved.saleEstimate.sundriesCost,10.5);
  await page.locator('#libraryEditSelectedBtn').click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===true);
  assert.equal(await page.locator('#libraryMetadataSundries .library-sundry-row').last()
    .locator('[data-sundry-minutes]').inputValue(),'30');
  await page.locator('[data-library-metadata-close]').last().click();
  await page.waitForFunction(()=>document.querySelector('#libraryMetadataDialog')?.open===false);
  await page.evaluate(async()=>{
    const response=await fetch('/api/library/pricing',{method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({profitPercent:30,profitMethod:'markup',taxRate:20,labourHourlyRate:24})});
    if(!response.ok)throw Error('Unable to update labour rate');
  });
  const repriced=(await list()).find(file=>file.id===added.id);
  assert.equal(repriced.saleEstimate.labourCost,12);
  assert.equal(repriced.saleEstimate.sundriesCost,13.5);

  // The fixture is isolated. Remove it and restore default global profit.
  await page.evaluate(async id=>{
    const res=await fetch('/api/filaments/'+encodeURIComponent(id),{method:'DELETE'});
    if(!res.ok)throw Error('Could not delete currency-test filament');
  },createdCurrencyFixture.id);
  await page.locator('#libraryDeleteSelectedBtn').waitFor({state:'visible'});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#libraryDeleteSelectedBtn').click();
  await page.waitForFunction(id=>!document.querySelector('[data-library-file="'+id+'"]'),added.id);
  await page.evaluate(async()=> {
    const response=await fetch('/api/library/pricing',{method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({profitPercent:null,profitMethod:'markup',taxRate:0,labourHourlyRate:null,currency:'GBP'})});
    if (!response.ok) throw Error('Unable to reset test pricing settings');
  });
  await page.setViewportSize({width:1365,height:900});
  console.log('Chromium: Print Library global profit, add/edit sundries and sale-lot pricing PASS');
}

// Only the Print Library data rows should scroll. Toolbar, search and the
// standard desktop table headings remain visible on long lists in either
// theme, and mobile keeps its action bar above a scrollable card stack.
async function libraryScrollingSmoke(page,url) {
  await page.setViewportSize({width:1365,height:900});
  await page.goto(url+'/library',{waitUntil:'load'});
  await preactReady(page);
  await page.waitForFunction(()=>window.__PFC_PREACT_LIBRARY__ === true);
  const sample=Array.from({length:65},(_,i)=>({
    id:'scroll-sample-'+i,
    fileName:'Workshop component '+String(i+1).padStart(3,'0')+'.3mf',
    sizeText:'28 KB',description:'Reusable print file',
    printerTarget:'Any supported printer',requirements:'PLA · 0.4 mm',
    colours:[],warning:'',previewUrl:'',selected:false,
    cost:{available:true,value:'£0.62',detail:'Current filament catalogue prices'},
    sale:i%2===0
      ? {available:true,lots:4,price:'£9.76',perLot:'£2.44',detail:'GBP cost plus 30% markup'}
      : {available:false,lots:1,price:'Unavailable',perLot:'',detail:'Incomplete filament costing'},
    historyCount:'2 completed prints',historyLast:'Not printed yet',historyAdded:'Added recently'
  }));
  for(const viewport of [
    {width:1365,height:900,desktop:true},
    {width:390,height:844,desktop:false}
  ]) {
    await page.setViewportSize(viewport);
    for(const theme of ['dark','light']) {
      await page.evaluate(([files,theme])=>{
        document.documentElement.dataset.theme=theme;
        // In live usage renderPrintLibrary() unhides the header when files
        // arrive from the API. Mirror that state in the synthetic UI fixture.
        document.querySelector('#libraryTableHead').hidden=false;
        window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{
          detail:{summary:files.length+' files',files,emptyText:'No files'}
        }));
      },[sample,theme]);
      await page.waitForFunction(()=>document.querySelectorAll('#libraryList .library-file-row').length===65);
      const firstRow=page.locator('#libraryList .library-file-row').first();
      assert.equal(await firstRow.locator('.library-lots-value').innerText(),'4');
      assert.equal(await firstRow.locator('.library-sale-value').innerText(),'£2.44',
        'the main sell price must be per lot for a multi-lot print');
      assert.ok((await firstRow.locator('.library-sale-cell').innerText()).includes('£9.76'),
        'multi-lot rows should show the full-print selling total as context');
      const unknownRow=page.locator('#libraryList .library-file-row').nth(1);
      assert.equal(await unknownRow.locator('.library-lots-value').innerText(),'1');
      assert.equal(await unknownRow.locator('.library-sale-value').innerText(),'Unavailable',
        'unknown filament costs must never create a fabricated price');
      if(viewport.desktop) {
        assert.equal(await page.locator('#libraryTableHead > *').count(),9);
        assert.equal(await firstRow.locator('.library-cell').count(),9);
      } else {
        assert.equal(await firstRow.locator('.library-lots-cell .library-cell-label').innerText(),'Sale lots');
        assert.equal(await firstRow.locator('.library-sale-cell .library-cell-label').innerText(),'Min. sell price');
      }
      const before=await page.evaluate(()=>{
        const header=document.querySelector('#libraryTableHead');
        const list=document.querySelector('#libraryList');
        const actions=document.querySelector('#libraryQueueSelectedBtn');
        const search=document.querySelector('#librarySearchInput');
        return {
          headerTop:header.getBoundingClientRect().top,
          headerBottom:header.getBoundingClientRect().bottom,
          actionsTop:actions.getBoundingClientRect().top,
          searchTop:search.getBoundingClientRect().top,
          listTop:list.getBoundingClientRect().top,
          listBottom:list.getBoundingClientRect().bottom,
          listClient:list.clientHeight,
          listContent:list.scrollHeight,
          listOverflow:getComputedStyle(list).overflowY,
          headDisplay:getComputedStyle(header).display,
          pageScroll:window.scrollY,
          headingScrollGutter:getComputedStyle(header).scrollbarGutter,
          bodyScrollGutter:getComputedStyle(list).scrollbarGutter,
          headerCols:getComputedStyle(header).gridTemplateColumns,
          firstRowCols:getComputedStyle(list.querySelector('.library-file-row')).gridTemplateColumns
        };
      });
      assert.ok(before.listContent>before.listClient+100,'long list must scroll inside its region');
      assert.equal(before.listOverflow,'auto','only the library rows should scroll');
      console.log('LIBRARY SCROLL RESIZE DEBUG',JSON.stringify({viewport,theme,before}));
      assert.ok(before.listClient>=125,'file region must remain usable at '+viewport.width+'px');
      assert.ok(before.actionsTop>=0 && before.actionsTop<viewport.height,
        'selected-file actions remain onscreen above long lists');
      assert.ok(before.searchTop>=0 && before.searchTop<viewport.height,
        'search remains onscreen above long lists');
      assert.ok(before.listTop<viewport.height,'scrollable rows start inside viewport');
      if(viewport.desktop) {
        assert.notEqual(before.headDisplay,'none','desktop headings remain visible');
        assert.ok(before.headerTop>=0 && before.headerBottom<viewport.height,
          'desktop table headings stay visible');
        assert.equal(before.headingScrollGutter,before.bodyScrollGutter,
          'heading and list reserve matching scrollbar gutter');
        const h=before.headerCols.split(' ').map(parseFloat);
        const r=before.firstRowCols.split(' ').map(parseFloat);
        assert.ok(h.every((width,i)=>Math.abs(width-r[i])<1),
          'headers and rows remain column-aligned with native scrollbar');
      } else {
        assert.equal(before.headDisplay,'none','mobile retains labelled cards');
      }
      await page.evaluate(()=>{const list=document.querySelector('#libraryList');list.scrollTop=list.scrollHeight;});
      await page.waitForFunction(()=>document.querySelector('#libraryList')?.scrollTop>100);
      const after=await page.evaluate(()=>{
        const header=document.querySelector('#libraryTableHead');
        const list=document.querySelector('#libraryList');
        return {
          headerTop:header.getBoundingClientRect().top,
          actionsTop:document.querySelector('#libraryQueueSelectedBtn').getBoundingClientRect().top,
          searchTop:document.querySelector('#librarySearchInput').getBoundingClientRect().top,
          pageScroll:window.scrollY,
          listScroll:list.scrollTop,
          firstRowTop:list.querySelector('.library-file-row').getBoundingClientRect().top
        };
      });
      assert.equal(after.headerTop,before.headerTop,'heading must not move with rows');
      assert.equal(after.actionsTop,before.actionsTop,'toolbar must not move with rows');
      assert.equal(after.searchTop,before.searchTop,'search must not move with rows');
      assert.equal(after.pageScroll,before.pageScroll,'inner wheel should not move the page');
      assert.ok(after.firstRowTop<before.listTop,'file rows must move independently of heading');
      if(process.env.PFC_VISUAL_CAPTURE_DIR && viewport.desktop) {
        const out=path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR);
        await fs.mkdir(out,{recursive:true});
        await page.screenshot({path:path.join(out,
          'library-fixed-toolbar-'+theme+'-desktop.png'),fullPage:true});
      }
    }
  }
  await page.setViewportSize({width:1365,height:900});
  console.log('Chromium: Print Library fixed headings and actions, inner scrolling PASS');
}

// The library must distinguish file problems from a printer that is merely
// offline or printing, with consistent Preact badges and facet values.
async function libraryAvailabilityBadgeSmoke(page,url) {
  await page.setViewportSize({width:1365,height:900});
  await page.goto(url+'/library',{waitUntil:'load'});
  await preactReady(page);
  // The initial /api/library response is asynchronous. Wait until the
  // controller has published it before injecting synthetic badge cases,
  // otherwise that response can overwrite the fixture during CI.
  // The initial library response can update its visible summary before
  // Preact publishes the state snapshot. Either observable state is sufficient
  // to establish that the async refresh finished before inserting fixtures.
  await page.waitForFunction(()=>{
    const summary=window.__PFC_LIBRARY_UI_STATE__?.summary
      || document.querySelector('#librarySummary')?.textContent || '';
    return window.__PFC_PREACT_LIBRARY__===true
      && summary.includes('stored on this controller');
  });
  const endpoint=await page.evaluate(async()=>{
    const result=await fetch('/api/library/readiness');
    return {status:result.status,data:await result.json()};
  });
  assert.equal(endpoint.status,200);
  assert.ok(Array.isArray(endpoint.data.files),'status-only endpoint must be available');
  const cases=[
    ['ready','Ready now'],['offline','Printer offline'],['busy','Printer busy'],
    ['attention','Needs attention'],['incompatible','Incompatible']
  ];
  const files=cases.map(([level,label],i)=>({
    id:'availability-'+level,
    fileName:'Availability '+label+'.3mf',
    sizeText:'10 KB',description:'',
    printerTarget:'Any supported printer',requirements:'ASA · 0.4 mm',
    cost:{available:false,value:'Unavailable',detail:'No price'},
    colours:[],warning:'',previewUrl:'',
    readiness:{level,label,detail:level+' printer status preview'},
    historyCount:'0 completed prints',historyLast:'Not printed yet',
    historyAdded:'Added recently'
  }));
  await page.evaluate(files=>{
    document.querySelector('#libraryTableHead').hidden=false;
    window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{
      detail:{summary:'5 readiness cases',files,emptyText:'No files'}
    }));
  },files);
  await page.waitForFunction(()=>document.querySelectorAll('#libraryList .library-readiness').length===5);
  for(const [level,label] of cases){
    const badge=page.locator('[data-library-file="availability-'+level+'"] .library-readiness');
    assert.equal(await badge.innerText(),label);
    assert.ok((await badge.getAttribute('class')).includes('library-readiness-'+level));
    assert.match(await badge.getAttribute('title'),/printer status preview/);
    assert.equal(await badge.getAttribute('data-library-filter-readiness'),level);
    assert.equal(await badge.getAttribute('aria-label'),'Filter library by status: '+label);
  }
  const values=await page.locator('#libraryReadinessFilter option').evaluateAll(
    options=>options.map(option=>option.value));
  assert.ok(values.includes('offline') && values.includes('busy'),'availability filters must be offered');
  for(const theme of ['dark','light']){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    for(const level of ['busy','offline']){
      const badge=page.locator('[data-library-file="availability-'+level+'"] .library-readiness');
      const style=await badge.evaluate(element=>({
        bg:getComputedStyle(element).backgroundColor,
        color:getComputedStyle(element).color
      }));
      assert.ok(style.color && style.bg,'availability badge must use theme-aware styles');
    }
  }
  // Status chips use the same delegated facet handler as category/tag chips.
  // Real controller state may contain fewer matching files than this temporary
  // display fixture; all subsequently visible rows must match the selected
  // status, and the dropdown must expose the active filter.
  await page.locator('[data-library-file="availability-offline"] .library-readiness').click();
  assert.equal(await page.locator('#libraryReadinessFilter').inputValue(),'offline');
  assert.equal(await page.locator('#libraryAdvancedFilters').evaluate(element=>element.open),true);
  const displayed=await page.locator('#libraryList [data-library-file] .library-readiness').evaluateAll(
    items=>items.map(item=>item.dataset.libraryFilterReadiness));
  assert.ok(displayed.every(level=>level==='offline'),'click must show only matching readiness');
  await page.locator('#libraryClearFiltersBtn').click();
  assert.equal(await page.locator('#libraryReadinessFilter').inputValue(),'','clear filters must restore all statuses');

  // Also verify native keyboard activation, without selecting the file row.
  await page.evaluate(files=>window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{
    detail:{summary:'5 readiness cases',files,emptyText:'No files'}
  })),files);
  const keyboardBadge=page.locator('[data-library-file="availability-attention"] .library-readiness');
  await keyboardBadge.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#libraryReadinessFilter').inputValue(),'attention');
  assert.equal(await page.locator('#libraryQueueSelectedBtn').isDisabled(),true,
    'using status badges must not select a file');
  await page.locator('#libraryClearFiltersBtn').click();
  console.log('Chromium: Print Library readiness availability badges PASS');
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
  // Option D: measured rates get progress bars, informational metrics do not.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state', {
    detail:{...window.__PFC_REPORTING_UI_STATE__, kpis:[
      {label:'Total print jobs',value:'20',detail:'In selected period',tone:'info',iconName:'jobs',progressPercent:null},
      {label:'Completed',value:'17',detail:'85% completion rate',tone:'positive',iconName:'check',progressPercent:85,progressLabel:'Completion rate'},
      {label:'Failed',value:'2',detail:'10% failure rate',tone:'negative',iconName:'cross',progressPercent:10,progressLabel:'Failure rate'},
      {label:'Total run time',value:'31.5 h',detail:'Reported from print timestamps',tone:'info',iconName:'clock',progressPercent:null}
    ]}
  })));
  await page.waitForFunction(() => document.querySelectorAll('#reportingKpis .reporting-kpi-gauge').length === 4);
  assert.equal(await page.locator('#reportingKpis .reporting-kpi-meter').count(),2,
    'only rates should have progress bars');
  assert.equal(await page.locator('#reportingKpis .reporting-kpi-accent').count(),2,
    'count and runtime should have a decorative accent, not false progress');
  assert.equal(await page.locator('#reportingKpis [aria-label="Completion rate"]').getAttribute('aria-valuenow'),'85');
  assert.equal(await page.locator('#reportingKpis [aria-label="Failure rate"]').getAttribute('aria-valuenow'),'10');
  for (const theme of ['dark','light']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const palette=await page.locator('#reportingKpis .reporting-kpi').evaluateAll(
      cards=>cards.map(card=>({
        width:card.querySelector('.reporting-kpi-gauge').getBoundingClientRect().width,
        fill:getComputedStyle(card.querySelector('.reporting-kpi-icon')).color
      }))
    );
    assert.equal(palette.length,4);
    assert.ok(palette.every(p=>p.width>=50 && p.fill),'Option D rings visible in both themes');
    assert.notEqual(palette[1].fill,palette[2].fill,'success and failure should use different colours');
  }
  // Compare headline periods in the same layout, with a favourable decrease
  // in failures, neutral increase in total activity and missing-baseline state.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state', {
    detail:{...window.__PFC_REPORTING_UI_STATE__, kpis:[
      {label:'Total print jobs',value:'342',detail:'In selected period',
        tone:'info',iconName:'jobs',progressPercent:null,
        change:{symbol:'▲',label:'12.1%',tone:'neutral',caption:'vs previous period',description:'Increase of 12.1% vs previous period'}},
      {label:'Completed',value:'325',detail:'95% completion rate',
        tone:'positive',iconName:'check',progressPercent:95,progressLabel:'Completion rate',
        change:{symbol:'▲',label:'8.0%',tone:'positive',caption:'vs previous period',description:'Increase of 8.0% vs previous period'}},
      {label:'Failed',value:'17',detail:'5% failure rate',
        tone:'negative',iconName:'cross',progressPercent:5,progressLabel:'Failure rate',
        change:{symbol:'▼',label:'22.7%',tone:'positive',caption:'vs previous period',description:'Decrease of 22.7% vs previous period'}},
      {label:'Total run time',value:'412.6 h',detail:'Reported from print timestamps',
        tone:'info',iconName:'clock',progressPercent:null,
        change:{symbol:'',label:'—',tone:'muted',caption:'No previous period data',description:'No previous period data for selected printer filters'}}
    ]}
  })));
  await page.waitForFunction(() => document.querySelectorAll('#reportingKpis .reporting-kpi-change').length === 4);
  assert.equal(await page.locator('#reportingKpis .reporting-kpi-change').count(),4);
  const deltas=await page.locator('#reportingKpis .reporting-kpi-change').evaluateAll(
    nodes=>nodes.map(node=>({
      value:node.querySelector('.reporting-kpi-change-value').textContent,
      caption:node.querySelector('.reporting-kpi-change-caption').textContent,
      className:node.className,
      title:node.getAttribute('title')
    }))
  );
  assert.match(deltas[0].value,/▲12.1%/);
  assert.match(deltas[0].className,/neutral/);
  assert.match(deltas[1].value,/▲8.0%/);
  assert.match(deltas[1].className,/positive/);
  assert.match(deltas[2].value,/▼22.7%/);
  assert.match(deltas[2].className,/positive/);
  assert.equal(deltas[3].caption,'No previous period data');
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const colors=await page.locator('#reportingKpis .reporting-kpi-change').evaluateAll(
      nodes=>nodes.map(node=>getComputedStyle(node).color)
    );
    assert.notEqual(colors[0],colors[1],'neutral and positive delta colours must differ');
  }
  // Sparse production history: all three jobs completed on one date.
  // The previous SVG contained only a move command and rendered no line.
  await page.evaluate(() => {
    // Rendering receives its chart view model through the existing event
    // bridge. The pure view-model algorithm is covered in reporting-ui tests.
    const chart = {
      rows:Array.from({ length:8 }, (_, index) => ({
        date:'2026-10-' + String(14 + index).padStart(2, '0'),
        completed:index === 6 ? 3 : 0, failed:0, cancelled:0
      })),
      grid:[{ x1:42, x2:742, y:196, labelX:34, labelY:200, label:0 }],
      labels:[{x:42,y:221,text:'14 Oct'},{x:742,y:221,text:'21 Oct'}],
      viewBox:'0 0 760 230',
      completedPath:'M 42 196 L 142 196 L 242 196 L 342 196 L 442 196 L 542 196 L 642 18 L 742 196',
      failedPath:'', cancelledPath:'',
      points:[{ x:642, y:18, key:'completed', date:'2026-10-20',
        value:3, title:'2026-10-20: 3 completed' }],
      showPointValues:true
    };
    window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state', {
      detail:{ ...window.__PFC_REPORTING_UI_STATE__, chart }
    }));
  });
  await page.waitForFunction(() =>
    document.querySelectorAll('#reportingTrend .reporting-point.completed').length === 1
    && document.querySelector('#reportingTrend .reporting-point-value.completed')?.textContent === '3'
  );
  assert.match(await page.locator('#reportingTrend .reporting-point.completed title').textContent(),
    /2026-10-20: 3 completed/, 'a sparse daily chart must show its real completed count');
  assert.equal(await page.locator('#reportingTrend .reporting-axis-text').first().textContent(), '0',
    'the chart must start at zero');
  // Validate the physical desktop geometry, not merely CSS class names.
  // Inject one synthetic view row so even an empty reporting fixture tests real table width.
  await page.setViewportSize({width:1365,height:900});
  await page.evaluate(() => {
    const state = window.__PFC_REPORTING_UI_STATE__ || {};
    window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state', { detail:{
      ...state,
      files:[{
        id:'layout-check',rank:1,fileName:'Regression layout sample.3mf',
        libraryFileId:null,previewUrl:'',completed:10,failed:0,
        successRate:'100%',materialText:'0.45 kg',materialCostText:'£6.00',
        materialPartial:false,materialCostPartial:false,
        materialTitle:'Recorded for 10 of 10 completed jobs',
        costTitle:'Recorded £6.00 for 10 jobs',
        printTime:'2h 0m',printTimePartial:false,printTimeTitle:'2 hours recorded'
      }]
    }}));
  });
  await page.waitForFunction(() => !!document.querySelector('#reportingFiles .reporting-table-scroll'));
  assert.equal(await page.locator('#reportingFiles .reporting-analytics-table thead th').count(),8);
  assert.match(await page.locator('#reportingFiles .reporting-file-material').innerText(),/0\.45 kg/);
  assert.match(await page.locator('#reportingFiles .reporting-file-cost').innerText(),/£6\.00/);
  assert.equal(await page.locator('#reportingFiles .reporting-analytics-table tbody tr').first().locator('td').count(),8,
    'Material and Cost must occupy distinct table cells');
  const resourceColumns = await page.locator('#reportingFiles .reporting-analytics-table').evaluate(table => {
    const head=[...table.querySelectorAll('thead th')], row=[...table.querySelectorAll('tbody tr:first-child td')];
    const left=n=>n.getBoundingClientRect().left;
    return {materialHeader:head[5].innerText,costHeader:head[6].innerText,
      headingDelta:left(head[6])-left(head[5]),valueDelta:left(row[6])-left(row[5])};
  });
  assert.match(resourceColumns.materialHeader,/Material/i);
  assert.match(resourceColumns.costHeader,/Cost/i);
  assert.ok(resourceColumns.headingDelta>40 && resourceColumns.valueDelta>40,
    'resource cells must be side by side, not stacked in one column');
  assert.match(await page.locator('#reportingFiles .reporting-file-time').innerText(),/2h 0m/);
  assert.equal(await page.locator('#reportingFiles .reporting-progress').count(),0,
    'completed count must not also be duplicated as a popularity bar');
  // Compare the real Most popular print files table against the controller's
  // shared printer-group table style in BOTH themes (no screenshot guessing).
  const fileTableTheme = await page.evaluate(() => {
    const fixture=document.createElement('div');
    fixture.style.cssText='position:fixed;left:-5000px;top:0;';
    fixture.innerHTML='<div class="printer-group-members"><table class="printer-group-members-table">'
      +'<thead><tr><th>File</th></tr></thead><tbody><tr><td>Print file</td></tr></tbody>'
      +'</table></div>';
    document.body.appendChild(fixture);
    const root=document.documentElement,original=root.getAttribute('data-theme');
    const get=(node)=> {
      const st=getComputedStyle(node);
      return {background:st.backgroundColor,color:st.color,fontSize:st.fontSize,
        fontWeight:st.fontWeight,spacing:st.letterSpacing,transform:st.textTransform,
        borderTop:st.borderTopColor,borderBottom:st.borderBottomColor,
        borderBottomWidth:st.borderBottomWidth, divider:st.getPropertyValue('--pfc-table-divider').trim(),
        radius:st.borderTopLeftRadius,borderRight:st.borderRightWidth};
    };
    const state={};
    try {
      for(const theme of ['dark','light']) {
        root.setAttribute('data-theme',theme);
        const report=document.querySelector('#reportingFiles');
        const ours={
          panel:get(report.querySelector('.reporting-table-scroll')),
          heading:get(report.querySelector('thead th')),
          firstCell:get(report.querySelector('tbody td'))
        };
        const reference={
          panel:get(fixture.querySelector('.printer-group-members')),
          heading:get(fixture.querySelector('thead th')),
          firstCell:get(fixture.querySelector('tbody td'))
        };
        state[theme]={ours,reference};
      }
    } finally {
      if(original===null)root.removeAttribute('data-theme');
      else root.setAttribute('data-theme',original);
      fixture.remove();
    }
    return state;
  });
  for (const [theme,{ours,reference}] of Object.entries(fileTableTheme)) {
    for (const prop of ['background','borderTop','radius'])
      assert.equal(ours.panel[prop],reference.panel[prop],
        theme+' file table should use the controller panel '+prop);
    for (const prop of ['background','color','fontSize','fontWeight','spacing','transform','borderBottom','borderRight'])
      assert.equal(ours.heading[prop],reference.heading[prop],
        theme+' file table heading should match controller '+prop);
    // The synthetic file table has one row, so both this cell and the group
    // fixture's last row omit their divider. The computed border colour would
    // fall back to currentColor and differ by cell text; check the actual
    // divider token plus no-border final-row geometry instead.
    assert.equal(ours.firstCell.divider,reference.firstCell.divider,
      theme+' file table uses the same row separator token');
    assert.equal(ours.firstCell.borderBottomWidth,reference.firstCell.borderBottomWidth,
      theme+' file table last row must omit its bottom border');
    assert.equal(ours.firstCell.borderRight,'0px',
      theme+' file table body should not contain isolated vertical gridlines');
  }
  // Material usage table shares printer-group table skin (both modes and
  // themes). Keep the actual data cells, 100% total and progress bars intact.
  for (const [mode, label] of [['type','ASA'],['filament','Example · ASA-CF · ASA']]) {
    await page.evaluate(({mode,label})=>{
      const base=window.__PFC_REPORTING_UI_STATE__ || {};
      window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state',{detail:{
        ...base,materialMode:mode,
        // Keep the earlier file-geometry fixture in Preact state: dispatching
        // this custom event replaces the entire view model, not just materials.
        files:[{
          id:'layout-check',rank:1,fileName:'Regression layout sample.3mf',
          libraryFileId:null,previewUrl:'',completed:10,failed:0,
          successRate:'100%',materialText:'0.45 kg',materialCostText:'£6.00',
          materialPartial:false,materialCostPartial:false,
          materialTitle:'Recorded for 10 of 10 completed jobs',
          costTitle:'Recorded £6.00 for 10 jobs',
          printTime:'2h 0m',printTimePartial:false,printTimeTitle:'2 hours recorded'
        }],
        materials:{rows:[
          {key:'sample',label,note:'Historical materials sample',
            kg:'1.50',percentage:'75.0%',percent:75,cost:'£19.50'},
          {key:'sample2',label:'PLA',note:'',kg:'0.50',
            percentage:'25.0%',percent:25,cost:'£4.50'}
        ],totalKg:'2.00',totalCost:'£24.00'}
      }}));
    },{mode,label});
    await page.waitForFunction((materialLabel) =>
      document.querySelector('#reportingMaterials tbody tr td')?.textContent === materialLabel,label);
    const styling=await page.evaluate(()=>{
      const fixture=document.createElement('div');
      fixture.style.cssText='position:fixed;left:-5000px;top:0';
      fixture.innerHTML='<div class="printer-group-members"><table class="printer-group-members-table">'
        +'<thead><tr><th>Material</th></tr></thead><tbody><tr><td>Material</td></tr></tbody></table></div>';
      document.body.appendChild(fixture);
      const original=document.documentElement.getAttribute('data-theme');
      const props=node=>{
        const s=getComputedStyle(node);
        return {bg:s.backgroundColor,color:s.color,fontSize:s.fontSize,
          fontWeight:s.fontWeight,letterSpacing:s.letterSpacing,
          textTransform:s.textTransform,borderRadius:s.borderTopLeftRadius,
          borderColor:s.borderTopColor,borderBottom:s.borderBottomColor,
          borderWidth:s.borderRightWidth,divider:s.getPropertyValue('--pfc-table-divider').trim()};
      };
      const output={};
      try {
        for(const theme of ['dark','light']){
          document.documentElement.setAttribute('data-theme',theme);
          output[theme]={
            ours:{
              panel:props(document.querySelector('#reportingMaterials .reporting-table-scroll')),
              heading:props(document.querySelector('#reportingMaterials thead th')),
              row:props(document.querySelector('#reportingMaterials tbody td')),
              footer:props(document.querySelector('#reportingMaterials tfoot th'))
            },
            ref:{
              panel:props(fixture.querySelector('.printer-group-members')),
              heading:props(fixture.querySelector('thead th')),
              row:props(fixture.querySelector('tbody td'))
            }
          };
        }
      } finally {
        if(original===null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme',original);
        fixture.remove();
      }
      return output;
    });
    for(const [theme,{ours,ref}] of Object.entries(styling)){
      for(const prop of ['bg','borderColor','borderRadius'])
        assert.equal(ours.panel[prop],ref.panel[prop],
          mode+' '+theme+' Material usage surface must match shared table '+prop);
      for(const prop of ['bg','color','fontSize','fontWeight','letterSpacing','textTransform','borderBottom','borderWidth'])
        assert.equal(ours.heading[prop],ref.heading[prop],
          mode+' '+theme+' Material usage header must match shared table '+prop);
      assert.equal(ours.row.divider,ref.row.divider,
        mode+' '+theme+' Material usage divider must match shared table token');
      assert.equal(ours.row.borderWidth,'0px',mode+' '+theme+' no vertical cell borders');
      assert.equal(ours.footer.bg,ours.panel.bg,mode+' '+theme+' totals use shared table surface');
    }
    const count=await page.locator('#reportingMaterials tbody tr').count();
    assert.equal(count,2,mode+' retains historical usage rows');
    assert.equal(await page.locator('#reportingMaterials tfoot .numeric').first().textContent(),'2.00');
    assert.equal(await page.locator('#reportingMaterials tfoot .numeric').nth(1).textContent(),'100%');
    assert.equal(await page.locator('#reportingMaterials tfoot .numeric').nth(2).textContent(),'£24.00');
    assert.equal(await page.locator('#reportingMaterials .reporting-progress').count(),2,
      mode+' must retain material usage progress bars');
    assert.ok((await page.locator('#reportingMaterials .numeric').count())>=6,
      mode+' must preserve numeric column alignment');
  }
  // Both remaining Analytics tables must match the established Printer Groups
  // table standard in both themes, including row-header (th) cells.
  await page.evaluate(() => {
    const state=window.__PFC_REPORTING_UI_STATE__ || {};
    window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state',{detail:{
      ...state,
      files:[{id:'layout-check',rank:1,fileName:'Regression layout sample.3mf',
        libraryFileId:null,previewUrl:'',completed:10,failed:0,successRate:'100%',
        materialText:'0.45 kg',materialCostText:'£6.00',materialTitle:'Measured grams',
        costTitle:'Historical GBP',printTime:'2h 0m',printTimeTitle:'Recorded time'}],
      printers:[{id:'printer-a',name:'Sample Printer A',attempts:8,completed:5,
        failed:3,failureRate:'37.5%',trend:'Worsening',latestFailure:'Today',
        attention:['Failure rate high']},
        {id:'printer-b',name:'Sample Printer B',attempts:4,completed:3,
        failed:1,failureRate:'25%',trend:'Stable',latestFailure:'Yesterday',
        attention:['Failed job']}],
      printerActivity:true,
      fileFailures:[{id:'failure-a',fileName:'Test failure.3mf',attempts:5,
        failed:2,failureRate:'40%',lastFailure:'Today'},
        {id:'failure-b',fileName:'Test failure B.3mf',attempts:2,
        failed:1,failureRate:'50%',lastFailure:'Yesterday'}]
    }}));
  });
  await page.waitForFunction(() =>
    document.querySelectorAll('#reportingPrinters tbody tr').length===2 &&
    document.querySelectorAll('#reportingFileFailures tbody tr').length===2);
  const otherTableStyles=await page.evaluate(() => {
    const fixture=document.createElement('div');
    fixture.style.cssText='position:fixed;left:-5000px;top:0;';
    fixture.innerHTML='<div class="printer-group-members"><table class="printer-group-members-table">'
      +'<thead><tr><th>Printer</th></tr></thead><tbody><tr><td>First</td></tr>'
      +'<tr><td>Second</td></tr></tbody></table></div>';
    document.body.appendChild(fixture);
    const root=document.documentElement,old=root.getAttribute('data-theme');
    const props=el=>{
      const st=getComputedStyle(el);
      return {bg:st.backgroundColor,color:st.color,size:st.fontSize,
        weight:st.fontWeight,spacing:st.letterSpacing,upper:st.textTransform,
        radius:st.borderTopLeftRadius,border:st.borderTopColor,
        divider:st.borderBottomColor,bottom:st.borderBottomWidth,
        right:st.borderRightWidth,padding:st.padding};
    };
    const output={};
    try{
      for(const theme of ['dark','light']){
        root.setAttribute('data-theme',theme);
        const ref={
          panel:props(fixture.querySelector('.printer-group-members')),
          header:props(fixture.querySelector('thead th')),
          body:props(fixture.querySelector('tbody tr:first-child td')),
          final:props(fixture.querySelector('tbody tr:last-child td'))
        };
        output[theme]={ref,tables:{}};
        for(const id of ['reportingPrinters','reportingFileFailures']){
          const el=document.getElementById(id);
          output[theme].tables[id]={
            panel:props(el.querySelector('.reporting-table-scroll')),
            header:props(el.querySelector('thead th')),
            body:props(el.querySelector('tbody tr:first-child > :first-child')),
            final:props(el.querySelector('tbody tr:last-child > :first-child')),
            hover:getComputedStyle(el).getPropertyValue('--pfc-table-hover').trim()
          };
        }
      }
    }finally{
      if(old===null)root.removeAttribute('data-theme');
      else root.setAttribute('data-theme',old);
      fixture.remove();
    }
    return output;
  });
  for(const [theme,{ref,tables}] of Object.entries(otherTableStyles)){
    for(const [id,t] of Object.entries(tables)){
      for(const prop of ['bg','radius','border'])
        assert.equal(t.panel[prop],ref.panel[prop],theme+' '+id+' panel '+prop);
      for(const prop of ['bg','color','size','weight','spacing','upper','divider','right','padding'])
        assert.equal(t.header[prop],ref.header[prop],theme+' '+id+' heading '+prop);
      for(const prop of ['bottom','right','padding'])
        assert.equal(t.body[prop],ref.body[prop],theme+' '+id+' first-row '+prop);
      assert.equal(t.final.bottom,ref.final.bottom,theme+' '+id+' final-row divider');
      assert.ok(t.hover,theme+' '+id+' inherits hover token');
    }
  }
  const reportingLayout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const scroll = document.querySelector('#reportingFiles .reporting-table-scroll');
    return {
      statsBottom:box('#reportingKpis').bottom,
      chartTop:box('.reporting-analytics-trend').top,
      chartBottom:box('.reporting-analytics-trend').bottom,
      filesTop:box('.reporting-analytics-files').top,
      fileCardWidth:box('.reporting-analytics-files').width,
      fileTableWidth:scroll.getBoundingClientRect().width,
      tableOverhang:scroll.scrollWidth - scroll.clientWidth
    };
  });
  assert.ok(reportingLayout.chartTop >= reportingLayout.statsBottom - 1,
    'Main trend graph must follow headline KPI cards');
  assert.ok(reportingLayout.filesTop >= reportingLayout.chartBottom - 1,
    'Most popular files must follow the trend graph');
  assert.ok(reportingLayout.fileTableWidth >= reportingLayout.fileCardWidth - 40,
    'Print file table must fill its section, not stop at a fixed narrow width');
  assert.ok(reportingLayout.tableOverhang <= 2,
    'Desktop print file table must not require horizontal scrolling');
  // This fixture is sent directly to Preact, not injected into the server's
  // persisted report. Confirm that accessible sort controls are rendered;
  // the executable reporting UI tests cover actual ordering and direction.
  for (const key of ['runSeconds','materialGrams','materialCost']) {
    const button=page.locator('#reportingFiles [data-reporting-file-sort="'+key+'"]');
    assert.equal(await button.count(),1,'sortable resource column '+key+' must be rendered');
    assert.equal(await button.getAttribute('aria-pressed'),'false');
  }
  await page.locator('[data-reporting-files-scope="all"]').click();
  assert.equal(await page.locator('[data-reporting-files-scope="all"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-reporting-files-scope="top10"]').click();
  assert.equal(await page.locator('[data-reporting-files-scope="top10"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-reporting-material-mode="filament"]').click();
  assert.equal(await page.locator('[data-reporting-material-mode="filament"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-reporting-material-mode="type"]').click();
  assert.equal(await page.locator('[data-reporting-material-mode="type"]').getAttribute('aria-pressed'),'true');
  // Segmented table selectors are 2-choice groups, not the Dashboard's
  // boolean role=switch. Verify accessible state and token-driven appearance.
  const segmentedStyles=await page.evaluate(()=>{
    const root=document.documentElement;
    const original=root.getAttribute('data-theme');
    const output={};
    try {
      for(const theme of ['dark','light']){
        root.setAttribute('data-theme',theme);
        output[theme]=[...document.querySelectorAll('.reporting-segmented')].map(group=>{
          const btns=[...group.querySelectorAll('button')];
          const styles=btns.map(btn=>getComputedStyle(btn));
          const s=getComputedStyle(group);
          return {
            role:group.getAttribute('role'),label:group.getAttribute('aria-label'),
            pressed:btns.map(btn=>btn.getAttribute('aria-pressed')),
            height:btns.map(btn=>btn.getBoundingClientRect().height),
            borders:btns.map((_,i)=>styles[i].borderTopWidth),
            selected:styles[0].backgroundColor,other:styles[1].backgroundColor,
            selectedColor:styles[0].color,otherColor:styles[1].color,
            brandStrong:s.getPropertyValue('--ds-brand-strong').trim(),
            focus:s.getPropertyValue('--ds-focus').trim()
          };
        });
      }
    } finally {
      if(original===null)root.removeAttribute('data-theme');
      else root.setAttribute('data-theme',original);
    }
    return output;
  });
  for(const [theme,groups] of Object.entries(segmentedStyles)){
    assert.equal(groups.length,2,theme+' expects two reporting choice groups');
    for(const group of groups){
      assert.equal(group.role,'group',theme+' segmented choice is not a boolean switch');
      assert.ok(group.label,theme+' segmented choice must have an accessible label');
      assert.deepEqual(group.pressed,['true','false'],
        theme+' exactly one choice must be active');
      assert.ok(group.height.every(height=>height>=42),
        theme+' segmented controls must use the standard 42px target');
      assert.notEqual(group.selected,group.other,
        theme+' selected and inactive controls must look different');
      assert.notEqual(group.selectedColor,group.otherColor,
        theme+' selected choice must have visibly different text');
    }
  }
  await page.reload({waitUntil:'load'});
  await reportsLoaded(page,'refreshed report');
  await page.locator('[data-reporting-tab="filament"]').click();
  await page.waitForFunction(()=>document.querySelector('#reportingPanelFilament')?.hidden===false);
  await page.locator('[data-reporting-tab="pricing"]').click();
  await page.waitForFunction(()=>document.querySelector('#reportingPanelPricing')?.hidden===false);
  await page.waitForFunction(()=>document.querySelector('#reportingPricingFields')?.disabled===false);
  await page.locator('[data-reporting-tab="analytics"]').click();
  await page.waitForFunction(()=>document.querySelector('#reportingPanelAnalytics')?.hidden===false);
  // Leave a visible scroll gutter after the final failure-analysis card.
  // This is page spacing, not extra height or a border on the card itself.
  for (const [width, height, minSpace] of [[1365, 900, 32], [390, 844, 24]]) {
    await page.setViewportSize({ width, height });
    const clearance = await page.evaluate(() => {
      const panel = document.querySelector('#reportingPanelAnalytics');
      const lastCard = panel.querySelector('.reporting-analytics-failures');
      return {
        padding:parseFloat(getComputedStyle(panel).paddingBottom),
        gap:panel.getBoundingClientRect().bottom - lastCard.getBoundingClientRect().bottom,
        overflow:document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight
      };
    });
    assert.ok(clearance.padding >= minSpace, 'Analytics tab must provide a bottom gutter');
    assert.ok(clearance.gap >= minSpace - 1,
      'Failure-analysis border needs clearance from the end of the Analytics page');
    assert.ok(clearance.overflow > 0, 'Reporting page must remain vertically scrollable');
  }
  await page.setViewportSize({width:1365,height:900});

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

// Guidance under the nozzle Assign action should begin at the same
// vertical offset as guidance under Set filament. The generic nozzle
// wrapper otherwise overrides the shared .field-help margin by 13px.
// All four-column Toolheads tables keep the two actions on the same row,
// irrespective of the generic designation control's legacy label margins.
async function checkToolheadButtonAlignment(page,name,{filamentMode,nozzleMode}) {
  const geometry=await page.evaluate(({filamentMode,nozzleMode})=>{
    const row=document.querySelector('#printerDialog #detailTabToolheads .material-tool-row');
    const measure=(mode)=>{
      const form=row?.querySelector(`[data-preact-toolhead-editor="${mode}"]`);
      const button=form?.querySelector('[data-toolhead-save]');
      const select=form?.querySelector('select');
      const label=form?.querySelector('label');
      const pair=form?.querySelector('.toolhead-dropdown-pair');
      const rect=(e)=>e?.getBoundingClientRect().toJSON()??null;
      return {
        form:rect(form),pair:rect(pair),label:rect(label),
        colorLabel:rect(form?.querySelector('.toolhead-dropdown-pair > label:nth-child(2)')),
        colorBox:rect(form?.querySelector('.color-family-dropdown')),
        colorSummary:rect(form?.querySelector('.color-family-dropdown summary')),
        select:rect(select),action:rect(button),
        top:button?.getBoundingClientRect().top??null,
        bottom:button?.getBoundingClientRect().bottom??null,
        fieldBottom:select?.getBoundingClientRect().bottom??null,
        labelMargin:label?getComputedStyle(label).marginBottom:null,
        labelFont:label?getComputedStyle(label).fontSize:null,
        fieldMargin:select?getComputedStyle(select).marginTop:null
      };
    };
    return {filament:measure(filamentMode),nozzle:measure(nozzleMode)};
  },{filamentMode,nozzleMode});
  const {filament,nozzle}=geometry;
  for(const [kind,action] of Object.entries(geometry)) {
    assert.ok(action.top!==null&&action.bottom!==null,
      name+' must show '+kind+' button: '+JSON.stringify(geometry));
  }
  assert.ok(Math.abs(filament.top-nozzle.top)<=2
    &&Math.abs(filament.bottom-nozzle.bottom)<=2,
    name+' Set filament and Assign buttons must be vertically aligned: '+JSON.stringify(geometry));
  assert.ok(Math.abs(filament.fieldBottom-nozzle.fieldBottom)<=2,
    name+' material and nozzle dropdowns must have aligned bottoms: '+JSON.stringify(geometry));
  return geometry;
}

async function checkToolheadHelpAlignment(page,name,{filamentMode,nozzleMode}) {
  const measurement=await page.evaluate(({filamentMode,nozzleMode})=>{
    const row=document.querySelector('#printerDialog #detailTabToolheads .material-tool-row');
    const metrics=(mode)=>{
      const form=row?.querySelector(`[data-preact-toolhead-editor="${mode}"]`);
      const action=form?.querySelector('[data-toolhead-save]');
      const help=form?.querySelector(':scope > .field-help');
      return {
        buttonBottom:action?.getBoundingClientRect().bottom??null,
        helpTop:help?.getBoundingClientRect().top??null,
        helpMargin:help?getComputedStyle(help).marginTop:null
      };
    };
    return {filament:metrics(filamentMode),nozzle:metrics(nozzleMode)};
  },{filamentMode,nozzleMode});
  const {filament,nozzle}=measurement;
  for (const [kind,part] of Object.entries(measurement)) {
    assert.ok(part.buttonBottom!==null&&part.helpTop!==null,
      name+' '+kind+' button and helper must be visible: '+JSON.stringify(measurement));
    assert.equal(part.helpMargin,'-5px',
      name+' '+kind+' helper must have the same top margin');
  }
  const filamentGap=filament.helpTop-filament.buttonBottom;
  const nozzleGap=nozzle.helpTop-nozzle.buttonBottom;
  assert.ok(Math.abs(filamentGap-nozzleGap)<=2,
    name+' guidance must start at the same offset beneath each button: '+JSON.stringify(measurement));
  assert.ok(Math.abs(filament.helpTop-nozzle.helpTop)<=2,
    name+' filament/nozzle help text must have aligned top edges: '+JSON.stringify(measurement));
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

    // Phase 4: the printer dialog uses theme tokens, identifies the actual
    // model and maintains a single-row, keyboard-accessible tab rail on mobile.
    // These checks run against the real Preact component and AD5M simulator.
    const detailDesktop=await page.evaluate(()=>{
      const dialog=document.querySelector('#printerDialog');
      const tabs=[...dialog.querySelectorAll('[data-detail-tab]')];
      const panels=[...dialog.querySelectorAll('[data-detail-panel]')];
      const heading=dialog.querySelector('[data-detail-name]');
      const context=dialog.querySelector('.printer-detail-context');
      return {
        heading:heading?.textContent,
        model:context?.querySelector('.printer-detail-model')?.textContent,
        host:context?.querySelector('.printer-detail-host')?.textContent,
        thumbnail:dialog.querySelector('.printer-detail-thumbnail img')?.getAttribute('src'),
        headerFacts:[...dialog.querySelectorAll('.printer-detail-fact')].map(node=>({
          kind:node.dataset.detailFact,
          value:node.querySelector('.printer-detail-fact-value')?.textContent?.trim(),
          hasIcon:(getComputedStyle(node,'::before').maskImage||'').includes('data:image/svg+xml')
        })),
        tabs:tabs.map((tab)=>({
          name:tab.dataset.detailTab,
          panel:tab.getAttribute('aria-controls'),
          labelled:document.getElementById(tab.getAttribute('aria-controls'))
            ?.getAttribute('aria-labelledby')===tab.id,
          hasOutlineIcon:(getComputedStyle(tab,'::before').maskImage||'').includes('data:image/svg+xml'),
          label:tab.textContent.trim(),
          fullLabel:tab.getAttribute('aria-label')
        })),
        navigationBackground:getComputedStyle(dialog.querySelector('.printer-detail-tabs')).backgroundColor,
        activeTabStyle:(()=>{
          const active=tabs.find(tab=>tab.getAttribute('aria-selected')==='true');
          const style=getComputedStyle(active);
          return {
            underline:style.borderBottomWidth,
            underlineColor:style.borderBottomColor,
            labelColor:style.color,
            background:style.backgroundColor
          };
        })(),
        panels:panels.length,
        shellBackground:getComputedStyle(dialog).backgroundColor,
        token:getComputedStyle(document.documentElement).getPropertyValue('--ds-page').trim()
      };
    });
    assert.ok(detailDesktop.heading?.length&&detailDesktop.model?.length&&detailDesktop.host?.length,
      'Printer Details hero must show name, model and connection');
    assert.ok(detailDesktop.thumbnail?.startsWith('/assets/printers/'),
      'real printer header must show its local model image, not a remote asset');
    assert.deepEqual(detailDesktop.headerFacts.map(f=>f.kind),
      ['model','connection','host','uptime','firmware','health'],
      'printer identity shows the six available mockup-style metadata fields');
    assert.ok(detailDesktop.headerFacts.every(f=>f.hasIcon),
      'all header metadata rows have monochrome outline icons');
    assert.ok(detailDesktop.headerFacts.every(f=>f.value?.length),
      'missing firmware/uptime should show honest unavailable values');
    assert.equal(detailDesktop.tabs.length,6,'all six detail tabs remain available');
    assert.equal(detailDesktop.panels,6,'all detail panels remain available');
    assert.ok(detailDesktop.tabs.every((tab)=>tab.labelled),
      'ARIA tab and panel IDs must correspond');
    assert.ok(detailDesktop.tabs.every((tab)=>tab.hasOutlineIcon),
      'all six minimal navigation tabs must display their monochrome outline icons');
    assert.equal(detailDesktop.tabs.find(tab=>tab.name==='temperature')?.label,'Temperature');
    assert.equal(detailDesktop.tabs.find(tab=>tab.name==='management')?.label,'Management');
    assert.equal(detailDesktop.tabs.find(tab=>tab.name==='temperature')?.fullLabel,'Temperature, Preheat & Fans');
    assert.equal(detailDesktop.tabs.find(tab=>tab.name==='management')?.fullLabel,'Maintenance & Management');
    assert.ok(parseFloat(detailDesktop.activeTabStyle.underline)>=2,
      'selected Printer Details tab must have a visible bottom underline');
    assert.equal(detailDesktop.activeTabStyle.underlineColor,detailDesktop.activeTabStyle.labelColor,
      'selected tab icon, text and underline should share the brand colour');
    assert.equal(detailDesktop.activeTabStyle.background,'rgba(0, 0, 0, 0)',
      'selected tab should not use filled segmented-button styling');
    assert.equal(detailDesktop.navigationBackground,'rgba(0, 0, 0, 0)',
      'tab rail should remain a minimal transparent navigation strip');
    assert.ok(detailDesktop.token,'dialog must load the shared design tokens');

    const detailCaptureDir=process.env.PFC_VISUAL_CAPTURE_DIR
      ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR) : null;
    if(detailCaptureDir){
      await fs.mkdir(detailCaptureDir,{recursive:true});
      await page.screenshot({path:path.join(detailCaptureDir,'printer-details-phase4-dark-desktop.png')});
    }
    const initialTheme=await page.evaluate(()=>document.documentElement.dataset.theme||'dark');
    await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    const lightSurface=await page.evaluate(()=>getComputedStyle(
      document.querySelector('#printerDialog .printer-detail-tab-panel > .panel')).backgroundColor);
    assert.ok(lightSurface&&lightSurface!=='rgba(0, 0, 0, 0)',
      'light theme must colour the detail panel surface');
    if(detailCaptureDir){
      await page.screenshot({path:path.join(detailCaptureDir,'printer-details-phase4-light-desktop.png')});
    }
    await page.setViewportSize({width:390,height:844});
    const mobileTabs=await page.evaluate(()=>{
      const nav=document.querySelector('#printerDialog .printer-detail-tabs');
      const buttons=[...nav.querySelectorAll('[data-detail-tab]')];
      return {
        scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth,
        rows:Math.max(...buttons.map((button)=>button.getBoundingClientRect().top))
          -Math.min(...buttons.map((button)=>button.getBoundingClientRect().top)),
        closeWidth:document.querySelector('#printerDialog [data-detail-close]')
          ?.getBoundingClientRect().width,
        selected:buttons.filter((button)=>button.getAttribute('aria-selected')==='true').length
      };
    });
    assert.ok(mobileTabs.scrollWidth>mobileTabs.clientWidth,
      'mobile detail tab rail should scroll horizontally instead of stacking six rows');
    assert.ok(mobileTabs.rows<=2,'all mobile tabs should occupy one row');
    assert.ok(mobileTabs.closeWidth>=42,'mobile close target should be accessible');
    assert.equal(mobileTabs.selected,1,'one detail tab remains selected');
    await page.locator('#printerDialog [data-detail-tab="toolheads"]').focus();
    await page.keyboard.press('End');
    await page.waitForFunction(()=>
      document.querySelector('#printerDialog [data-detail-tab="management"]')
        ?.getAttribute('aria-selected')==='true');
    await page.keyboard.press('Home');
    await page.waitForFunction(()=>
      document.querySelector('#printerDialog [data-detail-tab="toolheads"]')
        ?.getAttribute('aria-selected')==='true');
    if(detailCaptureDir){
      await page.screenshot({path:path.join(detailCaptureDir,'printer-details-phase4-light-mobile.png')});
    }
    await page.setViewportSize({width:1365,height:900});
    await page.evaluate((theme)=>{document.documentElement.dataset.theme=theme;},initialTheme);
    await materialEditor.waitFor({state:'visible'});
    console.log('Chromium: Phase 4 Printer Details desktop/mobile and keyboard PASS');

    await checkToolheadFieldAlignment(page,'Flashforge AD5M Pro',{
      filamentMode:'controller-filament',nozzleMode:'controller-nozzle'
    });
    await checkToolheadButtonAlignment(page,'Flashforge AD5M Pro',{
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
    await page.locator('#printerDialog [data-preact-toolhead-editor="controller-nozzle"]')
      .waitFor({state:'visible',timeout:15000});
    await checkToolheadFieldAlignment(page,'Prusa CORE One+ Standard',{
      filamentMode:'prusa-filament',nozzleMode:'controller-nozzle'
    });
    await checkToolheadHelpAlignment(page,'Prusa CORE One+ Standard',{
      filamentMode:'prusa-filament',nozzleMode:'controller-nozzle'
    });
    const coreOneLayout=await page.evaluate(()=>{
      const panel=document.querySelector('#printerDialog #detailTabToolheads .material-panel');
      const row=panel?.querySelector('.material-tool-row[data-material-tool="0"]');
      return {
        table:panel?.querySelector('.material-grid')?.classList.contains('multi-tool-table'),
        rows:panel?.querySelectorAll('.material-tool-row').length,
        columns:row?.children.length,
        filament:!!row?.querySelector('.material-tool-configuration [data-preact-toolhead-control="prusa-filament"]'),
        nozzle:!!row?.querySelector('.material-tool-nozzle [data-preact-toolhead-control="controller-nozzle"]'),
        extraNozzle:panel?.querySelectorAll('[data-preact-toolhead-control="controller-nozzle"]').length
      };
    });
    assert.equal(coreOneLayout.table,true,'CORE One+ Standard uses the shared full-width table');
    assert.equal(coreOneLayout.rows,1,'CORE One+ Standard has a single T0 row');
    assert.equal(coreOneLayout.columns,4,'CORE One+ Standard displays four aligned columns');
    assert.ok(coreOneLayout.filament&&coreOneLayout.nozzle,
      'filament and nozzle selectors occupy the same T0 table row');
    assert.equal(coreOneLayout.extraNozzle,1,
      'the single-nozzle configuration is not duplicated below the table');
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
    // Changing the CORE One+ installed system must rebuild the open dialog,
    // rather than forcing the operator to close/reopen it. Exercise all three
    // configurations using the isolated protocol-backed printer, including
    // the short interval where the new controller limits precede live polling.
    page.on('dialog',(dialog)=>dialog.accept());
    const switchCoreOneTools=async (count)=>{
      await page.locator('#printerDialog [data-tool-configuration-input]')
        .selectOption(String(count));
      await page.locator('#printerDialog [data-tool-configuration-save]').click();
      await page.waitForFunction((expected)=>{
        const dialog=document.querySelector('#printerDialog');
        const panel=dialog?.querySelector('#detailTabToolheads');
        const rows=panel?.querySelectorAll('.material-tool-row');
        const config=panel?.querySelector('[data-tool-configuration-input]');
        const filamentEditors=panel?.querySelectorAll('[data-preact-toolhead-editor="prusa-filament"]');
        const nozzleEditors=panel?.querySelectorAll('[data-preact-toolhead-editor="tool-nozzle"]');
        const singleNozzle=panel?.querySelectorAll('[data-preact-toolhead-editor="controller-nozzle"]');
        return dialog?.open && !panel?.hidden && rows?.length===expected
          && filamentEditors?.length===expected
          && nozzleEditors?.length===(expected===1?0:expected)
          && singleNozzle?.length===(expected===1?1:0)
          && Number(config?.value)===expected;
      },count,{timeout:15000});
      assert.ok(await page.locator('#printerDialog').evaluate((dialog)=>dialog.open),
        'CORE One+ details dialog stays open after configuring '+count+' tools');
      assert.equal(await page.locator('#printerDialog #detailTabToolheads .material-tool-row').count(),count,
        'the displayed INDX rows match the saved tool count immediately');
    };
    for(const count of [4,8,1]) {
      await switchCoreOneTools(count);
      await checkToolheadHelpAlignment(page,'Prusa CORE One+ '+count+' tools',{
        filamentMode:'prusa-filament',
        nozzleMode:count===1?'controller-nozzle':'tool-nozzle'
      });
    }
    console.log('Chromium: CORE One+ live INDX 1/4/8/1 configuration transitions PASS');
    await page.locator('#printerDialog [data-detail-close]').click();
    console.log('Chromium: CORE One+ filament dropdown width PASS');

    // The Community licence has three printer slots. Release the AD5M used
    // above before exercising both Creator variants through the real frontend
    // and simulator, without changing the production test licence.
    const removeTestPrinter=async (id)=>{
      const response=await fetch(url+'/api/printers/'+encodeURIComponent(id),{method:'DELETE'});
      assert.equal(response.status,200,'isolated simulator printer removal succeeds');
    };
    await removeTestPrinter(ad5mId);
    for(const profileId of ['flashforge-creator-5','flashforge-creator-5-pro']) {
      const creator=await jsonPost('/api/emulator/printers',{
        profileId,name:'Guidance alignment '+profileId,
        ports:{httpPort:0,cameraPort:0}
      });
      assert.ok(creator.printer?.controllerSettings,
        profileId+' simulator registration details');
      const registered=await jsonPost('/api/printers',creator.printer.controllerSettings);
      const creatorId=registered.printer?.id;
      assert.ok(creatorId,profileId+' registered with isolated controller');
      await page.waitForFunction((id)=>Boolean(
        document.querySelector('[data-printer-card="'+id+'"] [data-open]')
      ),creatorId,{timeout:30000});
      await page.locator('[data-printer-card="'+creatorId+'"] [data-open]').click();
      await page.locator('#printerDialog [data-preact-toolhead-editor="creator5-filament"]')
        .first().waitFor({state:'visible',timeout:15000});
      await page.locator('#printerDialog [data-preact-toolhead-editor="tool-nozzle"]')
        .first().waitFor({state:'visible',timeout:15000});
      assert.equal(await page.locator('#printerDialog [data-preact-toolhead-editor="creator5-filament"]').count(),4,
        profileId+' must show all four filament editors');
      assert.equal(await page.locator('#printerDialog [data-preact-toolhead-editor="tool-nozzle"]').count(),4,
        profileId+' must show all four nozzle editors');
      await checkToolheadHelpAlignment(page,profileId,{
        filamentMode:'creator5-filament',nozzleMode:'tool-nozzle'
      });
      await page.locator('#printerDialog [data-detail-close]').click();
      await removeTestPrinter(creatorId);
      console.log('Chromium: '+profileId+' filament/nozzle guidance aligned PASS');
    }
    // Standard AD5M and AD5M Pro share the flashforge-ad5m adapter and
    // exactly the same material/nozzle editor controls. The Pro emulator
    // verifies the shared table geometry without registering a second
    // simulator instance with a duplicate serial number.
    console.log('Chromium: AD5M / Pro shared filament/nozzle action alignment PASS');
  } finally {
    await context.close();
    // Isolated controller process teardown is the safety boundary; no external
    // printer or persistent user configuration is touched by this test.
  }
}

// Authentication is a separate isolated controller: never enrol real-user or
// shared-browser test installations as a side effect of the visual suite.
async function nativeAuthenticationSmoke(browser){
  console.log('Chromium: native login, administrator user management and sign-out');
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-auth-browser-'));
  const dataDir=path.join(rootDir,'data');
  const logs=[];
  let child=null,context=null;
  try{
    const url='http://127.0.0.1:'+(await portNumber());
    child=spawn(process.execPath,['src/server.js'],{
      cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:url.split(':').at(-1),
        DATA_DIR:dataDir,LOG_DIR:path.join(rootDir,'logs'),
        DISCOVERY_SUBNET:'',EMULATOR_NO_DEFAULTS:'1'},
      stdio:['ignore','pipe','pipe']
    });
    child.stdout.on('data',x=>logs.push(String(x)));
    child.stderr.on('data',x=>logs.push(String(x)));
    await waitForController(url,child,logs);
    context=await browser.newContext({viewport:{width:1280,height:800}});
    // Plain Playwright library has no default action timeout. A missing
    // role-specific control must fail instead of stalling GitHub CI indefinitely.
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(25000);
    const page=await context.newPage();
    const errorLog=[];
    page.on('pageerror',error=>errorLog.push(error.message));
    await page.goto(url+'/');
    await page.locator('#authOverlay').waitFor({state:'visible'});
    assert.equal(await page.locator('body.auth-locked').count(),1,'workspace locked before login');
    const authVisualDir=process.env.PFC_VISUAL_CAPTURE_DIR
      ? path.resolve(process.env.PFC_VISUAL_CAPTURE_DIR):null;
    if(authVisualDir){
      await fs.mkdir(authVisualDir,{recursive:true});
      await page.screenshot({path:path.join(authVisualDir,'auth-setup-dark-desktop.png'),
        animations:'disabled',fullPage:true});
    }
    // The same geometry drives deposited material AND the hotend tip.
    const desktop=await page.evaluate(()=>{
      const a=document.querySelector('.auth-story').getBoundingClientRect();
      const b=document.querySelector('.auth-access-area').getBoundingClientRect();
      const path=document.querySelector('#authExtrusionPath');
      const head=document.querySelector('#authPrinterHead');
      const total=path.getTotalLength();
      const offset=Number(path.style.strokeDashoffset);
      const point=path.getPointAtLength(total-offset);
      const matrix=head.transform.baseVal.consolidate().matrix;
      const brand=document.querySelector('.auth-brand .stacked-layers-mark');
      return {story:a.toJSON(),access:b.toJSON(),
        artwork:Boolean(document.querySelector('.auth-printer-art svg')),
        exactLogo:Boolean(brand&&brand.querySelectorAll('polygon').length===3),
        nozzle:Boolean(head.querySelector('.auth-head-guide')&&head.querySelector('.auth-heat-block')
          &&head.querySelector('.auth-printer-nozzle')),
        grid:Boolean(document.querySelector('.auth-build-grid')),
        clippedGrid:document.querySelector('#authBuildGrid')?.getAttribute('clip-path')===
          'url(#authBuildPlateCrop)',
        quietBackdrop:getComputedStyle(document.querySelector('.auth-story'),'::before')
          .backgroundImage==='none',
        radialGlow:getComputedStyle(document.querySelector('.auth-story'))
          .backgroundImage.includes('radial-gradient'),
        plateShadow:Boolean(document.querySelector('.auth-bed-shadow')),
        contactShadow:Boolean(document.querySelector('.auth-pyramid-contact-shadow')),
        progressMeter:Boolean(document.querySelector('.auth-printer-illustration')
          ?.contains(document.querySelector('#authLayerProgress'))
          &&document.querySelector('.auth-layer-progress-track')),
        removedDemoHeading:document.querySelector('.auth-print-telemetry-heading')===null,
        pathLength:total,nozzleError:Math.hypot(point.x-matrix.e,point.y-matrix.f)};
    });
    assert.ok(desktop.story.right<=desktop.access.left+2,
      'branding panel must sit beside, not on top of, the login');
    assert.ok(desktop.artwork,'the local printer illustration renders');
    assert.ok(desktop.exactLogo,'sign-in uses the actual layered controller brand mark');
    assert.ok(desktop.nozzle,'minimal amber nozzle and guide are present on the print bed');
    assert.ok(desktop.grid,'45-degree isometric grid is rendered behind the pyramid');
    assert.ok(desktop.clippedGrid,'only the isometric build plate contains the grid');
    assert.ok(desktop.quietBackdrop,'no square graph-paper overlay remains');
    assert.ok(desktop.radialGlow,'subtle radial illumination replaces the square grid');
    assert.ok(desktop.plateShadow&&desktop.contactShadow,
      'plate and printed layers have restrained depth');
    assert.ok(desktop.progressMeter,'the layer counter has a compact progress meter');
    assert.equal(desktop.removedDemoHeading,true,
      'no Pyramid Build – Demo heading should appear over the animation');
    assert.ok(desktop.pathLength>550,'first pyramid layer spans a complete isometric perimeter');
    assert.ok(desktop.nozzleError<.5,'nozzle tip must touch the exact traced extrusion line');
    const initial=await page.locator('#authPrinterHead').getAttribute('transform');
    await page.waitForFunction(initial=>document.querySelector('#authPrinterHead')
      ?.getAttribute('transform')!==initial,initial,{timeout:6000});
    const alignment=await page.evaluate(()=>{
      const path=document.querySelector('#authExtrusionPath');
      const len=path.getTotalLength();
      const drawn=len-Number(path.style.strokeDashoffset);
      const point=path.getPointAtLength(drawn);
      const head=document.querySelector('#authPrinterHead').transform.baseVal.consolidate().matrix;
      return Math.hypot(point.x-head.e,point.y-head.f);
    });
    assert.ok(alignment<.5,'moving nozzle must stay aligned with its visible extrusion point');
    const startWidth=await page.locator('#authExtrusionPath').evaluate(el=>el.getBBox().width);
    await page.waitForFunction(()=>Number(document.querySelector('#authPyramidLayers')
      ?.dataset.demoCompletedLayers)>=3,null,{timeout:8000});
    const build=await page.evaluate(()=>{
      const group=document.querySelector('#authPyramidLayers');
      const shells=[...group.querySelectorAll('.auth-pyramid-shell')];
      const footprints=shells.map(shell=>
        shell.querySelector('.auth-pyramid-finished-ring').getBBox().width);
      const active=document.querySelector('#authExtrusionPath');
      const pathLength=active.getTotalLength();
      const p=active.getPointAtLength(pathLength-Number(active.style.strokeDashoffset));
      const tip=document.querySelector('#authPrinterHead').transform.baseVal.consolidate().matrix;
      const grid=[...document.querySelectorAll('#authBuildGrid .auth-grid-line')];
      const counter=Number(document.querySelector('#authPrintLayer').textContent);
      return {shells:shells.length,footprints,activeWidth:active.getBBox().width,
        layer:counter,tipError:Math.hypot(p.x-tip.e,p.y-tip.f),
        grid:grid.length,
        progressWidth:Number(document.querySelector('#authLayerProgress')?.getAttribute('width')),
        startsWith45DegreeAngles:grid.some(line=>{
          const box=line.getBBox();
          return box.width>100&&box.height>40;
        })};
    });
    assert.ok(build.shells>=3,'the animation must construct completed pyramid layers');
    assert.ok(build.footprints.every((w,i)=>i===0||w<build.footprints[i-1]),
      'successive pyramid tiers must visibly shrink instead of repeating a rectangle');
    assert.ok(build.activeWidth<startWidth,
      'the moving nozzle prints successively narrower pyramid contours');
    assert.equal(build.layer,build.shells+1,
      'the demo layer counter must advance as each actual tier is completed');
    assert.ok(build.progressWidth>184*build.shells/18
      &&build.progressWidth<184*(build.shells+1)/18,
      'layer progress advances in sync with the active deposited perimeter');
    assert.ok(build.tipError<.5,'the nozzle stays on the shrinking active perimeter');
    assert.ok(build.grid>=20&&build.startsWith45DegreeAngles,
      'bed grid lines must share the pyramid’s angled isometric projection');
    if(authVisualDir){
      // Record a genuinely half-built pyramid, not a one-layer first frame.
      // The screenshot is a visual QA artifact and never contains farm data.
      await page.waitForFunction(()=>Number(document.querySelector('#authPyramidLayers')
        ?.dataset.demoCompletedLayers)>=9,null,{timeout:18000});
      const beforeTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      await page.screenshot({path:path.join(authVisualDir,'auth-pyramid-half-built-dark.png'),
        animations:'disabled',fullPage:true});
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,beforeTheme);
    }
    // Unlike the previous 3D gantry, the reference-inspired scene has no
    // raised printer frame. All perimeter points and the full slim nozzle
    // must remain inside the technical print-bed diagram.
    const clearance=await page.evaluate(()=>{
      const path=document.querySelector('#authExtrusionPath');
      const length=path.getTotalLength();
      let safelyInside=true;
      for(let i=0;i<=120;i++){
        const p=path.getPointAtLength(length*i/120);
        if(p.x-11<=56||p.x+11>=609||p.y-51<=58||p.y+2>=347){
          safelyInside=false;break;
        }
      }
      return safelyInside;
    });
    assert.equal(clearance,true,'the complete nozzle remains inside the print bed');
    assert.equal(await page.locator('.auth-printer-base,.auth-printer-rail').count(),0,
      'reference visualization must not show a printer gantry or frame');
    assert.match(await page.locator('.auth-print-telemetry-layer').textContent(),
      /Layer \d{2} \/ 18/,'the demo layer counter remains legible');
    assert.equal(await page.locator('#authMotionToggle').count(),0,
      'login must no longer show a pause animation button');
    await page.emulateMedia({reducedMotion:'reduce'});
    const initialOffset=await page.locator('#authExtrusionPath').evaluate(el=>
      el.style.strokeDashoffset);
    await page.waitForFunction(initial=>document.querySelector('#authExtrusionPath')
      ?.style.strokeDashoffset!==initial,initial,{timeout:5000});
    assert.equal(await page.locator('#authPrinterHead').isVisible(),true,
      'the printhead still animates automatically in Windows Chrome');
    await page.emulateMedia({reducedMotion:'no-preference'});
    // The first full-size pyramid completes, zooms into the upper-left
    // printer, then reveals three independently progressing copies, each
    // connected to one central controller.
    await page.waitForFunction(()=>document.querySelector('.auth-printer-illustration')
      ?.dataset.demoStage==='farm',null,{timeout:47000});
    const farmScene=await page.evaluate(()=>{
      const svg=document.querySelector('.auth-printer-illustration');
      const first=document.querySelector('#authSoloPrinter');
      const copies=[...document.querySelectorAll('.auth-farm-printer')];
      const machines=[first,...copies];
      const layers=machines.map(node=>Number(node.querySelector('.auth-print-telemetry-layer tspan').textContent));
      const tipErrors=machines.map(node=>{
        const path=node.querySelector('.auth-printer-trace');
        const length=path.getTotalLength();
        const offset=Number(path.style.strokeDashoffset);
        const point=path.getPointAtLength(length-offset);
        const nozzle=node.querySelector('.auth-printer-head-motion')
          .transform.baseVal.consolidate().matrix;
        return Math.hypot(nozzle.e-point.x,nozzle.f-point.y);
      });
      const ids=[...svg.querySelectorAll('[id]')].map(node=>node.id);
      return {
        stage:svg.dataset.demoStage,
        firstTransform:first.getAttribute('transform'),
        copies:copies.length,links:svg.querySelectorAll('.auth-farm-link').length,
        hub:svg.querySelector('.auth-farm-hub-label')?.textContent,
        visible:document.querySelector('#authFarmConnections').getAttribute('visibility')==='visible'
          &&document.querySelector('#authFarmReplicas').getAttribute('visibility')==='visible',
        layers,tipErrors,uniqueIds:new Set(ids).size===ids.length
      };
    });
    assert.equal(farmScene.copies,3,'three additional animated printers join the first');
    assert.equal(farmScene.links,4,'every printer has a path to the same controller');
    assert.equal(farmScene.hub,'ONE CONTROLLER','the common controller is clearly identified');
    assert.ok(farmScene.visible,'the connected farm must appear after zooming');
    assert.match(farmScene.firstTransform,/scale\\(0\\.4/,
      'the first printer shrinks into the farm rather than disappearing');
    assert.ok(new Set(farmScene.layers).size>=3,
      'the printers depict independently staggered, active print jobs');
    assert.ok(farmScene.tipErrors.every(error=>error<.5),
      'every miniature nozzle traces its own exact extrusion perimeter');
    assert.ok(farmScene.uniqueIds,'cloned SVG printers cannot duplicate DOM IDs');
    if(authVisualDir){
      await page.screenshot({path:path.join(authVisualDir,'auth-connected-farm-dark.png'),
        animations:'disabled',fullPage:true});
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
      await page.screenshot({path:path.join(authVisualDir,'auth-connected-farm-light.png'),
        animations:'disabled',fullPage:true});
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    }
    await page.setViewportSize({width:820,height:844});
    assert.equal(await page.locator('.auth-printer-illustration').getAttribute('data-demo-stage'),'solo',
      'compact laptop layout stays focused on the original single-printer animation');
    assert.equal(await page.locator('.auth-printer-art').isVisible(),true,
      'compact laptop viewport retains visible printer animation');
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    assert.equal(await page.locator('.auth-story').evaluate(element=>
      getComputedStyle(element).backgroundColor),'rgb(246, 249, 253)',
      'access branding inherits the light theme');
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.auth-printer-art').isVisible(),false,
      'phone layout hides the large printer art');
    assert.equal(await page.locator('.auth-brand-symbol').evaluate(element=>
      getComputedStyle(element,'::after').animationName),'auth-logo-layer',
      'phone layout has a subtle animated brand layer');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.auth-brand-symbol').evaluate(el=>
      getComputedStyle(el,'::after').animationName),'auth-logo-layer',
      'mobile brand line remains subtle and automatic without extra controls');
    await page.emulateMedia({reducedMotion:'no-preference'});
    const mobile=await page.evaluate(()=>({
      scroll:document.documentElement.scrollWidth,
      width:innerWidth,
      form:document.querySelector('.auth-login-card').getBoundingClientRect().toJSON()
    }));
    assert.ok(mobile.scroll<=mobile.width+1,'mobile auth gate must not overflow horizontally');
    assert.ok(mobile.form.left>=0&&mobile.form.right<=mobile.width,
      'mobile setup form stays within viewport');
    await page.setViewportSize({width:1280,height:800});
    assert.equal(await page.locator('#authSetupForm').isVisible(),true,
      'default HTTP setup must be visible without any environment override');
    assert.equal(await page.locator('#authTransportNotice').isVisible(),true,
      'unencrypted credentials must show an explicit warning');
    const code=logs.join('').match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)?.[1];
    assert.ok(code,'setup code must appear in protected controller startup output');
    assert.equal((await page.locator('body').innerText()).includes(code),false,
      'setup code must never be emitted to the browser');
    await page.locator('#authSetupForm [name=code]').fill(code);
    await page.locator('#authSetupForm [name=username]').fill('owner');
    await page.locator('#authSetupForm [name=displayName]').fill('Owner');
    await page.locator('#authSetupForm [name=password]').fill('Admin password for tests 2026');
    await page.locator('#authSetupForm [name=confirmPassword]').fill('Admin password for tests 2026');
    await page.locator('#authSetupForm button[type=submit]').click();
    await page.locator('#authLoginForm').waitFor({state:'visible'});
    assert.equal(await page.locator('#authTransportNotice').isVisible(),true);
    if(authVisualDir){
      await page.screenshot({path:path.join(authVisualDir,'auth-login-dark-desktop.png'),
        animations:'disabled',fullPage:true});
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
      await page.screenshot({path:path.join(authVisualDir,'auth-login-light-desktop.png'),
        animations:'disabled',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(authVisualDir,'auth-login-mobile.png'),
        animations:'disabled',fullPage:true});
      await page.setViewportSize({width:1280,height:800});
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    }
    await page.locator('#authLoginForm [name=username]').fill('owner');
    await page.locator('#authLoginForm [name=password]').fill('Admin password for tests 2026');
    await page.locator('#authPasswordToggle').click();
    assert.equal(await page.locator('#authLoginForm [name=password]').getAttribute('type'),'text');
    assert.equal(await page.locator('#authPasswordToggle').getAttribute('aria-pressed'),'true');
    await page.locator('#authPasswordToggle').click();
    assert.equal(await page.locator('#authLoginForm [name=password]').getAttribute('type'),'password');
    assert.equal(await page.locator('#authPasswordToggle').getAttribute('aria-pressed'),'false');
    await page.locator('#authLoginForm button[type=submit]').click();
    await page.waitForFunction(()=>window.__PFC_FRONTEND_BOOTED__===true
      && document.body.dataset.authRole==='administrator',{},{timeout:25000});
    assert.equal(await page.locator('#usersBtn').isVisible(),true);
    assert.equal(await page.locator('#authIdentity').isVisible(),true);
    await page.locator('#usersBtn').click();
    await page.locator('#authUserAddForm').waitFor({state:'visible'});
    // The native account-list fetch is asynchronous. Wait for its initial
    // response before creating a user so a late initial list render cannot
    // overwrite the refreshed list and cause a false browser regression.
    await page.locator('#authUserList tbody tr').filter({hasText:'owner'})
      .waitFor({state:'visible'});
    await page.locator('#authUserAddForm [name=username]').fill('shiftoperator');
    await page.locator('#authUserAddForm [name=displayName]').fill('Shift operator');
    await page.locator('#authUserAddForm [name=role]').selectOption('operator');
    await page.locator('#authUserAddForm [name=password]').fill('Operator password for tests 2026');
    await page.locator('#authUserAddForm button[type=submit]').click();
    await page.locator('#authUserList tbody tr').filter({hasText:'shiftoperator'}).waitFor();
    await page.locator('#authUserAddForm [name=username]').fill('viewer');
    await page.locator('#authUserAddForm [name=displayName]').fill('Viewer');
    await page.locator('#authUserAddForm [name=role]').selectOption('viewer');
    await page.locator('#authUserAddForm [name=password]').fill('Viewer password for tests 2026');
    await page.locator('#authUserAddForm button[type=submit]').click();
    await page.locator('#authUserList tbody tr').filter({
      has:page.locator('th[scope="row"]:text-is("viewer")')
    }).waitFor();
    console.log('Chromium auth: viewer created; creating production operator');
    await page.locator('#authUserAddForm [name=username]').fill('shopoperator');
    await page.locator('#authUserAddForm [name=displayName]').fill('Shop operator');
    await page.locator('#authUserAddForm [name=role]').selectOption('operator');
    await page.locator('#authUserAddForm [name=password]').fill('Shop operator password 2026');
    await page.locator('#authUserAddForm button[type=submit]').click();
    await page.locator('#authUserList th[scope=row]').filter({hasText:'shopoperator'}).waitFor();
    console.log('Chromium auth: operator created; switching shift operator role');
    const row=page.locator('#authUserList tbody tr').filter({hasText:'shiftoperator'});
    assert.equal(await row.locator('select').inputValue(),'operator');
    await row.locator('select').selectOption('viewer');
    await row.locator('button').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#authUserList tbody tr')]
      .some(tr=>tr.textContent.includes('shiftoperator')&&tr.querySelector('select')?.value==='viewer'));
    await page.locator('#authAccountBtn').click();
    await page.locator('#authLogoutBtn').click();
    await page.locator('#authOverlay').waitFor({state:'visible'});
    console.log('Chromium auth: admin signed out; signing in viewer');
    await page.locator('#authLoginForm [name=username]').fill('viewer');
    await page.locator('#authLoginForm [name=password]').fill('Viewer password for tests 2026');
    await page.locator('#authLoginForm button[type=submit]').click();
    await page.waitForFunction(()=>window.__PFC_FRONTEND_BOOTED__===true
      && document.body.dataset.authRole==='viewer',null,{timeout:25000});
    assert.equal(await page.locator('#usersBtn').isVisible(),false,'viewer cannot see user admin');
    console.log('Chromium auth: viewer signed in; opening account dialog to sign out');
    await page.locator('#authAccountBtn').click();
    await page.locator('#authLogoutBtn').click();
    await page.locator('#authOverlay').waitFor({state:'visible'});
    console.log('Chromium auth: viewer signed out; signing in production operator');
    await page.locator('#authLoginForm [name=username]').fill('shopoperator');
    await page.locator('#authLoginForm [name=password]').fill('Shop operator password 2026');
    await page.locator('#authLoginForm button[type=submit]').click();
    await page.waitForFunction(()=>window.__PFC_FRONTEND_BOOTED__===true
      && document.body.dataset.authRole==='operator',null,{timeout:25000});
    console.log('Chromium auth: production operator signed in; checking permissions');
    assert.equal(await page.locator('#clearQueueHistoryBtn').isVisible(),false,
      'operators cannot purge queue history');
    assert.equal(await page.locator('#libraryDeleteSelectedBtn').isVisible(),false,
      'operators cannot delete library records');
    assert.equal(await page.locator('#filamentForm').isVisible(),false,
      'operators cannot edit the shared filament cost catalogue');
    assert.equal(await page.locator('#reportsBtn').isVisible(),true,
      'operators retain read access to reporting');
    assert.deepEqual(errorLog,[],'native login UI must have no uncaught browser errors');
    console.log('Chromium: native login, role-based user administration and sign-out PASS');
  }catch(error){
    console.error('Auth browser server tail:',logs.join('').slice(-3000));
    if(context){
      const pages=context.pages();
      const p=pages[0];
      if(p){
        console.error('Auth browser client state:',await p.evaluate(()=>({
          role:document.body.dataset.authRole,
          locked:document.body.classList.contains('auth-locked'),
          userError:document.querySelector('#authUserAddError')?.textContent,
          loginError:document.querySelector('#authLoginError')?.textContent,
          route:location.pathname,
          accountList:document.querySelector('#authUserList')?.textContent?.slice(0,450),
          usersHidden:document.querySelector('#authUsersLayout')?.hidden,
          usersButtonHidden:document.querySelector('#usersBtn')?.hidden
        })).catch(()=>({unavailable:true})));
        // A hung UI account-list fetch can otherwise look like an unrelated
        // menu failure. Compare network access from browser and API context.
        console.error('Auth users HTTP probe:',await p.request.get(new URL('/api/auth/users',p.url()).toString(),
          {timeout:4500}).then(async response=>({
          status:response.status(),preview:(await response.text()).slice(0,180)
        })).catch(error=>({error:String(error).slice(0,220)})));
      }
    }
    throw error;
  }finally{
    await context?.close().catch(()=>{});
    await stopIsolatedController(child,'authentication fixture');
    await fs.rm(rootDir,{recursive:true,force:true}).catch(()=>{});
  }
}

/** The UI fixtures spawn real Node servers. SIGTERM may hang while clearing
 * active SSE or printer streams; always reap child processes after testing. */
async function stopIsolatedController(child,label){
  if(!child)return;
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');
  await new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolve();
    const timer=setTimeout(()=>{
      console.warn('Chromium: forcing exit of '+label+' after graceful shutdown deadline');
      child.kill('SIGKILL');
      resolve();
    },3000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
  });
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
          DATA_DIR:path.join(dir,'data'),LOG_DIR:path.join(dir,'logs'),DISCOVERY_SUBNET:'',EMULATOR_NO_DEFAULTS:'1',
          PFC_AUTH_REQUIRED:'0'},
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
    await designSystemSmoke(browser,url);
    await dashboardPhase3Smoke(browser,url);
    await dashboardCompactTableSmoke(browser,url);
    await workspaceShellSmoke(browser,url);
    await workspaceHeadingSmoke(page,url);
    await sharedTabNavigationSmoke(page,url);
    await libraryCostSmoke(page,url);
    await libraryCompactTableSmoke(page,url);
    await librarySelectionSmoke(page,url,{ mutateFixture:!externalUrl });
    await libraryPricingSmoke(page,url,{ mutateFixture:!externalUrl });
    await libraryScrollingSmoke(page,url);
    await libraryAvailabilityBadgeSmoke(page,url);
    await routeSmoke(page,url);
    await queueClickSmoke(browser,url);
    await groupEditorSmoke(browser,url);
    if(!externalUrl) await simulatorSseSmoke(browser,url);
    if(!externalUrl) await nativeAuthenticationSmoke(browser);
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
    console.log('Chromium: closing browser and isolated controller');
    if(browser){
      let timer;
      try {
        await Promise.race([
          browser.close(),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Chromium browser close timed out')),10000);})
        ]);
      }catch(error){
        process.exitCode=1;
        console.error('Chromium cleanup error:',error.message);
      }finally{clearTimeout(timer);}
    }
    await stopIsolatedController(processHandle,'visual test controller');
    if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
    console.log('Chromium: browser regression cleanup complete');
  }
}

// Standalone smoke-test CLI: an orphaned Chromium transport or SSE socket
// must not make a PASS run appear stuck until the GitHub job times out.
await main();
process.exit(process.exitCode||0);
