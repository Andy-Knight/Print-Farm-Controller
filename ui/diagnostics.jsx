import { render } from 'preact';

function DiagnosticsStatus({ items }) {
  return <>{items.map((item) =>
    <div key={item.label}>
      <span>{item.label}</span>
      {item.code ? <code>{item.value}</code> : <strong>{item.value}</strong>}
    </div>
  )}</>;
}

function DiagnosticEntry({ entry }) {
  return (
    <article class={`diagnostic-entry diagnostic-${entry.levelClass}`}>
      <div class="diagnostic-entry-head">
        <span class="diagnostic-level">{entry.level}</span>
        <strong>{entry.subsystem}</strong>
        <time>{entry.time}</time>
      </div>
      <div class="diagnostic-message">{entry.message}</div>
      {entry.meta ? <pre>{entry.meta}</pre> : null}
    </article>
  );
}

function DiagnosticsLog({ entries }) {
  if (!entries.length) return <div class="queue-empty">No matching diagnostic log entries.</div>;
  return <>{entries.map((entry) => <DiagnosticEntry key={entry.key} entry={entry} />)}</>;
}

function normalizeState(detail = {}) {
  return {
    statusItems:Array.isArray(detail.statusItems) ? detail.statusItems : [],
    entries:Array.isArray(detail.entries) ? detail.entries : []
  };
}

export function initDiagnosticsUi() {
  const statusRoot = document.querySelector('#diagnosticsStatus');
  const logRoot = document.querySelector('#diagnosticsLog');
  if (!statusRoot || !logRoot) return;

  let state = normalizeState(window.__PFC_DIAGNOSTICS_UI_STATE__ || {});
  const renderAll = () => {
    render(<DiagnosticsStatus items={state.statusItems} />, statusRoot);
    render(<DiagnosticsLog entries={state.entries} />, logRoot);
  };

  window.addEventListener('pfc:diagnostics-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_DIAGNOSTICS__ = true;
}
