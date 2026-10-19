import { render } from 'preact';
import { UiButton } from './components.jsx';

const DEFAULT_LIBRARY_STATE = Object.freeze({
  summary:'Loading library…',
  files:[],
  emptyText:'No files in the Print Library yet. Add a G-code, GX or 3MF file to get started.'
});

function normalizeLibraryState(input = {}) {
  return {
    summary:String(input.summary || 'Loading library…'),
    files:Array.isArray(input.files) ? input.files : [],
    emptyText:String(input.emptyText || DEFAULT_LIBRARY_STATE.emptyText)
  };
}

function LibraryPreview({ file }) {
  if (file.previewUrl) {
    return (
      <button
        type="button"
        class="library-file-preview"
        data-library-preview={file.id}
        title="Open larger preview"
      >
        <img src={file.previewUrl} alt={`Preview of ${file.fileName || 'print file'}`} loading="lazy" />
      </button>
    );
  }
  return (
    <div class="library-file-preview library-file-preview-empty" aria-label="No preview available">
      <span aria-hidden="true">◇</span>
      <small>No preview</small>
    </div>
  );
}

function LibraryColours({ colours = [] }) {
  if (!colours.length) return null;
  return (
    <div class="library-file-colors">
      <span class="library-file-colors-label">Colours</span>
      <div class="library-color-list">
        {colours.map((colour) => (
          <span class="library-color-item" key={colour.hex}>
            <i class="material-swatch" style={{ background:colour.hex }} aria-hidden="true"></i>
            <span>
              <b>{colour.hex}</b>
              <small>{colour.rgb}</small>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LibraryCost({ cost }) {
  return (
    <div class={`library-print-cost${cost?.available ? '' : ' unavailable'}`} data-library-cost>
      <span class="library-print-cost-icon" aria-hidden="true"></span>
      <div class="library-print-cost-copy">
        <span class="library-print-cost-label">Estimated material cost / print</span>
        <strong class="library-print-cost-value">{cost?.value || 'Unavailable'}</strong>
        <small class="library-print-cost-detail">{cost?.detail || 'Filament cost data is unavailable.'}</small>
      </div>
    </div>
  );
}

function LibraryFile({ file }) {
  return (
    <article class="library-file" data-library-file={file.id}>
      <div class="library-file-content">
        <LibraryPreview file={file} />
        <div class="library-file-main">
          <div class="library-file-title">
            <strong>{file.fileName}</strong>
            <span>{file.sizeText}</span>
          </div>
          {file.description && <div class="library-file-description">{file.description}</div>}
          {file.printerTarget && (
            <div class="library-printer-target">
              <span>Printer</span>
              <strong>{file.printerTarget}</strong>
            </div>
          )}
          <div class="library-file-requirements">{file.requirements}</div>
          <LibraryColours colours={file.colours} />
          <LibraryCost cost={file.cost} />
          <div class="library-file-meta">{file.meta}</div>
          {file.warning && <div class="library-warning">{file.warning}</div>}
        </div>
      </div>
      <div class="library-file-actions">
        <UiButton variant="primary" data-library-queue={file.id}>Queue</UiButton>
        <UiButton variant="secondary" data-library-edit={file.id}>Edit details</UiButton>
        <UiButton
          variant="danger"
          data-library-delete={file.id}
          disabled={file.deleteDisabled}
          title={file.deleteTitle || ''}
        >
          Delete
        </UiButton>
      </div>
    </article>
  );
}

function LibrarySummary({ state }) {
  return <>{state.summary}</>;
}

function LibraryList({ state }) {
  if (!state.files.length) return <div class="queue-empty">{state.emptyText}</div>;
  return <>{state.files.map((file) => <LibraryFile key={file.id} file={file} />)}</>;
}

export function initPrintLibraryUi() {
  const summaryRoot = document.querySelector('#librarySummary');
  const listRoot = document.querySelector('#libraryList');
  if (!summaryRoot || !listRoot) return;

  let state = normalizeLibraryState(window.__PFC_LIBRARY_UI_STATE__ || DEFAULT_LIBRARY_STATE);
  const renderAll = () => {
    render(<LibrarySummary state={state} />, summaryRoot);
    render(<LibraryList state={state} />, listRoot);
  };

  window.addEventListener('pfc:library-ui-state', (event) => {
    state = normalizeLibraryState(event?.detail || DEFAULT_LIBRARY_STATE);
    renderAll();
  });

  renderAll();
  window.__PFC_PREACT_LIBRARY__ = true;
}
