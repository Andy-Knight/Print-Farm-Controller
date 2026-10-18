import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { StatusBadge, UiButton, UiTab, UiTextField } from './components.jsx';

export const PRINTER_DETAIL_TABS = Object.freeze([
  { key:'toolheads', label:'Toolheads', controls:'detailTabToolheads', icon:'sliders' },
  { key:'camera', label:'Camera', controls:'detailTabCamera', icon:'camera' },
  { key:'files', label:'Files', controls:'detailTabFiles', icon:'files' },
  { key:'temperature', label:'Temperature', fullLabel:'Temperature, Preheat & Fans', controls:'detailTabTemperature', icon:'thermometer' },
  { key:'job', label:'Current Job', controls:'detailTabJob', icon:'clock' },
  { key:'management', label:'Management', fullLabel:'Maintenance & Management', controls:'detailTabManagement' }
]);

function dispatchDetailAction(type, value = '') {
  window.dispatchEvent(new CustomEvent('pfc:printer-detail-action', {
    detail:{ type, value }
  }));
}

function DetailMaintenanceButton({ detail }) {
  const maintenance = detail.maintenance || {};
  return (
    <button
      type="button"
      class="maintenance-status-icon maintenance-status-icon-button maintenance-status-icon-detail"
      data-maintenance-status-icon
      data-maintenance-open-printer={detail.id}
      data-state={maintenance.state || 'none'}
      aria-label={maintenance.actionText || ''}
      title={maintenance.actionText || ''}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z"></path>
      </svg>
    </button>
  );
}

function PrinterDetailFact({ type, label, value, className = '' }) {
  return (
    <div class="printer-detail-fact" data-detail-fact={type}>
      <span class="printer-detail-fact-copy">
        <span class="printer-detail-fact-label">{label}</span>
        <strong class={`printer-detail-fact-value${className ? ' ' + className : ''}`}>{value}</strong>
      </span>
    </div>
  );
}

function PrinterDetailHeader({ detail }) {
  return (
    <div class="dialog-head printer-detail-preact-head printer-detail-rich-head">
      <div class="printer-detail-head-layout">
        <div class="printer-detail-thumbnail">
          {detail.imageKey
            ? <img class="printer-detail-model-image"
                src={`/assets/printers/${detail.imageKey}.webp`}
                alt={detail.model || detail.name || '3D printer'} draggable="false" />
            : <span class="printer-detail-model-fallback" aria-hidden="true">3D<br/>PRINTER</span>}
        </div>
        <div class="printer-detail-head-main">
          <div class="eyebrow">PRINTER DETAILS</div>
          <div class="printer-detail-title-row">
            <h2 data-detail-name>{detail.name}</h2>
            <StatusBadge state={detail.stateClass} title={detail.badgeTitle || ''}>{detail.state}</StatusBadge>
            <DetailMaintenanceButton detail={detail} />
          </div>
          <div class="printer-detail-context printer-detail-facts" aria-label="Printer information">
            <PrinterDetailFact type="model" label="Model" value={detail.model || 'Unknown model'} className="printer-detail-model" />
            <PrinterDetailFact type="connection" label="Connection" value={detail.connection} className="printer-detail-connection" />
            <PrinterDetailFact type="host" label="Host / IP" value={detail.host || '—'} className="printer-detail-host" />
            <PrinterDetailFact type="uptime" label="Uptime" value={detail.uptime} className="printer-detail-uptime" />
            <PrinterDetailFact type="firmware" label="Firmware" value={detail.firmware} className="printer-detail-firmware" />
            <PrinterDetailFact type="health" label="Connection health" value={detail.condition} className="printer-detail-condition" />
          </div>
          <div class="detail-health" data-detail-health>{detail.health}</div>
        </div>
      </div>
      <UiButton
        variant="ghost"
        size="small"
        class="icon printer-detail-close"
        data-detail-close
        aria-label="Close printer details"
        title="Close printer details"
        onClick={() => dispatchDetailAction('close')}
      >
        ×
      </UiButton>
    </div>
  );
}

function PrinterDetailActivity({ detail }) {
  const activity = detail.activity || {};
  if (!activity.active) return null;
  return (
    <div class="detail-activity-banner" data-detail-activity-banner>
      <strong data-detail-activity-title>{activity.title || 'PRINTER ACTIVITY'}</strong>
      <span data-detail-activity-summary>{activity.text || ''}</span>
    </div>
  );
}

function PrinterDetailTabs({ detail }) {
  const activeTab = PRINTER_DETAIL_TABS.some((tab) => tab.key === detail.activeTab)
    ? detail.activeTab
    : PRINTER_DETAIL_TABS[0].key;

  const activateFromKeyboard = (event, tabIndex) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? PRINTER_DETAIL_TABS.length - 1
        : (tabIndex + (event.key === 'ArrowRight' ? 1 : -1) + PRINTER_DETAIL_TABS.length) % PRINTER_DETAIL_TABS.length;
    const next = PRINTER_DETAIL_TABS[nextIndex];
    dispatchDetailAction('tab', next.key);
    requestAnimationFrame(() => {
      document.querySelector(`[data-detail-tab="${next.key}"]`)?.focus();
    });
  };

  return (
    <div class="printer-detail-tabs maintenance-view-selector printer-detail-preact-tabs" data-pfc-tabs role="tablist" aria-label="Printer details">
      {PRINTER_DETAIL_TABS.map((tab, index) => {
        const active = tab.key === activeTab;
        return (
          <UiTab
            icon={tab.icon}
            key={tab.key}
            class={`maintenance-view-button${active ? ' active' : ''}`}
            role="tab"
            id={'printer-detail-tab-' + tab.key}
            data-detail-tab={tab.key}
            aria-controls={tab.controls}
            aria-label={tab.fullLabel || undefined}
            aria-selected={active ? 'true' : 'false'}
            tabindex={active ? 0 : -1}
            onClick={() => dispatchDetailAction('tab', tab.key)}
            onKeyDown={(event) => activateFromKeyboard(event, index)}
          >
            {tab.label}
          </UiTab>
        );
      })}
    </div>
  );
}

// The controller retains ownership of printer caches and the name API. Preact
// owns only the editable draft and the submit lifecycle; telemetry must never
// replace the text while a user is editing it.
function requestControllerRename(printerId, name) {
  return new Promise((resolve,reject) => {
    window.dispatchEvent(new CustomEvent('pfc:printer-detail-action', {
      detail:{type:'rename',printerId,value:name,resolve,reject}
    }));
  });
}

function PrinterNameEditor({ detail }) {
  const [draft,setDraft] = useState(() => ({base:detail.name,value:detail.name}));
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const activeRequest = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setDraft((current) => ({
      base:detail.name,
      value:current.value === current.base ? detail.name : current.value
    }));
  }, [detail.name]);

  const name = draft.value.trim();
  const canEdit = detail.canManage !== false;
  const dirty = name !== draft.base;
  const submit = async (event) => {
    event.preventDefault();
    if (activeRequest.current || !canEdit || !dirty) return;
    if (!name || name.length > 80) {
      setError('Enter a printer name of up to 80 characters.');
      return;
    }
    activeRequest.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const saved = await requestControllerRename(detail.id,name);
      if (mounted.current) {
        setDraft({base:saved,value:saved});
        setStatus('Controller name changed to '+saved+'. Printer-reported name is unchanged.');
      }
    } catch (failure) {
      if (mounted.current) setError(failure?.message || 'Unable to rename this printer.');
    } finally {
      activeRequest.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <form class="printer-name-editor" data-preact-printer-name-editor onSubmit={submit}>
      <UiTextField label="Controller name" id="printerControllerName"
        data-printer-name value={draft.value} maxlength={80} autocomplete="off"
        disabled={busy || !canEdit}
        onInput={(event) => {
          setDraft((current) => ({...current,value:event.currentTarget.value}));
          setError('');
          setStatus('');
        }}
      />
      <div class="mini-actions">
        <UiButton variant="secondary" type="submit" data-rename
          disabled={busy || !canEdit || !dirty || !name || name.length > 80}>
          {busy ? 'Renaming…' : 'Rename printer'}
        </UiButton>
        <UiButton variant="secondary" data-printer-name-reset
          disabled={busy || !canEdit || !dirty}
          onClick={() => {
            setDraft((current) => ({...current,value:current.base}));
            setError('');
            setStatus('');
          }}>Reset</UiButton>
      </div>
      <div class="field-help" data-rename-status role="status" aria-live="polite">
        {status || 'This changes only the name shown by Print Farm Controller; the printer\'s own name is not modified.'}
      </div>
      {error && <div class="error" role="alert" data-printer-name-error>{error}</div>}
    </form>
  );
}


const DEFAULT_MATERIALS = [
  'PLA','PETG','ABS','ASA','TPU','PVA','PA','Nylon','PA-CF','PA-GF',
  'PA6-CF','PA6-GF','PC','PC-ABS','PLA-CF','PETG-CF','ASA-CF',
  'PC-CF','HIPS','PP','PET','PEBA'
];

function requestToolheadDesignation({printerId,mode,toolIndex,operation,values}) {
  return new Promise((resolve,reject) => {
    window.dispatchEvent(new CustomEvent('pfc:printer-detail-action', {
      detail:{type:'toolhead-designation',printerId,mode,toolIndex,operation,values,resolve,reject}
    }));
  });
}

function ToolheadDesignationEditor({printerId,control,readOnly}) {
  const [draft,setDraft] = useState(() => ({...control.values}));
  const [baseline,setBaseline] = useState(() => ({...control.values}));
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const menuRef = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Telemetry can change reported values, but it must not clobber edits.
  useEffect(() => {
    setDraft((previous) => {
      const next={...previous};
      for(const key of Object.keys(control.values)){
        if(previous[key] === baseline[key]) next[key] = control.values[key];
      }
      return next;
    });
    setBaseline({...control.values});
  },[control.values.material,control.values.colorFamily,control.values.color,control.values.nozzleDiameter]);

  const disabled = readOnly || control.enabled === false || busy;
  const dirty = Object.keys(control.values).some((key) => String(draft[key]??'') !== String(baseline[key]??''));
  const filament = control.mode.endsWith('filament');
  const palette = ['creator5-filament','bambu-filament','bambu-ams-filament'].includes(control.mode);
  const colourKey = palette ? 'color' : 'colorFamily';
  const allowedMaterials=[...new Set([draft.material, ...(control.materials||DEFAULT_MATERIALS)].filter(Boolean))];
  const nozzleOptions=control.nozzles || [];
  const colour=(control.colors || []).find((item)=>item.value===draft[colourKey]);
  const set=(key,value)=>{
    setDraft((current)=>({...current,[key]:value}));
    setError('');setStatus('');
  };
  const valid = filament
    ? Boolean(draft.material && colour)
    : nozzleOptions.some((size)=>String(size)===String(draft.nozzleDiameter));
  const perform=async (operation) => {
    if(disabled || pending.current) return;
    if(operation==='save' && !valid){
      setError(filament?(palette?'Choose a filament type and colour.':'Choose a filament type and colour family.'):'Choose a nozzle size from the list.');
      return;
    }
    pending.current=true;
    setBusy(true);setError('');setStatus('');
    try {
      const saved=await requestToolheadDesignation({
        printerId,mode:control.mode,toolIndex:control.toolIndex,
        operation,values:{...draft}
      });
      if(mounted.current){
        const next={...saved};
        setBaseline(next);setDraft(next);
        setStatus(operation==='clear'?'Nozzle designation cleared.':
          filament?(control.mode==='bambu-filament'?'External spool updated and verified on the printer.':control.mode==='bambu-ams-filament'?'AMS slot updated and verified on the printer.':'Filament designation saved.'):'Nozzle designation saved.');
      }
    } catch(failure) {
      if(mounted.current)setError(failure?.message||'Unable to save designation.');
    } finally {
      pending.current=false;
      if(mounted.current)setBusy(false);
    }
  };
  const onSubmit=(event)=>{event.preventDefault();perform('save');};
  return (
    <form class={`toolhead-designation-editor ${filament?'toolhead-designation-filament':'toolhead-designation-nozzle'}`}
      data-preact-toolhead-editor={control.mode} data-tool-index={control.toolIndex}
      onSubmit={onSubmit}>
      {control.mode==='bambu-filament' && <strong class="bambu-external-title">External spool</strong>}
      {filament ? <div class="toolhead-dropdown-pair">
        <label>{control.mode==='controller-filament'?'Controller material type':'Filament type'}
          <select data-toolhead-material value={draft.material} disabled={disabled}
            onChange={(event)=>set('material',event.currentTarget.value)}>
            <option value="">Select type</option>
            {allowedMaterials.map((option)=><option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>{control.mode==='controller-filament'?'Controller colour family':palette?'Colour':'Colour family'}
          <details class={`color-family-dropdown${palette?' creator5-color-dropdown':''}${disabled?' disabled':''}`}
            data-color-family-dropdown ref={menuRef}
            onToggle={(event)=>{if(disabled&&event.currentTarget.open) event.currentTarget.open=false;}}>
            <summary aria-disabled={disabled?'true':'false'}>
              <span class={`color-family-selected${colour?'':' placeholder'}`}>
                {colour && <i class="color-family-square" style={{background:colour.representative}} />}
                <span>{colour?.label||'Select colour'}</span>
              </span>
              <span class="color-family-caret">▾</span>
            </summary>
            <div class="color-family-menu">
              {(control.colors||[]).map((item)=>
                <button type="button" key={item.value}
                  class={`color-family-option${item.value===draft[colourKey]?' selected':''}`}
                  disabled={disabled} data-toolhead-color-option={item.value}
                  onClick={()=>{
                    if(disabled)return;
                    set(colourKey,item.value);
                    if(menuRef.current) menuRef.current.open=false;
                  }}>
                  <i class="color-family-square" style={{background:item.representative}} />
                  <span>{item.label}</span>
                </button>)}
            </div>
          </details>
        </label>
      </div> : <label>{control.mode==='tool-nozzle'
        ? `Physical T${control.toolIndex} nozzle`:'Controller nozzle designation'}
        <select data-toolhead-nozzle value={draft.nozzleDiameter} disabled={disabled}
          onChange={(event)=>set('nozzleDiameter',event.currentTarget.value)}>
          <option value="">Select nozzle size</option>
          {nozzleOptions.map((size)=><option key={size} value={size}>{size} mm</option>)}
        </select>
      </label>}
      <div class="mini-actions">
        <UiButton variant="primary" class="toolhead-action-button" type="submit" data-toolhead-save
          disabled={disabled||!valid||(!dirty&&!['bambu-filament','bambu-ams-filament'].includes(control.mode))}>
          {busy?'Saving…':filament?'Set filament':'Assign'}
        </UiButton>
        {!filament&&control.canClear&&<UiButton variant="secondary" class="toolhead-action-button" data-toolhead-clear
          disabled={disabled} onClick={()=>perform('clear')}>Clear</UiButton>}
      </div>
      {control.help && <div class="field-help">{control.help}</div>}
      {status && <div class="field-help" role="status" aria-live="polite">{status}</div>}
      {error && <div class="error" role="alert" data-toolhead-error>{error}</div>}
    </form>
  );
}

function renderDetailState(detail) {
  const headerRoot = document.querySelector('[data-preact-detail-header]');
  const activityRoot = document.querySelector('[data-preact-detail-activity]');
  const tabsRoot = document.querySelector('[data-preact-detail-tabs]');
  const nameRoot = document.querySelector('[data-preact-printer-management]');
  if (headerRoot) render(<PrinterDetailHeader detail={detail} />, headerRoot);
  if (nameRoot) render(<PrinterNameEditor key={detail.id} detail={detail} />,nameRoot);
  // Each editable island is keyed by printer, tool and control mode, so a
  // refresh of live toolhead status does not recreate its unsaved form state.
  for (const root of document.querySelectorAll('[data-preact-toolhead-control]')) {
    const mode=root.dataset.preactToolheadControl;
    const index=Number(root.dataset.toolIndex||0);
    const control=detail.toolheadControls?.find((item)=>item.mode===mode&&item.toolIndex===index);
    if(control) render(<ToolheadDesignationEditor key={`${detail.id}:${mode}:${index}`}
      printerId={detail.id} control={control} readOnly={detail.canManage===false}/>,root);
  }
  if (activityRoot) render(<PrinterDetailActivity detail={detail} />, activityRoot);
  if (tabsRoot) render(<PrinterDetailTabs detail={detail} />, tabsRoot);
}

export function initPrinterDetailsUi() {
  window.__PFC_PREACT_DETAIL__ = true;
  const current = window.__PFC_PRINTER_DETAIL_STATE__;
  if (current) renderDetailState(current);
  window.addEventListener('pfc:printer-detail-state', (event) => {
    if (event?.detail) renderDetailState(event.detail);
  });
}
