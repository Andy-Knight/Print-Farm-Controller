import { render } from 'preact';
import { UiButton } from './components.jsx';

const VIEW_LABELS = Object.freeze([
  ['add','Add maintenance tasks'],
  ['model','Model-wide maintenance tasks'],
  ['group','Group-wide maintenance tasks'],
  ['printers','Individual printer tasks']
]);

function dispatchMaintenanceAction(type, value = '') {
  window.dispatchEvent(new CustomEvent('pfc:maintenance-action', {
    detail:{ type, value }
  }));
}

function MaintenanceTabs({ activeView }) {
  return (
    <>
      {VIEW_LABELS.map(([key, label], index) => {
        const active = key === activeView;
        const activateFromKeyboard = (event) => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? VIEW_LABELS.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + VIEW_LABELS.length) % VIEW_LABELS.length;
          const next = VIEW_LABELS[nextIndex][0];
          dispatchMaintenanceAction('view', next);
          requestAnimationFrame(() => document.querySelector(`[data-maintenance-view="${next}"]`)?.focus());
        };
        return (
          <UiButton
            key={key}
            variant="ghost"
            class={`maintenance-view-button${active ? ' active' : ''}`}
            data-maintenance-view={key}
            role="tab"
            aria-selected={active ? 'true' : 'false'}
            tabindex={active ? 0 : -1}
            onClick={() => dispatchMaintenanceAction('view', key)}
            onKeyDown={activateFromKeyboard}
          >
            {label}
          </UiButton>
        );
      })}
    </>
  );
}

function MaintenancePill({ state = '', children }) {
  return <span class="maintenance-pill" data-state={state}>{children}</span>;
}

function ScopePill({ children }) {
  return <span class="maintenance-scope-pill">{children}</span>;
}

function SharedTaskCard({ task }) {
  return (
    <article class="maintenance-model-rule">
      <div class="maintenance-task-main">
        <div class="maintenance-task-title-row">
          <strong>{task.name}</strong>
          <ScopePill>{task.scopeLabel}</ScopePill>
          {task.disabled && <MaintenancePill state="disabled">Disabled</MaintenancePill>}
        </div>
        {task.description && <div class="maintenance-task-description">{task.description}</div>}
        <div class="maintenance-task-meta">
          <span>{task.scheduleLabel}</span>
          <span>{task.applicationText}</span>
          <span>{task.completionText}</span>
        </div>
      </div>
      <div class="mini-actions maintenance-task-actions">
        <UiButton
          variant="primary"
          {...(task.scope === 'model' ? { 'data-maintenance-complete-model':'' } : { 'data-maintenance-complete-group':'' })}
          data-task-id={task.id}
          disabled={!task.completionAllowed}
          aria-disabled={task.completionAllowed ? 'false' : 'true'}
          title={task.completionTitle || ''}
        >
          {task.scope === 'model' ? 'Complete for model' : 'Complete for group'}
        </UiButton>
        <UiButton variant="secondary" data-maintenance-edit data-task-scope={task.scope} data-task-id={task.id}>Edit task</UiButton>
        <UiButton variant="danger" data-maintenance-delete data-task-scope={task.scope} data-task-id={task.id}>Delete task</UiButton>
      </div>
    </article>
  );
}

function SharedTaskSection({ state, scope }) {
  const tasks = scope === 'model' ? state.modelTasks : state.groupTasks;
  if (!tasks.length) {
    const title = scope === 'model' ? 'No model-wide maintenance tasks' : 'No group-wide maintenance tasks';
    const text = scope === 'model'
      ? 'Create a model-wide task from Add maintenance tasks.'
      : 'Create a group-wide task from Add maintenance tasks.';
    return <div class="empty maintenance-empty"><h3>{title}</h3><p>{text}</p></div>;
  }
  const model = scope === 'model';
  return (
    <section class={`maintenance-model-rules${model ? '' : ' maintenance-group-rules'}`}>
      <div class="maintenance-model-rules-head">
        <div>
          <h3>{model ? 'Model-wide maintenance tasks' : 'Group-wide maintenance tasks'}</h3>
          <div class="subtle">
            {model
              ? 'Inherited automatically by every current and future printer of the selected model. Completion state remains independent per printer.'
              : 'Inherited by the printers currently assigned to the selected custom group. Each printer keeps its own completion baseline and history.'}
          </div>
        </div>
        <MaintenancePill>{tasks.length} shared</MaintenancePill>
      </div>
      <div class="maintenance-model-rule-list">
        {tasks.map((task) => <SharedTaskCard key={task.id} task={task} />)}
      </div>
    </section>
  );
}

function PrinterTask({ printerId, task }) {
  return (
    <article class="maintenance-task" data-state={task.state}>
      <div class="maintenance-task-main">
        <div class="maintenance-task-title-row">
          <strong>{task.name}</strong>
          <MaintenancePill state={task.state}>{task.statusLabel}</MaintenancePill>
          <ScopePill>{task.scopeLabel}</ScopePill>
        </div>
        {task.description && <div class="maintenance-task-description">{task.description}</div>}
        <div class="maintenance-task-meta">
          {task.meta.map((line, index) => <span key={index}>{line}</span>)}
        </div>
      </div>
      <div class="mini-actions maintenance-task-actions">
        <UiButton
          variant="primary"
          data-maintenance-complete
          data-task-scope={task.scope}
          data-printer-id={printerId}
          data-task-id={task.id}
          disabled={!task.completionAllowed}
          aria-disabled={task.completionAllowed ? 'false' : 'true'}
          title={task.completionTitle || ''}
        >
          Complete
        </UiButton>
        <UiButton variant="secondary" data-maintenance-edit data-task-scope={task.scope} data-printer-id={printerId} data-task-id={task.id}>
          {task.editText}
        </UiButton>
        <UiButton variant="danger" data-maintenance-delete data-task-scope={task.scope} data-printer-id={printerId} data-task-id={task.id}>
          {task.deleteText}
        </UiButton>
      </div>
    </article>
  );
}

function MaintenanceHistory({ printer }) {
  return (
    <div class="maintenance-history-row">
      <details class="maintenance-history">
        <summary>Recent maintenance history ({printer.historyCount})</summary>
        <div class="maintenance-history-list">
          {printer.history.length ? printer.history.map((entry, index) => (
            <div class="maintenance-history-entry" key={`${entry.completedAt}:${entry.taskName}:${index}`}>
              <strong>{entry.taskName}</strong>
              <span>{entry.completedAt}</span>
              <span>{entry.usage}</span>
              <small class="maintenance-history-scope">{entry.scopeLabel}</small>
              {entry.notes && <div>{entry.notes}</div>}
            </div>
          )) : <div class="subtle">No maintenance has been recorded yet.</div>}
        </div>
      </details>
      <UiButton
        variant="danger"
        class="maintenance-clear-history"
        data-maintenance-clear-history
        data-printer-id={printer.id}
        disabled={printer.historyCount === 0}
        aria-disabled={printer.historyCount === 0 ? 'true' : 'false'}
        title={printer.historyCount === 0 ? 'No maintenance history to clear' : ''}
      >
        Clear history
      </UiButton>
    </div>
  );
}

function PrinterCard({ printer }) {
  return (
    <section class="maintenance-printer-card" data-maintenance-printer-card={printer.id} tabindex="-1">
      <div class="maintenance-printer-head">
        <div>
          <h3>{printer.name}</h3>
          <div class="subtle">{printer.modelLabel}</div>
        </div>
        <div class="maintenance-summary-badges">
          <MaintenancePill state="due">{printer.due} due</MaintenancePill>
          <MaintenancePill state="due_soon">{printer.dueSoon} soon</MaintenancePill>
        </div>
      </div>
      <div class="maintenance-usage">
        <div><span>Observed print time</span><strong>{printer.printHours}</strong></div>
        <div><span>Observed print cycles</span><strong>{printer.printCount}</strong></div>
        <div><span>Tracking</span><strong>Controller observed</strong></div>
      </div>
      <div class="maintenance-task-list">
        {printer.tasks.length
          ? printer.tasks.map((task) => <PrinterTask key={`${task.scope}:${task.id}`} printerId={printer.id} task={task} />)
          : <div class="subtle maintenance-no-tasks">No maintenance tasks configured for this printer.</div>}
      </div>
      <MaintenanceHistory printer={printer} />
    </section>
  );
}

function PrinterList({ state }) {
  if (!state.printers.length) {
    return (
      <div class="empty maintenance-empty">
        <h3>No printers configured</h3>
        <p>Model-wide tasks can still be configured now and will be inherited when matching printers are added.</p>
      </div>
    );
  }
  return <>{state.printers.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}</>;
}

function MaintenanceList({ state }) {
  if (state.activeView === 'add') return null;
  if (state.activeView === 'model') return <SharedTaskSection state={state} scope="model" />;
  if (state.activeView === 'group') return <SharedTaskSection state={state} scope="group" />;
  return <PrinterList state={state} />;
}

function normalizeState(detail = {}) {
  return {
    activeView:['add','model','group','printers'].includes(detail.activeView) ? detail.activeView : 'printers',
    modelTasks:Array.isArray(detail.modelTasks) ? detail.modelTasks : [],
    groupTasks:Array.isArray(detail.groupTasks) ? detail.groupTasks : [],
    printers:Array.isArray(detail.printers) ? detail.printers : []
  };
}

export function initMaintenanceUi() {
  const tabsRoot = document.querySelector('#maintenanceDialog .maintenance-view-selector');
  const listRoot = document.querySelector('#maintenanceList');
  if (!tabsRoot || !listRoot) return;

  let state = normalizeState(window.__PFC_MAINTENANCE_UI_STATE__ || {});
  const renderAll = () => {
    render(<MaintenanceTabs activeView={state.activeView} />, tabsRoot);
    render(<MaintenanceList state={state} />, listRoot);
  };

  window.addEventListener('pfc:maintenance-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_MAINTENANCE__ = true;
}
