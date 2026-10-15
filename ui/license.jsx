import { render } from 'preact';

function LicenseStatus({ edition, status, statusKey }) {
  return (
    <div class="license-status-card">
      <div>
        <span class="license-status-label">Current edition</span>
        <strong>{edition}</strong>
      </div>
      <span class="license-status-pill" data-license-status={statusKey}>{status}</span>
    </div>
  );
}

function LicenseInfoGrid({ items }) {
  return (
    <div class="license-info-grid">
      {items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}
    </div>
  );
}

function LicenseDetails({ state }) {
  return <>
    <LicenseStatus edition={state.edition} status={state.status} statusKey={state.statusKey} />
    <LicenseInfoGrid items={state.items} />
    <div class="license-file-path"><span>Licence file</span><code>{state.filePath}</code></div>
    {state.warning ? <div class="license-dialog-warning">{state.warning}</div> : null}
  </>;
}

function normalizeState(detail = {}) {
  return {
    edition:String(detail.edition || 'Community Edition'),
    status:String(detail.status || 'Unknown'),
    statusKey:String(detail.statusKey || 'unknown'),
    items:Array.isArray(detail.items) ? detail.items : [],
    filePath:String(detail.filePath || 'Application directory / license.json'),
    warning:String(detail.warning || '')
  };
}

export function initLicenseUi() {
  const root = document.querySelector('#licenseDetails');
  if (!root) return;

  let state = normalizeState(window.__PFC_LICENSE_UI_STATE__ || {});
  const renderAll = () => render(<LicenseDetails state={state} />, root);

  window.addEventListener('pfc:license-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_LICENSE__ = true;
}
