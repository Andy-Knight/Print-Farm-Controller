import { render } from 'preact';
import { UiButton } from './components.jsx';

function PrinterGroupCard({ group }) {
  return (
    <article class="printer-group-card" data-printer-group-card={group.id}>
      <div class="printer-group-card-main">
        <div class="printer-group-card-title">
          <strong>{group.name}</strong>
          <span>{group.countLabel}</span>
        </div>
        <div class="printer-group-card-members">
          {group.members.length
            ? group.members.map((name) => <span key={name}>{name}</span>)
            : <span class="subtle">No printers assigned</span>}
        </div>
      </div>
      <div class="mini-actions">
        <UiButton variant="secondary" data-printer-group-edit={group.id}>Edit</UiButton>
        <UiButton variant="danger" data-printer-group-delete={group.id}>Delete</UiButton>
      </div>
    </article>
  );
}

function PrinterGroupsList({ groups }) {
  if (!groups.length) {
    return (
      <div class="queue-empty">
        No printer groups configured. Create a group above to restrict automatic queue work or assign group-wide maintenance.
      </div>
    );
  }
  return <>{groups.map((group) => <PrinterGroupCard key={group.id} group={group} />)}</>;
}

function normalizeState(detail = {}) {
  return {
    groups:Array.isArray(detail.groups) ? detail.groups : []
  };
}

export function initPrinterGroupsUi() {
  const root = document.querySelector('#printerGroupsList');
  if (!root) return;

  let state = normalizeState(window.__PFC_PRINTER_GROUPS_UI_STATE__ || {});
  const renderAll = () => render(<PrinterGroupsList groups={state.groups} />, root);

  window.addEventListener('pfc:printer-groups-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_PRINTER_GROUPS__ = true;
}
