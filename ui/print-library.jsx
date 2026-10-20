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
    emptyText:String(input.emptyText || DEFAULT_LIBRARY_STATE.emptyText),
    pagination:input.pagination || null
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

function LibraryCost({ cost, batchCost='', batchQuantity=1 }) {
  return (
    <div class={`library-print-cost${cost?.available ? '' : ' unavailable'}`} data-library-cost>
      <span class="library-print-cost-icon" aria-hidden="true"></span>
      <div class="library-print-cost-copy">
        <span class="library-print-cost-label">Estimated material cost / print</span>
        <strong class="library-print-cost-value">{cost?.value || 'Unavailable'}</strong>
        {batchCost && <small class="library-batch-estimate">Batch ×{batchQuantity}: {batchCost} material</small>}
        <small class="library-print-cost-detail">{cost?.detail || 'Filament cost data is unavailable.'}</small>
      </div>
    </div>
  );
}

function LibraryFile({ file }) {
  return (
    <article class={`library-file library-file-row${file.selected ? ' is-selected' : ''}`}
      data-library-file={file.id} data-library-selected={file.selected ? 'true' : 'false'} role="listitem">
      <div class="library-cell library-selection-cell">
        <button type="button" class="library-select-button"
          data-library-select={file.id}
          aria-pressed={file.selected ? 'true' : 'false'}
          aria-label={`${file.selected ? 'Deselect' : 'Select'} ${file.fileName}`}
          title={file.selected ? 'Deselect file' : 'Select file'}>
          <span class="library-selection-indicator" aria-hidden="true"></span>
        </button>
      </div>
      <div class="library-cell library-preview-cell">
        <LibraryPreview file={file} />
      </div>
      <div class="library-cell library-file-cell library-file-main">
        <div class="library-file-title"><strong title={file.fileName}>{file.fileName}</strong>
          {file.favourite && <span class="library-fav-mark" title="Favourite">★</span>}
        </div>
        {file.category && <button type="button" class="library-category" data-library-filter-category={file.category}
          aria-label={`Filter library by category: ${file.category}`} title={`Show files in category: ${file.category}`}>{file.category}</button>}
        <button type="button" class={`library-readiness library-readiness-${file.readiness?.level || 'attention'}`}
          data-library-filter-readiness={file.readiness?.level || 'attention'}
          aria-label={`Filter library by status: ${file.readiness?.label || 'Needs attention'}`}
          title={file.readiness?.detail || 'Compatibility checked when queued'}>{file.readiness?.label || 'Needs attention'}</button>
        {file.tags?.length>0 && <div class="library-tags">
          {file.tags.map(tag=><button type="button" class="library-tag" key={tag} data-library-filter-tag={tag}
            aria-label={`Filter library by tag: ${tag}`} title={`Show files tagged: ${tag}`}>{tag}</button>)}
        </div>}
        <small class="library-file-size">{file.sizeText}</small>
        {file.description && <div class="library-file-description">{file.description}</div>}
        {file.warning && <div class="library-warning">{file.warning}</div>}
      </div>
      <div class="library-cell library-target-cell">
        <span class="library-cell-label">Printer</span>
        <span class="library-target-value">{file.printerTarget || 'Any supported printer'}</span>
      </div>
      <div class="library-cell library-requirements-cell">
        <span class="library-cell-label">Filament &amp; requirements</span>
        <div class="library-file-requirements">{file.requirements}</div>
        <div class="library-production-meta">
          <span title="Estimated print duration">⏱ {file.production?.duration || 'Not reported'}</span>
          <span title="Sliced filament usage">◉ {file.production?.weight || 'Not reported'}</span>
        </div>
        <LibraryColours colours={file.colours} />
      </div>
      <div class="library-cell library-cost-cell">
        <LibraryCost cost={file.cost} batchCost={file.batchCost} batchQuantity={file.batchQuantity} />
      </div>
      <div class="library-cell library-lots-cell">
        <span class="library-cell-label">Sale lots</span>
        <strong class="library-lots-value">{file.sale?.lots || 1}</strong>
        <small>per print</small>
      </div>
      <div class="library-cell library-sale-cell">
        <div class={`library-sale-price${file.sale?.available ? '' : ' unavailable'}`}
          title={file.sale?.detail || ''}>
          <span class="library-cell-label">Suggested sell price</span>
          <strong class="library-sale-value">{file.sale?.available
            ? (file.sale?.lots>1 ? file.sale.perLot : file.sale.price) : 'Unavailable'}</strong>
          <small>{file.sale?.available
            ? (file.sale?.lots>1 ? 'per sale lot' : 'per print') : 'No complete price estimate'}</small>
          {file.sale?.available && file.sale.lots>1 && <small>Print total: {file.sale.price}</small>}
        </div>
      </div>
      <div class="library-cell library-history-cell">
        <span class="library-cell-label">History</span>
        <strong>{file.historyCount}</strong>
        <span>{file.historyLast}</span>
        <small>{file.historyAdded}</small>
      </div>
    </article>
  );
}

function LibrarySummary({ state }) {
  return <>{state.summary}</>;
}

function LibraryPagination({ pagination }) {
  if(!pagination || pagination.pages<=1) return null;
  return (
    <nav class="library-pagination" role="listitem" aria-label="Library result pages">
      <span>Showing {pagination.from}–{pagination.to} of {pagination.count}</span>
      <button type="button" class="secondary" data-library-page="previous"
        disabled={pagination.page===0}>Previous</button>
      <span>Page {pagination.page+1} / {pagination.pages}</span>
      <button type="button" class="secondary" data-library-page="next"
        disabled={pagination.page===pagination.pages-1}>Next</button>
    </nav>
  );
}

function LibraryList({ state }) {
  if (!state.files.length) return <div class="queue-empty">{state.emptyText}</div>;
  return <>{state.files.map((file) => <LibraryFile key={file.id} file={file} />)}
    <LibraryPagination pagination={state.pagination} />
  </>;
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
