import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ProgressBar, UiButton } from './components.jsx';

const DEFAULT_QUEUE_STATE = Object.freeze({
  summary:'No queued prints',
  activeItems:[],
  historyItems:[]
});

function normalizeState(input = {}) {
  return {
    summary:String(input.summary || 'No queued prints'),
    activeItems:Array.isArray(input.activeItems) ? input.activeItems : [],
    historyItems:Array.isArray(input.historyItems) ? input.historyItems : []
  };
}

function PriorityBadge({ item }) {
  return (
    <span
      class={`queue-priority priority-${item.priorityEffective || 'normal'}`}
      title={item.priorityTitle || ''}
    >
      {item.priorityText || 'Normal priority'}
    </span>
  );
}

function QueueStatus({ item }) {
  return (
    <span class={`queue-status ${item.statusClass || ''}`}>
      {item.statusText}{item.progressText ? ` · ${item.progressText}` : ''}
    </span>
  );
}

function Compatibility({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <div class="queue-compatibility">
      {rows.map((row) => (
        <div key={row.key}>
          <b>{row.label}:</b>{' '}
          {row.items.map((entry, index) => (
            <span key={entry.key}>
              {index > 0 && <br />}
              {entry.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function PrioritySelect({ item, production = false }) {
  const attr = production
    ? { 'data-production-priority-select':item.id }
    : { 'data-queue-priority':item.id };
  return (
    <label class="queue-priority-control">
      Priority
      <select key={`${item.id}:${item.priority || 'normal'}`} defaultValue={item.priority || 'normal'} {...attr}>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low</option>
      </select>
    </label>
  );
}

function QueueJob({ item }) {
  return (
    <article
      class={`queue-job queue-job-${item.status || ''}${item.restoreRecoveryHold ? ' queue-job-restore-hold' : ''}`}
      data-queue-job={item.id}
    >
      <div class="queue-job-main">
        <div class="queue-job-title">
          <strong>{item.fileName}</strong>
          <span class="queue-job-badges">
            <PriorityBadge item={item} />
            <QueueStatus item={item} />
          </span>
        </div>
        <div class="queue-job-printer">{item.printerLabel}</div>
        {item.printerTarget && <div class="queue-job-meta">{item.printerTarget}</div>}
        {item.groupTarget && <div class="queue-job-meta">{item.groupTarget}</div>}
        <div class="queue-job-meta">{item.meta}</div>
        {item.selectionReason && <div class="queue-selection-reason">{item.selectionReason}</div>}
        <Compatibility rows={item.compatibility} />
        {item.error && <div class="queue-job-error">{item.error}</div>}
      </div>
      {item.history ? (
        <UiButton variant="secondary" data-queue-reprint={item.id}>Reprint</UiButton>
      ) : (
        <div class="queue-job-actions">
          {['queued','needs_review'].includes(item.status) && <PrioritySelect item={item} />}
          {item.status === 'queued' && (
            <>
              <UiButton
                variant="secondary"
                class="queue-order-button"
                data-queue-up={item.id}
                aria-label="Move queued job earlier within its priority"
                title={`Move earlier within ${item.priorityEffectiveLabel} priority`}
                disabled={!item.canMoveUp}
              >↑</UiButton>
              <UiButton
                variant="secondary"
                class="queue-order-button"
                data-queue-down={item.id}
                aria-label="Move queued job later within its priority"
                title={`Move later within ${item.priorityEffectiveLabel} priority`}
                disabled={!item.canMoveDown}
              >↓</UiButton>
            </>
          )}
          {item.status === 'needs_review' && (
            <UiButton variant="secondary" data-queue-recheck={item.id}>
              {item.restoreRecoveryHold ? 'Review & recheck' : 'Recheck'}
            </UiButton>
          )}
          <UiButton variant="danger" class="queue-cancel-button" data-queue-cancel={item.id}>Cancel</UiButton>
        </div>
      )}
    </article>
  );
}

function ClearanceItem({ item }) {
  return (
    <article class="queue-job queue-job-clearance" data-bed-clearance-printer={item.printerId}>
      <div class="queue-job-main">
        <div class="queue-job-title">
          <strong>Clear build plate</strong>
          <span class="queue-status clearance">Waiting</span>
        </div>
        <div class="queue-job-printer">{item.printerName}</div>
        <div class="queue-job-meta">{item.meta}</div>
        <div class="queue-job-clearance-note">The next queued print is blocked until the build plate has been cleared.</div>
      </div>
      <div class="queue-job-actions">
        <UiButton variant="secondary" data-bed-cleared={item.printerId} disabled={item.pending}>
          {item.pending ? 'Continuing…' : 'Bed cleared · continue'}
        </UiButton>
      </div>
    </article>
  );
}

function ProductionBatch({ item }) {
  return (
    <article
      class={`queue-job production-batch${item.paused ? ' production-paused' : ''}`}
      data-production-card={item.id}
    >
      <div class="queue-job-main">
        <div class="queue-job-title">
          <strong>{item.fileName}</strong>
          <span class="queue-job-badges">
            <PriorityBadge item={item} />
            <span class={`queue-status ${item.statusClass}`}>{item.statusText}</span>
          </span>
        </div>
        <div class="queue-job-printer">Production quantity {item.quantity}</div>
        {item.printerTarget && <div class="queue-job-meta">{item.printerTarget}</div>}
        {item.groupTarget && <div class="queue-job-meta">{item.groupTarget}</div>}
        <div class="production-counts">{item.countsText}</div>
        <ProgressBar value={item.progress} label={`${item.fileName} production progress`} />
        <div class="production-runs">
          {item.runs.map((run) => (
            <div class="production-run" key={run.key}>
              <span>{run.statusText}</span>
              <span>{run.printer}</span>
            </div>
          ))}
          {item.moreRuns > 0 && <div class="subtle">+ {item.moreRuns} more copies</div>}
        </div>
      </div>
      {item.history ? (
        <div class="production-actions">
          <UiButton variant="secondary" data-production-reprint={item.id}>Reprint batch</UiButton>
        </div>
      ) : (
        <div class="production-actions">
          <UiButton variant="secondary" data-production-action={item.paused ? 'resume' : 'pause'} data-production-batch={item.id}>
            {item.paused ? 'Resume production' : 'Pause production'}
          </UiButton>
          <PrioritySelect item={item} production />
          <label class="production-quantity-control">
            Quantity
            <input key={`${item.id}:${item.quantity}`} type="number" min="1" max="999" step="1" defaultValue={item.quantity} data-production-quantity-input={item.id} />
          </label>
          <UiButton variant="secondary" data-production-quantity={item.id}>Update quantity</UiButton>
          {item.cancelable > 0 && (
            <UiButton variant="danger" data-production-action="cancel" data-production-batch={item.id}>Cancel remaining</UiButton>
          )}
        </div>
      )}
    </article>
  );
}

function QueueItem({ item }) {
  if (item.kind === 'clearance') return <ClearanceItem item={item} />;
  if (item.kind === 'production') return <ProductionBatch item={item} />;
  return <QueueJob item={item} />;
}

function QueueList({ items, emptyText }) {
  if (!items.length) return <div class="queue-empty">{emptyText}</div>;
  return <>{items.map((item) => <QueueItem key={`${item.kind}:${item.id}`} item={item} />)}</>;
}

function QueueSummaryRoot({ state }) {
  return <>{state.summary}</>;
}

function QueueActiveRoot({ state }) {
  return <QueueList items={state.activeItems} emptyText="No active, queued or review-blocked jobs." />;
}

function QueueHistoryRoot({ state }) {
  return <QueueList items={state.historyItems} emptyText="Completed, failed and cancelled queued prints will appear here." />;
}

export function initPrintQueueUi() {
  const summaryRoot = document.querySelector('#queueSummary');
  const activeRoot = document.querySelector('#queueActiveList');
  const historyRoot = document.querySelector('#queueHistoryList');
  if (!summaryRoot || !activeRoot || !historyRoot) return;

  let state = normalizeState(window.__PFC_QUEUE_UI_STATE__ || DEFAULT_QUEUE_STATE);
  const renderAll = () => {
    render(<QueueSummaryRoot state={state} />, summaryRoot);
    render(<QueueActiveRoot state={state} />, activeRoot);
    render(<QueueHistoryRoot state={state} />, historyRoot);
  };
  window.addEventListener('pfc:queue-ui-state', (event) => {
    state = normalizeState(event?.detail || DEFAULT_QUEUE_STATE);
    renderAll();
  });
  renderAll();
  window.__PFC_PREACT_QUEUE__ = true;
}
