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
          rows.get(key).push({
            name:card.querySelector('[data-name]')?.textContent,
            imageTop:imageBox.top,imageBottom:imageBox.bottom,
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
      heading:document.querySelector('#dashboardFleetHeadingRoot').getBoundingClientRect().toJSON()
    }));
    assert.ok(mobile.cards.every(r=>r.left>=-1&&r.right<=391),
      'summary cards remain inside a 390px phone viewport');
    assert.ok(mobile.view.left>=0&&mobile.view.right<=391,'dashboard view switch stays visible on mobile');
    assert.ok(mobile.heading.left>=0&&mobile.heading.right<=391);
    if(captureDir)await page.screenshot({path:path.join(captureDir,'dashboard-phase3-light-mobile.png'),
      animations:'disabled',fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}

async function workspaceShellSmoke(browser,url) {
  console.log('Chromium: Phase 2 workspace sidebar, breadcrumbs and mobile navigation');
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
    const crumb=page.locator('#workspaceTrailRoot [data-preact-workspace-trail]');
    await crumb.waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#workspaceTrailRoot [aria-current="page"]')
      ?.textContent==='Reports & analytics');
    const reportContext=await page.evaluate(()=>({
      crumb:document.querySelector('#workspaceTrailRoot')?.innerText,
      title:document.querySelector('#topbarContextTitle')?.textContent,
      subtitle:document.querySelector('#topbarContextSubtitle')?.textContent,
      parent:document.querySelector('#workspaceTrailRoot .workspace-trail-link')?.textContent
    }));
    assert.equal(reportContext.parent,'Workspace');
    assert.equal(reportContext.title,'Reports & analytics');
    assert.equal(reportContext.subtitle,'Review farm performance and filament usage');
    assert.ok(reportContext.crumb.includes('Workspace')&&reportContext.crumb.includes('Reports & analytics'));
    assert.ok(!reportContext.crumb.includes(reportContext.subtitle),
      'subtitle must not overwrite the breadcrumb parent on route changes');
    assert.equal(await page.locator('#reportsBtn').getAttribute('aria-current'),'page',
      'active navigation item has current-page semantics');
    assert.equal(await page.locator('.sidebar-section-label').count(),2,
      'operations and farm management are visually grouped');
    assert.ok(await page.locator('.sidebar-nav .sidebar-icon svg').count()>=9,
      'main sidebar uses consistently sized SVG navigation icons');
    assert.equal(await page.locator('#controllerSidebar').evaluate(n=>n.inert),false,
      'desktop navigation is always available');
    await crumb.getByRole('button',{name:'Go to dashboard'}).click();
    await page.waitForFunction(()=>location.pathname==='/'&&document.body.dataset.route==='/' &&
      document.querySelector('.topbar-context strong')?.textContent==='Dashboard');
    assert.equal(await page.locator('[data-dashboard-home]').getAttribute('aria-current'),'page',
      'breadcrumb uses normal controller routing to activate Dashboard');
    await page.waitForFunction(()=>document.querySelector('#workspaceTrailRoot .workspace-trail-home'));
    const dashHeader=await page.evaluate(()=>({
      root:document.querySelector('#workspaceTrailRoot')?.innerText?.trim(),
      title:document.querySelector('#topbarContextTitle')?.textContent,
      subtitle:document.querySelector('#topbarContextSubtitle')?.textContent,
      trail:document.querySelector('#workspaceTrailRoot')?.dataset.home,
      duplicate:document.querySelector('#workspaceTrailRoot .workspace-trail-current')
    }));
    assert.equal(dashHeader.root,'Workspace',
      'dashboard header shows only the Workspace eyebrow, not a second Dashboard');
    assert.equal(dashHeader.title,'Dashboard');
    assert.equal(dashHeader.subtitle,'Monitor and manage your print farm');
    assert.equal(dashHeader.trail,'true');
    assert.equal(dashHeader.duplicate,null,
      'root route should not render a redundant Dashboard breadcrumb');
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
  const rows=page.locator('#libraryList .library-file-row');
  const firstId=await rows.nth(0).getAttribute('data-library-file');
  const secondId=await rows.nth(1).getAttribute('data-library-file');
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
    assert.ok(dimensions.columns.split(' ').length>=7,'desktop library has seven aligned columns');
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
        window.dispatchEvent(new CustomEvent('pfc:library-ui-state',{
          detail:{summary:files.length+' files',files,emptyText:'No files'}
        }));
      },[sample,theme]);
      await page.waitForFunction(()=>document.querySelectorAll('#libraryList .library-file-row').length===65);
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
    await designSystemSmoke(browser,url);
    await dashboardPhase3Smoke(browser,url);
    await workspaceShellSmoke(browser,url);
    await workspaceHeadingSmoke(page,url);
    await sharedTabNavigationSmoke(page,url);
    await libraryCostSmoke(page,url);
    await librarySelectionSmoke(page,url,{ mutateFixture:!externalUrl });
    await libraryScrollingSmoke(page,url);
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
