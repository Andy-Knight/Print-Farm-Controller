import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { StatusBadge, UiButton, UiTextField } from './components.jsx';

export const PRINTER_DETAIL_TABS = Object.freeze([
  { key:'toolheads', label:'Toolheads', controls:'detailTabToolheads' },
  { key:'camera', label:'Camera', controls:'detailTabCamera' },
  { key:'files', label:'Files', controls:'detailTabFiles' },
  { key:'temperature', label:'Temperature, Preheat & Fans', controls:'detailTabTemperature' },
  { key:'job', label:'Current Job', controls:'detailTabJob' },
  { key:'management', label:'Maintenance & Management', controls:'detailTabManagement' }
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

function PrinterDetailHeader({ detail }) {
  return (
    <div class="dialog-head printer-detail-preact-head">
      <div class="printer-detail-head-main">
        <div class="eyebrow">PRINTER</div>
        <div class="printer-detail-title-row">
          <h2 data-detail-name>{detail.name}</h2>
          <DetailMaintenanceButton detail={detail} />
          <StatusBadge state={detail.stateClass} title={detail.badgeTitle || ''}>{detail.state}</StatusBadge>
        </div>
        <div class="subtle printer-detail-host">{detail.host}</div>
        <div class="detail-health" data-detail-health>{detail.health}</div>
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
    <div class="printer-detail-tabs maintenance-view-selector printer-detail-preact-tabs" role="tablist" aria-label="Printer details">
      {PRINTER_DETAIL_TABS.map((tab, index) => {
        const active = tab.key === activeTab;
        return (
          <UiButton
            key={tab.key}
            variant="ghost"
            class={`maintenance-view-button${active ? ' active' : ''}`}
            role="tab"
            data-detail-tab={tab.key}
            aria-controls={tab.controls}
            aria-selected={active ? 'true' : 'false'}
            tabindex={active ? 0 : -1}
            onClick={() => dispatchDetailAction('tab', tab.key)}
            onKeyDown={(event) => activateFromKeyboard(event, index)}
          >
            {tab.label}
          </UiButton>
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

function renderDetailState(detail) {
  const headerRoot = document.querySelector('[data-preact-detail-header]');
  const activityRoot = document.querySelector('[data-preact-detail-activity]');
  const tabsRoot = document.querySelector('[data-preact-detail-tabs]');
  const nameRoot = document.querySelector('[data-preact-printer-management]');
  if (headerRoot) render(<PrinterDetailHeader detail={detail} />, headerRoot);
  if (nameRoot) render(<PrinterNameEditor key={detail.id} detail={detail} />,nameRoot);
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
