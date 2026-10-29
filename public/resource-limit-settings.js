// Shared by the Preact workspace and no-bundle fallback through the native gate.
export function createResourceLimitEditor({call}){
  const form=document.querySelector('#resourceLimitsForm');
  const container=document.querySelector('#resourceLimitFields');
  const status=document.querySelector('#resourceLimitsStatus');
  const notice=document.querySelector('#resourceLimitsRestart');
  const save=document.querySelector('#resourceLimitsSave');
  let fields=null,pending=null,busy=false;
  const display=(value,field)=>String(value/field.scale);
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('auth-error',error);};
  function render(limits){
    fields=limits.fields;
    const groups=new Map();
    container.replaceChildren();
    for(const field of fields){
      let group=groups.get(field.group);
      if(!group){
        const section=document.createElement('fieldset'),legend=document.createElement('legend');
        legend.textContent=field.group;section.append(legend);
        group=document.createElement('div');group.className='resource-limit-grid';section.append(group);
        container.append(section);groups.set(field.group,group);
      }
      const wrapper=document.createElement('div'),label=document.createElement('label');
      const input=document.createElement('input'),help=document.createElement('p');
      input.id='limit-'+field.key;input.name=field.key;input.type='number';input.required=true;
      input.min=display(field.min,field);input.max=display(field.max,field);input.step='any';
      input.value=display(field.saved,field);input.disabled=field.locked;
      input.setAttribute('aria-describedby',input.id+'-help');
      label.htmlFor=input.id;label.textContent=field.label+(field.unit==='count'?'':` (${field.unit})`);
      label.append(input);help.id=input.id+'-help';help.className='field-help';
      help.textContent=`Active: ${display(field.active,field)} · Default: ${display(field.defaultValue,field)}`
        +(field.locked?` · Managed by host: ${field.key}`:'');
      wrapper.append(label,help);group.append(wrapper);
    }
    notice.textContent=limits.restartRequired
      ?'Saved changes are waiting for a controller restart. Active limits remain unchanged until then.'
      :'Saved limits are active. Changes made here take effect after a controller restart.';
    notice.classList.toggle('auth-transport-notice',limits.restartRequired);
    notice.classList.toggle('subtle',!limits.restartRequired);
    save.disabled=false;
  }
  async function load({force=false}={}){
    if(busy||pending)return pending;
    if(fields&&!force)return;
    save.disabled=true;message('Loading resource limits…');
    for(const input of form.querySelectorAll('input,button'))input.disabled=true;
    pending=call('/api/settings/resource-limits').then(data=>{render(data.limits);message('');})
      .catch(error=>message(error.message||'Unable to load resource limits.',true))
      .finally(()=>{
        pending=null;
        for(const button of form.querySelectorAll('button'))button.disabled=false;
        if(fields)for(const field of fields)form.elements.namedItem(field.key).disabled=field.locked;
        save.disabled=!fields;
      });
    return pending;
  }
  form.addEventListener('input',event=>{
    event.target.removeAttribute('aria-invalid');
    message('Unsaved changes. Save, then restart the controller to apply them.');
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!fields)return;
    const overrides={};
    for(const field of fields){
      if(field.locked)continue;
      const input=form.elements.namedItem(field.key),value=Number(input.value)*field.scale;
      if(!Number.isSafeInteger(value)||value<field.min||value>field.max){
        input.setAttribute('aria-invalid','true');
        message(field.label+': enter a positive value in the displayed unit. Counts must be whole numbers; timeouts cannot exceed 24 hours.',true);
        input.focus();return;
      }
      overrides[field.key]=value;
    }
    busy=true;save.disabled=true;form.setAttribute('aria-busy','true');
    // Freeze all editing while a save is in flight, so its response cannot
    // overwrite edits made after submission.
    for(const input of form.querySelectorAll('input,button'))input.disabled=true;
    message('Saving resource limits…');
    try{
      const data=await call('/api/settings/resource-limits',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({overrides})});
      render(data.limits);message(data.limits.restartRequired?'Saved. Restart the controller when active work has finished.':'Saved. No restart is needed because the effective limits are unchanged.');
    }catch(error){message(error.message||'Unable to save resource limits.',true);}
    finally{
      busy=false;form.removeAttribute('aria-busy');
      for(const button of form.querySelectorAll('button'))button.disabled=false;
      for(const field of fields)form.elements.namedItem(field.key).disabled=field.locked;
    }
  });
  document.querySelector('#resourceLimitsDefaults').addEventListener('click',()=>{
    if(!fields||busy)return;
    for(const field of fields)if(!field.locked)form.elements.namedItem(field.key).value=display(field.defaultValue,field);
    message('Default values are ready to save. Host-managed values are unchanged.');
  });
  document.querySelector('#resourceLimitsReload').addEventListener('click',()=>{
    if(!busy)void load({force:true});
  });
  return {load};
}
