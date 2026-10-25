/* Standalone native authentication gate. Runs before Preact and legacy modules.
 * No token or password is persisted in the DOM, URL, or browser storage.
 */
const nativeFetch=window.fetch.bind(window);
const $=(selector)=>document.querySelector(selector);
const lock=$('#authOverlay');
const errorLabel=$('#authLoginError');
const loginForm=$('#authLoginForm');
let session=null;

// Eighteen genuine, shrinking deposited perimeters build a stepped pyramid.
// The camera looks diagonally across the bed (45-degree azimuth); X and Y
// share an isometric projection. All geometry, nozzle travel and grid lines
// use one coordinate system, so the active nozzle cannot miss extrusion.
const pyramidLayerCount=18;
const pyramidLayerMs=1500; // accelerated construction time-lapse
const pyramidHoldMs=2400;
const pyramidCycleMs=pyramidLayerCount*pyramidLayerMs+pyramidHoldMs;
const pyramidBaseRadius=90;
const pyramidTaper=4;
const pyramidLayerHeight=5.2;
const svgNS='http://www.w3.org/2000/svg';
const extrusionPath=$('#authExtrusionPath');
const ghostPerimeter=$('#authPrinterTop');
const carriage=$('#authPrinterHead');
const completedLayers=$('#authPyramidLayers');
const bedGrid=$('#authBuildGrid');
const layerCounter=$('#authPrintLayer');
let printerFrame=0;
let printerStart=null;
let lastRenderedLayer=-1;
let lastCompletedLayers=-1;

function projectPrintPoint(x,y,z=0){
  return {x:330+.85*(x-y),y:241+.4*(x+y)-z};
}
function pyramidRing(index){
  const r=pyramidBaseRadius-Math.max(0,index)*pyramidTaper;
  const z=index*pyramidLayerHeight;
  return [
    projectPrintPoint(-r,r,z),   // left
    projectPrintPoint(-r,-r,z),  // far
    projectPrintPoint(r,-r,z),   // right
    projectPrintPoint(r,r,z)     // near
  ];
}
function svgPoint(p){
  return p.x.toFixed(2)+' '+p.y.toFixed(2);
}
function polygonPath(points){
  return 'M'+points.map(svgPoint).join('L')+'Z';
}
function svgPath(d,cls){
  const node=document.createElementNS(svgNS,'path');
  node.setAttribute('class',cls);
  node.setAttribute('d',d);
  return node;
}
// The fixed grid is projected at the same 45-degree azimuth as the part.
if(bedGrid){
  const fragment=document.createDocumentFragment();
  for(let t=-120;t<=120;t+=24){
    const across=[projectPrintPoint(t,-130),projectPrintPoint(t,130)];
    const along=[projectPrintPoint(-130,t),projectPrintPoint(130,t)];
    fragment.append(
      svgPath('M'+svgPoint(across[0])+'L'+svgPoint(across[1]),'auth-grid-line'),
      svgPath('M'+svgPoint(along[0])+'L'+svgPoint(along[1]),'auth-grid-line')
    );
  }
  bedGrid.append(fragment);
}
function layerFaces(index){
  const top=pyramidRing(index);
  const bottom=index===0
    ?pyramidRing(0).map(p=>({x:p.x,y:p.y+pyramidLayerHeight}))
    :pyramidRing(index-1);
  const shell=document.createElementNS(svgNS,'g');
  shell.setAttribute('class','auth-pyramid-shell');
  shell.setAttribute('data-demo-layer',String(index+1));
  shell.append(
    svgPath(polygonPath([bottom[0],bottom[3],top[3],top[0]]),
      'auth-pyramid-face-left'),
    svgPath(polygonPath([bottom[3],bottom[2],top[2],top[3]]),
      'auth-pyramid-face-right'),
    svgPath(polygonPath(top),'auth-pyramid-finished-ring')
  );
  return shell;
}
function showCompletedLayers(count){
  if(!completedLayers||lastCompletedLayers===count)return;
  const fragment=document.createDocumentFragment();
  for(let i=0;i<count;i++)fragment.append(layerFaces(i));
  completedLayers.replaceChildren(fragment);
  completedLayers.dataset.demoCompletedLayers=String(count);
  lastCompletedLayers=count;
}
function drawPrinter(layer=0,progress=0,finished=layer){
  if(!extrusionPath||!carriage||!ghostPerimeter)return;
  const activeLayer=Math.min(pyramidLayerCount-1,Math.max(0,layer));
  const amount=Math.min(1,Math.max(0,progress));
  showCompletedLayers(finished);
  if(lastRenderedLayer!==activeLayer){
    const perimeter=polygonPath(pyramidRing(activeLayer));
    extrusionPath.setAttribute('d',perimeter);
    ghostPerimeter.setAttribute('d',perimeter);
    lastRenderedLayer=activeLayer;
  }
  const length=extrusionPath.getTotalLength();
  const distance=amount*length;
  const point=extrusionPath.getPointAtLength(distance);
  // The group's (0,0) origin is the sharp amber nozzle tip.
  carriage.setAttribute('transform',`translate(${point.x} ${point.y})`);
  extrusionPath.style.strokeDasharray=String(length);
  extrusionPath.style.strokeDashoffset=String(length-distance);
  if(layerCounter)layerCounter.textContent=String(activeLayer+1).padStart(2,'0');
}
function nextPrinterFrame(time){
  printerFrame=0;
  if(lock.hidden||document.visibilityState==='hidden')return;
  if(printerStart===null)printerStart=time;
  const elapsed=(time-printerStart)%pyramidCycleMs;
  const buildingDuration=pyramidLayerCount*pyramidLayerMs;
  if(elapsed<buildingDuration){
    const layer=Math.floor(elapsed/pyramidLayerMs);
    drawPrinter(layer,(elapsed%pyramidLayerMs)/pyramidLayerMs);
  }else{
    // Hold the completed part without dropping/redrawing the top layer.
    drawPrinter(pyramidLayerCount-1,1,pyramidLayerCount);
  }
  printerFrame=requestAnimationFrame(nextPrinterFrame);
}
function syncPrinterAnimation(){
  if(printerFrame)cancelAnimationFrame(printerFrame);
  printerFrame=0;
  printerStart=null;
  lastRenderedLayer=-1;
  lastCompletedLayers=-1;
  drawPrinter();
  if(!lock.hidden&&document.visibilityState==='visible')
    printerFrame=requestAnimationFrame(nextPrinterFrame);
}
document.addEventListener('visibilitychange',syncPrinterAnimation);

// Shared authentication helpers are deliberately independent of the
// decorative printer renderer. User management, sign-out and account password
// changes must continue to work if the illustration is revised.
function errorText(error){return error instanceof Error?error.message:String(error);}
async function call(path,options={}){
  const response=await window.fetch(path,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Request failed ('+response.status+')');
  return data;
}
function showGate(message,{setup=false,transport=false}={}){
  document.body.classList.add('auth-locked');
  document.documentElement.classList.remove('auth-pending');
  lock.hidden=false;
  syncPrinterAnimation();
  $('#authLoginHelp').textContent=message||'Sign in to access your farm.';
  $('#authLoginHeading').textContent=setup?'Set up your workspace':transport?'Connection required':'Welcome back';
  loginForm.hidden=setup||transport;
  $('#authSetupSection').hidden=!setup;
  $('#authSetupForm').hidden=!setup||!session?.loginAvailable;
  $('#authSetupCancelBtn').hidden=Boolean(session?.enabled);
  if(setup&&session?.loginAvailable)$('#authSetupForm input[name=code]')?.focus();
  else if(!setup&&!transport)loginForm.querySelector('input[name=username]')?.focus();
}
function lockAfterExpiry(){
  if(document.body.classList.contains('auth-locked'))return;
  location.reload();
}
function installAuthorizedFetch(){
  window.fetch=(input,options={})=>{
    const raw=typeof input==='string'||input instanceof URL?String(input):input.url;
    const url=new URL(raw,location.href);
    const method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.origin!==location.origin)return nativeFetch(input,options);
    const headers=new Headers(input instanceof Request?input.headers:undefined);
    new Headers(options.headers||{}).forEach((value,key)=>headers.set(key,value));
    if(['POST','PUT','PATCH','DELETE'].includes(method)&&url.pathname.startsWith('/api/')){
      if(session?.csrf)headers.set('x-pfc-csrf',session.csrf);
    }
    return nativeFetch(input,{...options,headers,credentials:'same-origin'}).then(response=>{
      if(response.status===401&&url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/auth/'))
        lockAfterExpiry();
      return response;
    });
  };
}
function showError(selector,message){const target=$(selector);if(target)target.textContent=message||'';}
async function loadUsers(){
  if(session?.user?.role!=='administrator')return;
  const container=$('#authUserList');
  if(!container)return;
  container.replaceChildren();
  const loading=document.createElement('p');loading.textContent='Loading users…';container.append(loading);
  try{
    const data=await call('/api/auth/users');
    const table=document.createElement('table');
    table.className='auth-users-table';
    const head=document.createElement('thead');
    const row=document.createElement('tr');
    for(const name of ['Username','Display name','Role','Disabled','New password','Actions']){
      const th=document.createElement('th');th.textContent=name;row.append(th);
    }
    head.append(row);table.append(head);
    const body=document.createElement('tbody');
    for(const user of data.users||[]){
      const tr=document.createElement('tr');
      const username=document.createElement('th');username.scope='row';username.textContent=user.username;tr.append(username);
      const td=(node)=>{const cell=document.createElement('td');cell.append(node);tr.append(cell);return cell;};
      const label=(text,element)=>{element.setAttribute('aria-label',text+' for '+user.username);return element;};
      const display=label('Display name',document.createElement('input'));
      display.value=user.displayName||'';display.maxLength=120;td(display);
      const role=label('Role',document.createElement('select'));
      for(const value of ['viewer','operator','administrator']){
        const item=document.createElement('option');item.value=value;item.textContent=value[0].toUpperCase()+value.slice(1);role.append(item);
      }
      role.value=user.role;td(role);
      const disabled=label('Disabled',document.createElement('input'));
      disabled.type='checkbox';disabled.checked=user.disabled;td(disabled);
      const password=label('Reset password',document.createElement('input'));
      password.type='password';password.minLength=12;password.maxLength=256;password.autocomplete='new-password';password.placeholder='Leave blank to keep';td(password);
      const action=document.createElement('button');
      action.type='button';action.className='secondary';action.textContent='Save';
      const status=document.createElement('span');status.className='auth-row-status';status.setAttribute('role','status');
      const actions=document.createElement('div');actions.className='auth-row-actions';actions.append(action,status);td(actions);
      action.addEventListener('click',async()=>{
        action.disabled=true;status.textContent='';
        const data={displayName:display.value,role:role.value,disabled:disabled.checked};
        if(password.value)data.password=password.value;
        try{
          const update=await call('/api/auth/users/'+encodeURIComponent(user.id),{
            method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)
          });
          password.value='';
          if(update.reauthenticate){location.reload();return;}
          await loadUsers();
        }catch(error){status.textContent=errorText(error);}
        finally{action.disabled=false;}
      });
      body.append(tr);
    }
    table.append(body);
    const outer=document.createElement('div');outer.className='auth-table-scroll';outer.append(table);
    container.replaceChildren(outer);
  }catch(error){loading.textContent=errorText(error);}
}
function initializeSetupUi(){
  if(!session?.enrollmentAvailable||session.enabled)return;
  $('#usersBtn').hidden=false;
  $('#authSetupOverview').hidden=false;
  $('#authUsersLayout').hidden=true;
  $('#authSecurityStatus').textContent='Authentication is OFF: anyone who can reach this controller can operate it without a login.';
  $('#authSetupStartBtn')?.addEventListener('click',()=>{
    showGate(session.loginAvailable
      ? 'Verify your one-time code and create the first administrator.'
      : 'Administrator setup needs HTTPS. Configure the canonical HTTPS origin first; HTTP is supported only in isolated development.',{setup:true});
  });
  $('#authSetupCancelBtn')?.addEventListener('click',()=>{
    lock.hidden=true;
    document.body.classList.remove('auth-locked');
  });
}
function initializeAccountUi(){
  if(!session?.enabled||!session.user)return;
  $('#authUsersLayout').hidden=false;
  document.body.dataset.authRole=session.user.role;
  const identity=$('#authIdentity');
  identity.hidden=false;
  identity.textContent=(session.user.displayName||session.user.username)+' · '+session.user.role;
  const account=$('#authAccountBtn');account.hidden=false;
  const dialog=$('#authPasswordDialog');
  account.addEventListener('click',()=>dialog.showModal());
  $('#authPasswordCancel')?.addEventListener('click',()=>dialog.close());
  $('#authPasswordForm')?.addEventListener('submit',async event=>{
    event.preventDefault();showError('#authPasswordError','');
    const form=event.currentTarget;
    const submit=form.querySelector('button[type=submit]');submit.disabled=true;
    try{
      await call('/api/auth/password',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({
          currentPassword:form.elements.currentPassword.value,
          newPassword:form.elements.newPassword.value
        })
      });
      location.reload();
    }catch(error){showError('#authPasswordError',errorText(error));}
    finally{submit.disabled=false;}
  });
  $('#authLogoutBtn')?.addEventListener('click',async()=>{
    try{await call('/api/auth/logout',{method:'POST'});}
    finally{location.reload();}
  });
  if(session.user.role==='administrator'){
    $('#usersBtn').hidden=false;
    $('#usersBtn').addEventListener('click',loadUsers);
    $('#authUserAddForm').addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget;
      showError('#authUserAddError','');
      const button=form.querySelector('button[type=submit]');button.disabled=true;
      try{
        await call('/api/auth/users',{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({
            username:form.elements.username.value,
            displayName:form.elements.displayName.value,
            role:form.elements.role.value,
            password:form.elements.password.value
          })
        });
        form.reset();
        await loadUsers();
      }catch(error){showError('#authUserAddError',errorText(error));}
      finally{button.disabled=false;}
    });
  }else{
    // Presentation restrictions supplement (never replace) backend RBAC checks.
    for(const selector of ['#backupRecoveryBtn','#diagnosticsBtn','#openSimulatorBtn',
      '#licenseInstallForm','#reportingPricingForm','#printerGroupForm']){
      const el=$(selector);if(el)el.hidden=true;
    }
    for(const selector of ['#addPrinterBtn','.sidebar-quick-add','#scanNetworkBtn']){
      const el=$(selector);if(el)el.hidden=true;
    }
    // Destructive farm-history and catalogue actions belong to administrators.
    // The reporting and library renderers also respect this state so Preact
    // re-renders cannot reintroduce forbidden action buttons.
    for(const selector of ['#clearQueueHistoryBtn','#libraryDeleteSelectedBtn','#filamentForm']){
      const el=$(selector);if(el)el.hidden=true;
    }
    if(session.user.role==='viewer'){
      for(const selector of ['#farmOperationsToggle','#queueAddFileBtn',
        '#libraryAddFileBtn','#maintenanceTaskForm']){
        const el=$(selector);if(el)el.hidden=true;
      }
    }
  }
}
async function loadApp(){
  // The no-bundle fallback is intentional; other modules must load either way.
  try{await import('/dashboard-preact.js');}catch{}
  await import('/app.js');
  await Promise.all([import('/maintenance.js'),import('/reporting.js'),import('/alerts.js')]);
  window.__PFC_REACTIVATE_ROUTE__?.();
}
$('#authSetupForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  showError('#authSetupError','');
  const button=form.querySelector('button[type=submit]');
  if(form.elements.password.value!==form.elements.confirmPassword.value){
    showError('#authSetupError','Passwords do not match.');
    return;
  }
  button.disabled=true;
  try{
    const response=await nativeFetch('/api/auth/enroll',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        code:form.elements.code.value,
        username:form.elements.username.value,
        displayName:form.elements.displayName.value,
        password:form.elements.password.value
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Administrator setup failed');
    form.reset();
    location.assign('/');
  }catch(error){showError('#authSetupError',errorText(error));}
  finally{button.disabled=false;}
});
// The visibility control never copies passwords to another element or storage.
$('#authPasswordToggle')?.addEventListener('click',event=>{
  const input=loginForm?.elements.password;
  if(!input)return;
  const visible=input.type==='password';
  input.type=visible?'text':'password';
  const button=event.currentTarget;
  button.setAttribute('aria-pressed',String(visible));
  button.setAttribute('aria-label',visible?'Hide password':'Show password');
  button.title=visible?'Hide password':'Show password';
  input.focus({preventScroll:true});
});
loginForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  errorLabel.textContent='';
  const submit=loginForm.querySelector('button[type=submit]');submit.disabled=true;
  try{
    const data=await nativeFetch('/api/auth/login',{
      method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
      body:JSON.stringify({
        username:loginForm.elements.username.value,
        password:loginForm.elements.password.value
      })
    });
    const result=await data.json().catch(()=>({}));
    if(!data.ok)throw new Error(result.error||'Unable to sign in');
    loginForm.elements.password.value='';
    location.reload();
  }catch(error){errorLabel.textContent=errorText(error);}
  finally{submit.disabled=false;}
});
try{
  const response=await nativeFetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Unable to check authentication status');
  session=await response.json();
  const notice=$('#authTransportNotice');
  if(notice){
    notice.textContent=session.transportWarning||'';
    notice.hidden=!session.transportWarning;
  }
  if(session.enabled&&session.setupRequired){
    if(session.enrollmentAvailable){
      showGate(session.loginAvailable
        ? 'Create your first administrator using the one-time code from the controller startup logs.'
        : 'HTTP administrator setup is disabled in this deployment. Configure HTTPS to continue.',{setup:true});
    }else{
      showGate('The account store requires local recovery. Browser re-enrollment is disabled after security was activated.',{transport:true});
    }
  }else if(session.enabled&&!session.user){
    const requiresHttps=!session.loginAvailable;
    showGate(requiresHttps
      ? 'HTTP login is disabled by configuration. Use the configured HTTPS address.'
      : 'Sign in to access your print farm.',{transport:requiresHttps});
  }else{
    installAuthorizedFetch();
    if(session.enabled)initializeAccountUi();
    else initializeSetupUi();
    await loadApp();
    window.__PFC_FRONTEND_BOOTED__=true;
    document.documentElement.classList.remove('auth-pending');
    if(session.enabled){
      // Real keyboard/pointer activity renews idle sessions. Automatic polling
      // deliberately does not keep an unattended unlocked dashboard signed in.
      let lastActivityReport=0;
      const reportHumanActivity=(event)=>{
        if(!event.isTrusted||document.visibilityState==='hidden')return;
        const now=Date.now();
        if(now-lastActivityReport<2*60*1000)return;
        lastActivityReport=now;
        void call('/api/auth/activity',{method:'POST'}).catch(()=>{});
      };
      document.addEventListener('pointerdown',reportHumanActivity,{capture:true,passive:true});
      document.addEventListener('keydown',reportHumanActivity,{capture:true});
      setInterval(async()=>{
        try{
          const response=await nativeFetch('/api/auth/session',{cache:'no-store'});
          if(!response.ok||!(await response.json()).user)lockAfterExpiry();
        }catch{ /* transient network outages do not log out live operators */ }
      },60000);
    }
  }
}catch(error){
  showGate('Cannot verify controller security status. Check that the controller is running.',{setup:true});
  errorLabel.textContent=errorText(error);
}
