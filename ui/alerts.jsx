import { render } from 'preact';
import { UiButton } from './components.jsx';

const ALERT_TABS = Object.freeze([
  { key:'history', label:'Alert history', id:'alertsTabHistory', panel:'alertsPanelHistory' },
  { key:'destinations', label:'Notification destinations', id:'alertsTabDestinations', panel:'alertsPanelDestinations' },
  { key:'rules', label:'Notification rules', id:'alertsTabRules', panel:'alertsPanelRules' }
]);

function dispatchAlertsAction(type, value = '') {
  window.dispatchEvent(new CustomEvent('pfc:alerts-action', { detail:{ type, value } }));
}

function AlertsTabs({ activeTab }) {
  return (
    <>
      {ALERT_TABS.map((tab, index) => {
        const active = tab.key === activeTab;
        const onKeyDown = (event) => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? ALERT_TABS.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + ALERT_TABS.length) % ALERT_TABS.length;
          const next = ALERT_TABS[nextIndex];
          dispatchAlertsAction('tab', next.key);
          requestAnimationFrame(() => document.querySelector(`[data-alerts-tab="${next.key}"]`)?.focus());
        };
        return (
          <UiButton
            key={tab.key}
            id={tab.id}
            variant="ghost"
            class={`maintenance-view-button${active ? ' active' : ''}`}
            data-alerts-tab={tab.key}
            role="tab"
            aria-selected={active ? 'true' : 'false'}
            aria-controls={tab.panel}
            tabindex={active ? 0 : -1}
            onClick={() => dispatchAlertsAction('tab', tab.key)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </UiButton>
        );
      })}
    </>
  );
}

function AlertHistoryTable({ rows, emptyText }) {
  if (!rows.length) return <div class="alerts-empty">{emptyText}</div>;
  return (
    <div class="alert-history-table" role="table" aria-label="Alert history">
      <div class="alert-history-head" role="row">
        <div role="columnheader">Time</div>
        <div role="columnheader">Source / Topic</div>
        <div role="columnheader">Severity</div>
        <div role="columnheader">Message</div>
        <div role="columnheader">Status</div>
        <div role="columnheader">Actions</div>
      </div>
      <div class="alert-history-body" role="rowgroup">
        {rows.map((alert) => (
          <div
            key={alert.id}
            class={`alert-history-row${alert.unread ? ' unread' : ''}`}
            data-severity={alert.severity}
            role="row"
          >
            <div class="alert-history-cell alert-history-time" data-label="Time" role="cell">{alert.time}</div>
            <div class="alert-history-cell alert-history-topic" data-label="Source / Topic" role="cell">
              <strong>{alert.topic}</strong>
              {alert.source && <span>{alert.source}</span>}
            </div>
            <div class="alert-history-cell alert-history-severity" data-label="Severity" role="cell">
              <span class="alert-severity-pill" data-severity={alert.severity}>{alert.severityLabel}</span>
            </div>
            <div class="alert-history-cell alert-history-message" data-label="Message" role="cell">{alert.message}</div>
            <div class="alert-history-cell alert-history-status" data-label="Status" role="cell">{alert.status}</div>
            <div class="alert-history-cell alert-history-action" data-label="Actions" role="cell">
              {alert.unread
                ? <UiButton variant="secondary" class="compact" data-alert-mark-read={alert.id}>Mark read</UiButton>
                : <span class="subtle">—</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DestinationCards({ destinations }) {
  if (!destinations.length) return <div class="alerts-empty">No external notification destinations configured.</div>;
  return (
    <>
      {destinations.map((destination) => (
        <article class="alerts-card" key={destination.id}>
          <div>
            <div class="alerts-card-title">
              <strong>{destination.name}</strong>
              <span class="alert-provider-pill">{destination.providerLabel}</span>
              {!destination.enabled && <span class="alert-disabled-pill">Disabled</span>}
            </div>
            <div class="subtle">{destination.summary}</div>
            <div class="field-help">{destination.auth}</div>
          </div>
          <div class="mini-actions">
            <UiButton variant="secondary" data-alert-destination-test={destination.id}>Test</UiButton>
            <UiButton variant="secondary" data-alert-destination-edit={destination.id}>Edit</UiButton>
            <UiButton variant="danger" data-alert-destination-delete={destination.id}>Delete</UiButton>
          </div>
        </article>
      ))}
    </>
  );
}

function RuleCards({ rules }) {
  if (!rules.length) return <div class="alerts-empty">No external notification rules configured.</div>;
  return (
    <>
      {rules.map((rule) => (
        <article class="alerts-card" key={rule.id}>
          <div>
            <div class="alerts-card-title">
              <strong>{rule.name}</strong>
              {!rule.enabled && <span class="alert-disabled-pill">Disabled</span>}
            </div>
            <div class="subtle">{rule.eventSeverityText}</div>
            <div class="field-help">{rule.deliveryText}</div>
          </div>
          <div class="mini-actions">
            <UiButton variant="secondary" data-alert-rule-edit={rule.id}>Edit</UiButton>
            <UiButton variant="danger" data-alert-rule-delete={rule.id}>Delete</UiButton>
          </div>
        </article>
      ))}
    </>
  );
}

function normalizeState(detail = {}) {
  return {
    activeTab:['history','destinations','rules'].includes(detail.activeTab) ? detail.activeTab : 'history',
    historyRows:Array.isArray(detail.historyRows) ? detail.historyRows : [],
    historyEmptyText:String(detail.historyEmptyText || 'No alerts have been recorded yet.'),
    destinations:Array.isArray(detail.destinations) ? detail.destinations : [],
    rules:Array.isArray(detail.rules) ? detail.rules : []
  };
}

export function initAlertsUi() {
  const tabsRoot = document.querySelector('#alertsDialog .alerts-tabs');
  const historyRoot = document.querySelector('#alertsHistory');
  const destinationsRoot = document.querySelector('#alertDestinationsList');
  const rulesRoot = document.querySelector('#alertRulesList');
  if (!tabsRoot || !historyRoot || !destinationsRoot || !rulesRoot) return;

  let state = normalizeState(window.__PFC_ALERTS_UI_STATE__ || {});
  const renderAll = () => {
    render(<AlertsTabs activeTab={state.activeTab} />, tabsRoot);
    render(<AlertHistoryTable rows={state.historyRows} emptyText={state.historyEmptyText} />, historyRoot);
    render(<DestinationCards destinations={state.destinations} />, destinationsRoot);
    render(<RuleCards rules={state.rules} />, rulesRoot);
  };

  window.addEventListener('pfc:alerts-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_ALERTS__ = true;
}
