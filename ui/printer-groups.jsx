import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { UiButton, UiCheckboxField, UiTextField } from './components.jsx';

const emptyDraft = () => ({ id:'', name:'', printerIds:[] });
const normalizeState = (detail = {}) => ({
  groups:Array.isArray(detail.groups) ? detail.groups : [],
  printers:Array.isArray(detail.printers) ? detail.printers : []
});

async function groupApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers:options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed (' + response.status + ')');
  return payload;
}

// The application owns the fleet-wide cache and queue/dashboard group selectors.
// After a successful mutation it reloads these once and publishes fresh Preact
// data. The editor keeps its own draft, untouched by telemetry/state refreshes.
function refreshApplicationGroups() {
  return new Promise((resolve,reject) => {
    window.dispatchEvent(new CustomEvent('pfc:printer-groups-reload', {
      detail:{resolve,reject}
    }));
  });
}

function PrinterGroupCard({ group, busy, onEdit, onDelete }) {
  return (
    <article class="printer-group-card" data-printer-group-card={group.id}>
      <div class="printer-group-card-main">
        <div class="printer-group-card-title">
          <strong>{group.name}</strong>
          <span>{group.countLabel}</span>
        </div>
        <div class="printer-group-card-members">
          {group.members.length
            ? group.members.map((name,index) => <span key={index}>{name}</span>)
            : <span class="subtle">No printers assigned</span>}
        </div>
      </div>
      <div class="mini-actions">
        <UiButton variant="secondary" data-printer-group-edit={group.id} disabled={busy} onClick={() => onEdit(group)}>Edit</UiButton>
        <UiButton variant="danger" data-printer-group-delete={group.id} disabled={busy} onClick={() => onDelete(group)}>Delete</UiButton>
      </div>
    </article>
  );
}

function PrinterGroupsList({ groups, busy, onEdit, onDelete }) {
  if (!groups.length) return (
    <div class="queue-empty">
      No printer groups configured. Create a group above to restrict automatic queue work or assign group-wide maintenance.
    </div>
  );
  return <>{groups.map((group) => <PrinterGroupCard key={group.id} group={group} busy={busy} onEdit={onEdit} onDelete={onDelete} />)}</>;
}

function PrinterGroupsWorkspace() {
  const [state,setState] = useState(() => normalizeState(window.__PFC_PRINTER_GROUPS_UI_STATE__));
  const [draft,setDraft] = useState(emptyDraft);
  const [membersQuery,setMembersQuery] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const activeRequest = useRef(false);
  const nameInput = useRef(null);
  const formRef = useRef(null);

  const resetDraft = () => {
    setMembersQuery('');
    setDraft(emptyDraft());
    setError('');
  };

  useEffect(() => {
    const update = (event) => setState(normalizeState(event?.detail));
    const reset = () => { resetDraft(); setStatus(''); };
    const loadingError = (event) => setError(String(event?.detail?.message || 'Unable to load printer groups'));
    window.addEventListener('pfc:printer-groups-ui-state',update);
    window.addEventListener('pfc:printer-groups-editor-reset',reset);
    window.addEventListener('pfc:printer-groups-load-error',loadingError);
    if (window.__PFC_PRINTER_GROUPS_UI_STATE__) setState(normalizeState(window.__PFC_PRINTER_GROUPS_UI_STATE__));
    return () => {
      window.removeEventListener('pfc:printer-groups-ui-state',update);
      window.removeEventListener('pfc:printer-groups-editor-reset',reset);
      window.removeEventListener('pfc:printer-groups-load-error',loadingError);
    };
  }, []);

  const edit = (group) => {
    if (activeRequest.current) return;
    setMembersQuery('');
    setDraft({id:group.id, name:group.name, printerIds:[...(group.printerIds || [])]});
    setError('');
    setStatus('');
    requestAnimationFrame(() => {
      nameInput.current?.focus();
      formRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (activeRequest.current) return;
    const name = draft.name.trim();
    if (!name) { setError('Enter a group name.'); return; }
    activeRequest.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await groupApi(draft.id ? '/api/printer-groups/' + encodeURIComponent(draft.id) : '/api/printer-groups', {
        method:draft.id ? 'PATCH' : 'POST',
        body:JSON.stringify({name,printerIds:draft.printerIds})
      });
      await refreshApplicationGroups();
      setStatus(draft.id ? 'Printer group updated.' : 'Printer group created.');
      resetDraft();
    } catch (failure) {
      setError(failure.message);
    } finally {
      activeRequest.current = false;
      setBusy(false);
    }
  };

  const remove = async (group) => {
    if (activeRequest.current) return;
    if (!window.confirm('Delete printer group “' + group.name + '”?\n\nThe printers themselves will not be removed. Active queue work or maintenance tasks that still reference this group must be removed first.')) return;
    activeRequest.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await groupApi('/api/printer-groups/' + encodeURIComponent(group.id),{method:'DELETE'});
      await refreshApplicationGroups();
      if (draft.id === group.id) resetDraft();
      setStatus('Deleted “' + group.name + '”.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      activeRequest.current = false;
      setBusy(false);
    }
  };

  const selected = new Set(draft.printerIds);
  // A membership lookup avoids scanning every group for every printer.
  // A selected printer stays selected even when hidden by the search filter.
  const otherGroupsByPrinter = useMemo(() => {
    const lookup = new Map();
    for (const group of state.groups) {
      if (group.id === draft.id) continue;
      for (const printerId of group.printerIds || []) {
        if (!lookup.has(printerId)) lookup.set(printerId, []);
        lookup.get(printerId).push(group.name);
      }
    }
    return lookup;
  }, [state.groups, draft.id]);

  const filteredPrinters = useMemo(() => {
    const query = membersQuery.trim().toLocaleLowerCase();
    if (!query) return state.printers;
    return state.printers.filter((printer) =>
      [printer.name, printer.manufacturer, printer.model,
        ...(otherGroupsByPrinter.get(printer.id) || [])]
        .some((value) => String(value || '').toLocaleLowerCase().includes(query))
    );
  }, [membersQuery, state.printers, otherGroupsByPrinter]);

  const updateMembership = (printerId, checked) => {
    setDraft((current) => ({
      ...current,
      printerIds:checked
        ? [...new Set([...current.printerIds, printerId])]
        : current.printerIds.filter((id) => id !== printerId)
    }));
  };

  const updateVisibleMembership = (checked) => {
    if (busy || !filteredPrinters.length) return;
    const visibleIds = new Set(filteredPrinters.map((printer) => printer.id));
    setDraft((current) => ({
      ...current,
      printerIds:checked
        ? [...new Set([...current.printerIds, ...visibleIds])]
        : current.printerIds.filter((id) => !visibleIds.has(id))
    }));
  };

  return (
    <>
      <form id="printerGroupForm" class="printer-group-form" ref={formRef} onSubmit={submit}>
        <div class="printer-group-form-head">
          <strong id="printerGroupFormTitle">{draft.id ? 'Edit printer group' : 'Add printer group'}</strong>
          <div class="field-help">Group membership is independent. Selecting a printer here does not remove it from any other groups.</div>
        </div>
        <UiTextField
          id="printerGroupName" label="Group name" inputRef={nameInput}
          value={draft.name} maxlength={80} placeholder="Production printers" required
          onInput={(event) => setDraft((current) => ({...current,name:event.currentTarget.value}))}
          disabled={busy}
        />
        <div class="printer-group-members-section">
          <div class="printer-group-member-toolbar">
            <UiTextField
              id="printerGroupMemberSearch" class="printer-group-member-search"
              label="Find a printer" type="search" value={membersQuery}
              placeholder="Search printer name, model or group"
              aria-controls="printerGroupMembers"
              onInput={(event) => setMembersQuery(event.currentTarget.value)}
              disabled={busy}
            />
            <span id="printerGroupMemberCount" class="printer-group-member-count" aria-live="polite">
              {selected.size} selected · {filteredPrinters.length} of {state.printers.length} shown
            </span>
          </div>
          <div class="printer-group-member-actions">
            <span class="printer-group-members-label">Members</span>
            <div class="mini-actions">
              <UiButton variant="secondary" size="small" data-printer-group-select-visible
                disabled={busy || !filteredPrinters.length}
                onClick={() => updateVisibleMembership(true)}>Select visible</UiButton>
              <UiButton variant="secondary" size="small" data-printer-group-clear-visible
                disabled={busy || !filteredPrinters.length}
                onClick={() => updateVisibleMembership(false)}>Clear visible</UiButton>
            </div>
          </div>
          <div id="printerGroupMembers" class="printer-group-members"
            role="region" aria-label="Printer group membership table" tabIndex={0}>
            <table class="printer-group-members-table">
              <thead>
                <tr><th scope="col" class="printer-group-member-select-col">Select</th>
                  <th scope="col">Printer</th><th scope="col">Model</th><th scope="col">Other groups</th></tr>
              </thead>
              <tbody>
                {filteredPrinters.length ? filteredPrinters.map((printer,index) => {
                  const otherGroups = otherGroupsByPrinter.get(printer.id) || [];
                  const checkboxId = 'printerGroupMember-' + index;
                  return (
                    <tr key={printer.id} class={selected.has(printer.id) ? 'is-selected' : ''}>
                      <td class="printer-group-member-select-col">
                        <input id={checkboxId} type="checkbox" class="printer-group-member-checkbox"
                          data-printer-group-member value={printer.id} checked={selected.has(printer.id)}
                          aria-label={`Select ${printer.name}`} disabled={busy}
                          onChange={(event) => updateMembership(printer.id, event.currentTarget.checked)} />
                      </td>
                      <td><label class="printer-group-member-name" htmlFor={checkboxId}>{printer.name}</label></td>
                      <td>{[printer.manufacturer,printer.model].filter(Boolean).join(' ') || '—'}</td>
                      <td class="printer-group-member-groups">{otherGroups.join(', ') || '—'}</td>
                    </tr>
                  );
                }) : <tr><td class="printer-group-members-empty" colspan="4">
                  {state.printers.length ? 'No printers match your search.' : 'No printers are configured.'}
                </td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div id="printerGroupError" class={'error' + (error ? '' : ' hidden')} role={error ? 'alert' : undefined}>{error}</div>
        <div class="actions">
          {draft.id && (
            <UiButton id="printerGroupCancelEdit" variant="secondary" disabled={busy}
              onClick={() => {resetDraft();setStatus('');}}>Cancel edit</UiButton>
          )}
          <UiButton id="printerGroupSubmit" variant="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : draft.id ? 'Save group' : 'Create group'}
          </UiButton>
        </div>
      </form>
      <div id="printerGroupsStatus" class="subtle" role="status" aria-live="polite">{status}</div>
      <div id="printerGroupsList" class="printer-groups-list">
        <PrinterGroupsList groups={state.groups} busy={busy} onEdit={edit} onDelete={remove} />
      </div>
    </>
  );
}

export function initPrinterGroupsUi() {
  const root = document.querySelector('#printerGroupsWorkspace');
  if (!root) return;
  render(<PrinterGroupsWorkspace />,root);
  window.__PFC_PREACT_PRINTER_GROUPS__ = true;
}
