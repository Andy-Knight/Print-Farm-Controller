import { render } from 'preact';
import { UiButton, UiTab } from './components.jsx';

const BACKUP_TABS = Object.freeze([
  ['overview','Overview','database'],
  ['google-drive','Google Drive','cloud'],
  ['one-drive','OneDrive','cloud'],
  ['s3','S3-compatible','server'],
  ['schedule','Schedule','calendar'],
  ['restore','Restore','restore']
]);

function dispatchBackupAction(type, value = '') {
  window.dispatchEvent(new CustomEvent('pfc:backup-ui-action', { detail:{ type, value } }));
}

function BackupTabs({ activeTab }) {
  return <>
    {BACKUP_TABS.map(([key, label, icon], index) => {
      const active = key === activeTab;
      const onKeyDown = (event) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? BACKUP_TABS.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + BACKUP_TABS.length) % BACKUP_TABS.length;
        const next = BACKUP_TABS[nextIndex][0];
        dispatchBackupAction('tab', next);
        requestAnimationFrame(() => document.querySelector(`[data-backup-tab="${next}"]`)?.focus());
      };
      return <UiTab
        icon={icon}
        key={key}
        class={`backup-tab${active ? ' active' : ''}`}
        data-backup-tab={key}
        role="tab"
        aria-selected={active ? 'true' : 'false'}
        tabindex={active ? 0 : -1}
        onClick={() => dispatchBackupAction('tab', key)}
        onKeyDown={onKeyDown}
      >{label}</UiTab>;
    })}
  </>;
}

function BackupStatus({ items }) {
  return <>{items.map((item) =>
    <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
  )}</>;
}

function RestoreInspection({ inspection }) {
  if (!inspection) return null;
  return <>
    <div class="restore-valid-banner">
      <strong>Backup is valid</strong>
      <span>Inspection completed without changing controller data.</span>
    </div>
    <div class="restore-inspection-grid">
      {inspection.items.map((item) =>
        <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
      )}
    </div>
    {inspection.warnings.length ? <div class="restore-warning-list">
      <strong>Restore notices</strong>
      <ul>{inspection.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </div> : null}
    <div class="field-help">The backup has passed inspection. Choose Restore backup to stage it for activation on the next controller restart.</div>
  </>;
}

function normalizeState(detail = {}) {
  return {
    activeTab:BACKUP_TABS.some(([key]) => key === detail.activeTab) ? detail.activeTab : 'overview',
    statusItems:Array.isArray(detail.statusItems) ? detail.statusItems : [],
    inspection:detail.inspection && Array.isArray(detail.inspection.items)
      ? { ...detail.inspection, warnings:Array.isArray(detail.inspection.warnings) ? detail.inspection.warnings : [] }
      : null
  };
}

export function initBackupRecoveryUi() {
  const tabsRoot = document.querySelector('#backupRecoveryDialog .backup-tabs');
  const statusRoot = document.querySelector('#backupStatusGrid');
  const inspectionRoot = document.querySelector('#restoreInspectionSummary');
  if (!tabsRoot || !statusRoot || !inspectionRoot) return;

  let state = normalizeState(window.__PFC_BACKUP_UI_STATE__ || {});
  const renderAll = () => {
    render(<BackupTabs activeTab={state.activeTab} />, tabsRoot);
    render(<BackupStatus items={state.statusItems} />, statusRoot);
    render(<RestoreInspection inspection={state.inspection} />, inspectionRoot);
  };

  window.addEventListener('pfc:backup-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_BACKUP__ = true;
}
