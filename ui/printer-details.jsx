import { render } from 'preact';
import { StatusBadge, UiButton } from './components.jsx';

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

function renderDetailState(detail) {
  const headerRoot = document.querySelector('[data-preact-detail-header]');
  const activityRoot = document.querySelector('[data-preact-detail-activity]');
  const tabsRoot = document.querySelector('[data-preact-detail-tabs]');
  if (headerRoot) render(<PrinterDetailHeader detail={detail} />, headerRoot);
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
