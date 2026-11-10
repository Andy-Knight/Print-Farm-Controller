import { orientPrinterMapFurniture, printerMapFurnitureArtwork } from './printer-map-artwork.js';
import { createPrinterMapPerson } from './printer-map-person.js';
import { fixedItemSizes } from './printer-map-fixed-sizes.js';
import { defaultRackSize, rackBayBounds } from './printer-map-rack.js';
import { createRackView } from './printer-map-rack-view.js';

const endpoint = '/api/printer-maps';
const preferenceKey = 'pfc-printer-map';
const motionPreferenceKey = 'pfc-printer-map-motion';
const bedClearanceIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">
  <path d="M5 8V3h6v5M3 9h10l2 4H1zM5 11h6"/>
</svg>`;
const defaultRoomSteps = 50;
const unlabelledTypes = new Set(['floor', 'bench', 'rack', 'shelf', 'window', 'plant-pot', 'chair', 'stool', 'computer', 'bin']);
const rotatableFurniture = new Set(['chair', 'computer']);
const itemTypes = {
  floor:{ name:'Floor', size:[600, 400] },
  label:{ name:'Label', size:[240, 60] },
  zone:{ name:'Zone', size:[420, 320] },
  bench:{ name:'Bench', size:[280, 140] },
  rack:{ name:'Rack', size:[220, 100] },
  shelf:{ name:'Shelf', size:[200, 80] },
  wall:{ name:'Wall', size:[340, 40] },
  door:{ name:'Door', size:[120, 80] },
  rectangle:{ name:'Rectangle', size:[220, 160] },
  line:{ name:'Line', size:[260, 40] },
  'plant-pot':{ name:'Plant pot', size:[80, 80] },
  window:{ name:'Window', size:[160, 40] },
  chair:{ name:'Chair', size:fixedItemSizes.chair },
  stool:{ name:'Stool', size:fixedItemSizes.stool },
  computer:{ name:'Computer', size:fixedItemSizes.computer },
  controller:{ name:'Controller', size:[100, 80] },
  bin:{ name:'Bin', size:[60, 60] }
};
const paletteSymbols = {
  floor:'<path d="M24 8 43 18 24 28 5 18 24 8ZM5 25l19 10 19-10M5 32l19 10 19-10"/>',
  label:'<path d="M10 13h28M24 13v24m-7 0h14"/>',
  zone:'<rect x="6" y="8" width="36" height="32" rx="2" stroke-dasharray="4 4"/>',
  bench:'<path d="M7 15h34v9H7zm4 9v12m26-12v12"/>',
  rack:'<path d="M8 8h32v32H8zM8 19h32M8 29h32M19 8v32M29 8v32"/>',
  shelf:'<path d="M5 15h38v9H5zM10 24v10l10-10m18 0v10L28 24"/>',
  bin:'<path d="M9 12h30M18 12V7h12v5m-17 0 2 28h18l2-28M21 19v14m6-14v14"/>',
  wall:'<path d="M5 11h38v26H5zM5 24h38M18 11v13m12 0v13"/>',
  door:'<path d="M6 35h7m23 0h6M13 35V12m0 0a23 23 0 0 1 23 23" />',
  rectangle:'<rect x="6" y="12" width="36" height="24" rx="2"/>',
  line:'<path d="M8 35 40 13"/>',
  controller:`<rect x="4" y="8" width="40" height="32" rx="6"/>
    <path d="m24 13 12 6-12 6-12-6 12-6Zm-12 12 12 6 12-6m-24 6 12 6 12-6"/>`,
  window:`<rect x="2" y="4" width="44" height="40" rx="1"/>
    <path d="M2 24h44m-22-20v40"/>`
};
const objectSymbols = {
  'plant-pot':`<circle cx="24" cy="24" r="18"/>
    <path d="M24 26C14 23 13 18 13 14c6 0 10 4 11 12Zm0 0c-2-8 1-13 6-15 3 5 1 11-6 15Zm0 0c5-7 11-7 14-4-3 5-8 7-14 4Zm0 0c3 5 2 8-1 11-4-2-5-6 1-11Z"/>`,
  window:`<g class="printer-map-window-plan">
    <rect class="printer-map-window-frame"/>
    <rect class="printer-map-window-glass"/>
    <path class="printer-map-window-glazing"/>
    <path class="printer-map-window-mullions"/>
  </g>`,
  chair:`<rect x="12" y="15" width="24" height="25" rx="5"/>
    <rect x="8" y="6" width="32" height="8" rx="3"/>
    <path d="M6 19v13m36-13v13"/>`,
  stool:`<circle cx="24" cy="24" r="13"/>
    <path d="m15 15-6-6m24 6 6-6M15 33l-6 6m24-6 6 6"/>`,
  computer:`<rect x="7" y="5" width="34" height="17" rx="2"/>
    <path d="M24 22v6m-7 0h14"/>
    <rect x="9" y="33" width="30" height="10" rx="2"/>
    <path d="M15 38h18"/>`
};

export function createPrinterMapPage({ api, canEdit, openPrinter, openAlerts, openQueue, clearBed, displayOnly = false }) {
  const page = document.querySelector('#printerMapPage');
  const room = page.querySelector('#printerMapSelect');
  const roomControls = room?.closest('.printer-map-room-controls');
  const create = page.querySelector('#printerMapNew');
  const edit = page.querySelector('#printerMapEdit');
  const reload = page.querySelector('#printerMapReload');
  const enterFullscreen = page.querySelector('#printerMapEnterFullscreen');
  const monitoringLink = page.querySelector('#printerMapMonitoringLink');
  const linkDialog = page.querySelector('#printerMapLinkDialog');
  const fullscreenDialog = page.querySelector('#printerMapFullscreen');
  const fullscreenTitle = page.querySelector('#printerMapFullscreenTitle');
  if (!displayOnly) fullscreenTitle.before(document.querySelector('.sidebar-brand .brand-lockup').cloneNode(true));
  const fullscreenStage = page.querySelector('#printerMapFullscreenStage');
  const exitFullscreen = page.querySelector('#printerMapExitFullscreen');
  const form = page.querySelector('#printerMapEditor');
  const name = form?.elements.mapName;
  const available = form?.querySelector('#printerMapAvailable');
  const availableSummary = available?.querySelector('summary');
  const availableOptions = available?.querySelector('.printer-map-printer-options');
  const availableCount = available?.querySelector('[data-map-picked-count]');
  const mapColumns = form?.elements.mapColumns;
  const mapRows = form?.elements.mapRows;
  const printerDensity = form?.elements.printerDensity;
  const palette = page.querySelector('#printerMapPalette');
  const itemPreview = page.querySelector('#printerMapItemPreview');
  const status = page.querySelector('#printerMapStatus');
  const error = page.querySelector('#printerMapError');
  const help = page.querySelector('#printerMapHelp');
  const viewport = page.querySelector('#printerMapViewport');
  const viewportNext = viewport.nextElementSibling;
  const canvas = page.querySelector('#printerMapCanvas');
  const box = page.querySelector('#printerMapBox');
  const benchGuide = page.querySelector('#printerMapBenchGuide');
  const groupStatus = page.querySelector('#printerMapGroup');
  const itemLayer = page.querySelector('#printerMapItems');
  const floorResizes = [...page.querySelectorAll('.printer-map-floor-resize')];
  const itemEditor = page.querySelector('#printerMapItemEditor');
  const selectedItem = page.querySelector('#printerMapSelectedItem');
  const inlineLabel = page.querySelector('#printerMapInlineLabel');
  const itemFields = itemEditor?.elements;
  const doorDirection = page.querySelector('#printerMapDoorDirection');
  const lineOrientation = page.querySelector('#printerMapLineAxis');
  const canvasStyle = getComputedStyle(canvas);
  const gridStep = Number(canvasStyle.getPropertyValue('--map-grid-step'));
  const gridPixels = parseFloat(canvasStyle.getPropertyValue('--map-dot-spacing'));
  const gridOffset = gridStep / 2;
  const personScale = gridPixels / gridStep;
  const person = createPrinterMapPerson(canvas, {
    step:gridStep, scale:personScale, getItemNode:id => itemNodes.get(id)
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const motionSwitches = page.querySelectorAll('[data-map-motion]');
  let motionOverride = null;
  try {
    const savedMotion = localStorage.getItem(motionPreferenceKey);
    if (savedMotion === 'on' || savedMotion === 'off') motionOverride = savedMotion === 'on';
  } catch {}
  let personWalls = [];
  const doorways = [];
  const shelf = page.querySelector('#printerMapUnplaced');
  const selection = page.querySelector('#printerMapSelection');
  const actions = Object.fromEntries([...page.querySelectorAll('[data-map-action]')]
    .map(button => [button.dataset.mapAction, button]));
  const markers = new Map();
  const pendingClearances = new Set();
  const itemNodes = new Map();
  const paletteButtons = new Map();
  let maps = [];
  let printers = [];
  let activeId = '';
  let selected = new Set();
  let draft = null;
  let drag = null;
  let paletteDrag = null;
  let suppressPaletteClick = false;
  let labelItem = null;
  let busy = false;
  let loaded = false;
  let nativeFullscreen = false;
  let previousScroll;
  let openRackId = '';
  const rackView = createRackView(page, {
    setOptions,
    onClose:() => {
      if (rackView.dialog.open) return;
      openRackId = '';
      renderMarkers();
      fitFullscreen();
    },
    onResize:resizeRack,
    onAssign:assignRackSlot
  });

  for (const [type, { name: itemName }] of displayOnly ? [] : Object.entries(itemTypes)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-button ui-button-secondary ui-button-medium secondary';
    button.dataset.mapItemType = type;
    button.title = itemName;
    button.setAttribute('aria-label', `Add ${itemName.toLowerCase()}`);
    button.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paletteSymbols[type] ?? objectSymbols[type]}</svg>`;
    palette.append(button);
    paletteButtons.set(type, button);
  }

  function rememberRoom() {
    try { localStorage.setItem(preferenceKey, activeId); } catch {}
  }

  function currentMap() {
    return displayOnly ? maps[0] : draft || maps.find(map => map.id === activeId);
  }

  function rackName(map, rack) {
    return `Rack ${map.items.filter(item => item.type === 'rack').indexOf(rack) + 1}`;
  }

  function openRack(rack) {
    if (!rack || busy || rackView.dialog.open) return;
    if (draft && !rack.levels) Object.assign(rack, defaultRackSize);
    if (!rack.levels) return;
    openRackId = rack.id;
    (fullscreenDialog?.open ? fullscreenDialog : page).append(rackView.dialog);
    rackView.showError('');
    rackView.dialog.showModal();
    renderMarkers();
  }

  function resizeRack(levels, bays) {
    const rack = draft?.items.find(item => item.id === openRackId);
    if (!rack || busy) return;
    if (draft.placements.some(item => item.rackId === rack.id && (item.level > levels || item.bay > bays))) {
      rackView.showError('Empty the affected slots before reducing the number of levels or bays.');
    } else {
      Object.assign(rack, { levels, bays });
      rackView.showError('');
    }
    renderMarkers();
  }

  function assignRackSlot(level, bay, printerId) {
    if (!draft || busy || !openRackId) return;
    draft.placements = draft.placements.filter(item => {
      const keep = item.printerId !== printerId && !(item.rackId === openRackId && item.level === level && item.bay === bay);
      if (!keep) selected.delete(item);
      return keep;
    });
    if (printerId) draft.placements.push({ printerId, rackId:openRackId, level, bay });
    rackView.showError('');
    renderMarkers();
  }

  function setOptions(select, options, value) {
    if (select.options.length !== options.length || options.some(([id, label], index) =>
      select.options[index]?.value !== id || select.options[index]?.text !== label)) {
      select.replaceChildren(...options.map(([id, label]) => new Option(label, id)));
    }
    select.value = value;
    if (select.selectedIndex === -1) select.selectedIndex = 0;
  }

  function updateAvailableCount() {
    const count = availableOptions.querySelectorAll('input:checked').length;
    setText(availableCount, `(${count} selected)`);
    availableCount.hidden = count === 0;
    actions.add.disabled = busy || count === 0;
  }

  function renderAvailablePrinters(unplaced) {
    const inputs = [...availableOptions.querySelectorAll('input')];
    if (!availableOptions.firstChild || inputs.length !== unplaced.length || unplaced.some((printer, index) =>
      inputs[index].value !== printer.id || inputs[index].nextElementSibling.textContent !== printer.name)) {
      const checked = new Set(inputs.filter(input => input.checked).map(input => input.value));
      const focused = inputs.includes(document.activeElement) ? document.activeElement.value : null;
      availableOptions.replaceChildren(...unplaced.map(printer => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = printer.id;
        input.checked = checked.has(printer.id);
        const text = document.createElement('span');
        text.textContent = printer.name;
        label.append(input, text);
        return label;
      }));
      if (!unplaced.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No unplaced printers.';
        availableOptions.append(empty);
      }
      if (focused) ([...availableOptions.querySelectorAll('input')].find(input => input.value === focused)
        || availableSummary).focus({ preventScroll:true });
    }
    updateAvailableCount();
  }

  function updateMarkerPosition(marker, placement) {
    marker.style.setProperty('--map-x', placement.x / gridStep);
    marker.style.setProperty('--map-y', placement.y / gridStep);
  }

  function roomBounds() {
    const map = currentMap();
    return {
      width:(map?.columns ?? defaultRoomSteps) * gridStep,
      height:(map?.rows ?? defaultRoomSteps) * gridStep
    };
  }

  function renderRoomGeometry() {
    const { width, height } = roomBounds();
    canvas.style.setProperty('--map-columns', width / gridStep);
    canvas.style.setProperty('--map-rows', height / gridStep);
    canvas.classList.toggle('is-compact', Boolean(currentMap()?.compactPrinters));
  }

  function syncPerson() {
    const map = currentMap();
    const hasPerson = !draft && map?.items?.some(item => item.type === 'computer');
    const motionEnabled = motionOverride ?? !reducedMotion.matches;
    const showMotion = Boolean(hasPerson && motionEnabled && !page.hidden && !document.hidden);
    canvas.classList.toggle('is-character-animated', showMotion);
    for (const control of motionSwitches) {
      control.hidden = !hasPerson;
      control.setAttribute('aria-checked', String(motionEnabled));
    }
    if (!hasPerson || page.hidden || document.hidden) {
      person.stop();
      return;
    }
    const printerWidth = parseFloat(canvasStyle.getPropertyValue('--map-marker-width')) / personScale;
    const printerHeight = parseFloat(canvasStyle.getPropertyValue('--map-marker-height')) / personScale;
    const racks = new Map(map.items.filter(item => item.levels).map(item => [item.id, item]));
    const placements = map.placements.filter(item => markers.has(item.printerId)).map(item => ({
      id:item.printerId,
      ...(item.rackId ? rackBayBounds(racks.get(item.rackId), item.bay)
        : { x:item.x, y:item.y, width:printerWidth, height:printerHeight })
    }));
    person.update({ ...roomBounds(), map, tiles:printers, walls:personWalls, doorways, motionEnabled,
      printers:placements
    });
  }

  new MutationObserver(syncPerson).observe(page, { attributes:true, attributeFilter:['hidden'] });
  document.addEventListener('visibilitychange', syncPerson);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) for (const marker of markers.values()) stopTileEffects(marker);
    syncPerson();
  });
  for (const control of motionSwitches) {
    control.addEventListener('click', () => {
      motionOverride = !(motionOverride ?? !reducedMotion.matches);
      try { localStorage.setItem(motionPreferenceKey, motionOverride ? 'on' : 'off'); } catch {}
      syncPerson();
    });
  }

  function applyRoomDimensions() {
    if (!draft || busy || !mapColumns.validity.valid || !mapRows.validity.valid) return false;
    const columns = mapColumns.valueAsNumber;
    const rows = mapRows.valueAsNumber;
    const width = columns * gridStep;
    const height = rows * gridStep;
    if (draft.placements.some(printer => printer.x > width || printer.y > height)
        || draft.items.some(item => item.x + item.width > width || item.y + item.height > height)) {
      setText(error, 'Move or resize the printers and items outside the requested room size before shrinking the map.');
      return false;
    }
    Object.assign(draft, { columns, rows });
    setText(error, '');
    renderRoomGeometry();
    renderItems();
    return true;
  }

  function makeMarker(printerId) {
    const tile = document.createElement('div');
    const action = displayOnly ? 'span' : 'button';
    const type = displayOnly ? '' : ' type="button"';
    const clearanceTag = !displayOnly && clearBed ? 'button' : 'span';
    const clearanceAttrs = clearanceTag === 'button'
      ? 'type="button" data-map-printer-action="clear-bed" title="Mark bed cleared"'
      : 'role="img" aria-label="Bed needs clearing" title="Bed needs clearing"';
    tile.className = 'printer-map-marker';
    tile.dataset.printerId = printerId;
    tile.innerHTML = `<${action}${type} class="printer-map-details" data-map-printer-action="details">
      <img class="printer-map-model" alt="" draggable="false" hidden>
      <svg class="printer-map-placeholder" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5zM8 16h8m-4-8v4"/></svg>
      <strong></strong>
    </${action}>
    <span class="printer-map-flags">
      <${action}${type} class="printer-map-alert" data-map-printer-action="alerts" hidden>Alert</${action}>
      <span class="printer-map-printing" hidden>Printing</span>
      <${action}${type} class="printer-map-queued" data-map-printer-action="queue"></${action}>
    </span>
    <${clearanceTag} class="printer-map-clearance" ${clearanceAttrs} hidden>
      ${bedClearanceIcon}
    </${clearanceTag}>
    <span class="printer-map-bay-level" role="img" hidden></span>
    <span class="printer-map-progress" role="progressbar" hidden></span>`;
    const marker = {
      tile, image:tile.querySelector('img'), placeholder:tile.querySelector('.printer-map-placeholder'),
      details:tile.querySelector('.printer-map-details'), label:tile.querySelector('strong'), alert:tile.querySelector('.printer-map-alert'),
      printing:tile.querySelector('.printer-map-printing'), queued:tile.querySelector('.printer-map-queued'),
      clearance:tile.querySelector('.printer-map-clearance'), progress:tile.querySelector('.printer-map-progress'),
      bayLevel:tile.querySelector('.printer-map-bay-level'),
      effects:new Map()
    };
    markers.set(printerId, marker);
    return marker;
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function stopTileEffects(marker) {
    for (const effect of marker.effects.values()) effect.cancel();
    marker.effects.clear();
  }

  function updateTileActivity(marker, printer, mapId) {
    marker.clearance.hidden = !printer.bedClearance;
    marker.progress.hidden = !printer.printing || !Number.isFinite(printer.progress);
    if (!marker.progress.hidden) {
      marker.progress.setAttribute('aria-label', `Print progress for ${printer.name}`);
      marker.progress.setAttribute('aria-valuenow', String(printer.progress));
      marker.progress.style.setProperty('--map-print-progress', printer.progress / 100);
    }
    const previous = marker.previousMap === mapId ? marker.previousActivity : null;
    marker.previousMap = mapId;
    marker.previousActivity = { online:printer.online, alert:printer.alert,
      alertAt:Math.max(previous?.alertAt || 0, printer.alertAt || 0),
      completedAt:Math.max(previous?.completedAt || 0, printer.completedAt || 0),
      queueStartedAt:Math.max(previous?.queueStartedAt || 0, printer.queueStartedAt || 0)
    };
    if (!previous || !mapId || draft || page.hidden || document.hidden || reducedMotion.matches) {
      stopTileEffects(marker);
      return;
    }
    const pulse = (name, target, frames, duration) => {
      marker.effects.get(name)?.cancel();
      const effect = target.animate(frames, { duration, easing:'ease-out', id:name });
      marker.effects.set(name, effect);
      const forget = () => {
        if (marker.effects.get(name) === effect) marker.effects.delete(name);
      };
      effect.finished.then(forget, forget);
    };
    const highlight = (colour, width) => [
      { boxShadow:`inset 0 0 0 ${width}px var(${colour})` },
      { boxShadow:'inset 0 0 0 0 transparent' }
    ];
    if (printer.completedAt > previous.completedAt) {
      pulse('map-print-complete', marker.tile, highlight('--ds-success', 3), 1500);
    }
    if (printer.alert && (!previous.alert || printer.alertAt > previous.alertAt)) {
      pulse('map-new-alert', marker.alert, [{ scale:1 }, { scale:1.15, offset:.35 }, { scale:1 }], 650);
    }
    if (printer.queueStartedAt > previous.queueStartedAt) {
      pulse('map-next-job', marker.queued, highlight('--ds-brand', 2), 1100);
    }
    if (printer.online === true && previous.online === false) {
      pulse('map-reconnect', marker.tile, [{ opacity:.6 }, { opacity:1 }], 800);
    }
  }

  function fitFullscreen() {
    if (!displayOnly && !fullscreenDialog.open) return;
    const canvasWidth = canvas.offsetWidth;
    const canvasHeight = canvas.offsetHeight;
    if (!canvasWidth || !canvasHeight) return;
    const contents = canvas.querySelectorAll('.printer-map-marker:not(.is-rack-projected, [hidden]), .printer-map-item');
    let left = 0;
    let top = 0;
    let right = canvasWidth;
    let bottom = canvasHeight;
    if (contents.length) {
      left = canvasWidth;
      top = canvasHeight;
      right = 0;
      bottom = 0;
      // Both the printer tiles and the room item layer share the canvas origin.
      for (const node of contents) {
        left = Math.min(left, node.offsetLeft);
        top = Math.min(top, node.offsetTop);
        right = Math.max(right, node.offsetLeft + node.offsetWidth);
        bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
      }
      left -= gridPixels;
      top -= gridPixels;
      right += gridPixels;
      bottom += gridPixels;
    }
    const width = right - left;
    const height = bottom - top;
    const scale = Math.min(viewport.clientWidth / width, viewport.clientHeight / height);
    fullscreenStage.style.setProperty('--map-fit-scale', scale);
    fullscreenStage.style.setProperty('--map-fit-x', `${(viewport.clientWidth - width * scale) / 2 - left * scale}px`);
    fullscreenStage.style.setProperty('--map-fit-y', `${(viewport.clientHeight - height * scale) / 2 - top * scale}px`);
    const crop = [top, canvasWidth - right, canvasHeight - bottom, left]
      .map(value => `${Math.max(0, value)}px`).join(' ');
    fullscreenStage.style.setProperty('--map-fit-crop', crop);
  }

  const fullscreenResize = new ResizeObserver(fitFullscreen);
  if (displayOnly) {
    fullscreenResize.observe(viewport);
    return {
      show(map, tiles = []) {
        maps = map ? [map] : [];
        printers = tiles;
        setText(fullscreenTitle, map?.name || 'Printer map');
        fullscreenTitle.title = map?.name || '';
        renderRoomGeometry();
        renderItems();
        renderMarkers();
        syncPerson();
        fitFullscreen();
      }
    };
  }

  const linkField = linkDialog.querySelector('#printerMapLinkField');
  const linkInput = linkField.querySelector('input');
  const linkStatus = linkDialog.querySelector('#printerMapLinkStatus');
  const linkActions = Object.fromEntries([...linkDialog.querySelectorAll('[data-map-link]')]
    .map(button => [button.dataset.mapLink, button]));
  let linkRequest = 0;

  function showDisplayLink(token) {
    linkInput.value = token ? new URL(`/map-display#${token}`, location.origin).href : '';
    linkField.hidden = linkActions.copy.hidden = linkActions.disable.hidden = !token;
    setText(linkActions.generate, token ? 'Replace link' : 'Create link');
  }

  async function loadDisplayLink(method = 'GET') {
    const map = currentMap();
    if (!map?.id || draft || !canEdit()) return;
    const request = ++linkRequest;
    linkActions.generate.disabled = linkActions.disable.disabled = linkActions.copy.disabled = true;
    setText(linkStatus, method === 'GET' ? 'Loading link…' : 'Updating link…');
    try {
      const { token } = await api(`${endpoint}/${encodeURIComponent(map.id)}/display-link`, { method });
      if (request !== linkRequest || !linkDialog.open) return;
      showDisplayLink(token);
      setText(linkStatus, token ? '' : 'No monitoring link is enabled for this map.');
    } catch (error) {
      if (request === linkRequest) setText(linkStatus, error.message);
    } finally {
      if (request === linkRequest) {
        linkActions.generate.disabled = linkActions.disable.disabled = linkActions.copy.disabled = false;
      }
    }
  }

  monitoringLink.addEventListener('click', () => {
    showDisplayLink('');
    linkDialog.showModal();
    loadDisplayLink();
  });
  linkActions.generate.addEventListener('click', () => loadDisplayLink('POST'));
  linkActions.disable.addEventListener('click', () => loadDisplayLink('DELETE'));
  linkActions.close.addEventListener('click', () => linkDialog.close());
  linkActions.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(linkInput.value);
      if (linkDialog.open) setText(linkStatus, 'Link copied.');
    } catch {
      if (!linkDialog.open) return;
      linkInput.focus();
      linkInput.select();
      setText(linkStatus, 'Copy the selected display URL.');
    }
  });
  linkDialog.addEventListener('close', () => {
    linkRequest += 1;
    showDisplayLink('');
    setText(linkStatus, '');
  });

  const fullscreenUpdates = new MutationObserver(() => {
    if (page.hidden && fullscreenDialog.open) fullscreenDialog.close();
    else fitFullscreen();
  });

  enterFullscreen.addEventListener('click', () => {
    const map = currentMap();
    if (!map || draft || busy || fullscreenDialog.open) return;
    fullscreenTitle.textContent = map.name;
    fullscreenTitle.title = map.name;
    previousScroll = [viewport.scrollLeft, viewport.scrollTop];
    fullscreenStage.append(viewport);
    fullscreenDialog.showModal();
    viewport.scrollTo(0, 0);
    fullscreenResize.observe(viewport);
    fullscreenResize.observe(canvas);
    fullscreenUpdates.observe(page, { attributes:true, attributeFilter:['hidden'] });
    fullscreenUpdates.observe(canvas, { childList:true });
    fullscreenUpdates.observe(itemLayer, { childList:true });
    fitFullscreen();
    if (document.fullscreenEnabled && fullscreenDialog.requestFullscreen) {
      fullscreenDialog.requestFullscreen().catch(() => {});
    }
  });
  exitFullscreen.addEventListener('click', () => fullscreenDialog.close());
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === fullscreenDialog) {
      if (fullscreenDialog.open) nativeFullscreen = true;
      else document.exitFullscreen().catch(() => {});
    } else if (nativeFullscreen && fullscreenDialog.open) {
      fullscreenDialog.close();
    }
  });
  fullscreenDialog.addEventListener('close', () => {
    if (rackView.dialog.open) rackView.dialog.close();
    nativeFullscreen = false;
    if (document.fullscreenElement === fullscreenDialog) document.exitFullscreen().catch(() => {});
    fullscreenResize.disconnect();
    fullscreenUpdates.disconnect();
    viewportNext.before(viewport);
    viewport.scrollTo(...previousScroll);
    if (!page.hidden && !document.querySelector('dialog[open]')) enterFullscreen.focus({ preventScroll:true });
  });

  function itemTypeName(type) {
    return itemTypes[type].name;
  }

  function positionFloorResize(item) {
    for (const handle of floorResizes) {
      const x = handle.dataset.mapResize === 'left' ? item.x : item.x + item.width;
      handle.style.setProperty('--map-x', x / gridStep);
      handle.style.setProperty('--map-y', (item.y + item.height) / gridStep);
      handle.style.setProperty('--map-item-width', item.width / gridStep);
      handle.style.setProperty('--map-item-height', item.height / gridStep);
    }
  }

  function updateItem(node, item) {
    updateMarkerPosition(node, item);
    node.style.setProperty('--map-item-width', item.width / gridStep);
    node.style.setProperty('--map-item-height', item.height / gridStep);
    node.dataset.kind = item.type;
    node.dataset.axis = item.axis || (item.height > item.width ? 'vertical' : 'horizontal');
    if (item.type === 'bench') {
      const pattern = node.querySelector('.printer-map-bench-finish pattern');
      if (item.height > item.width) pattern.setAttribute('patternTransform', 'rotate(90)');
      else pattern.removeAttribute('patternTransform');
    }
    if (item.type === 'floor' && !node.disabled && node.classList.contains('is-single-selection')) {
      positionFloorResize(item);
      for (const handle of floorResizes) handle.hidden = false;
    }
    if (rotatableFurniture.has(item.type)) {
      orientPrinterMapFurniture(node.querySelector('.printer-map-furniture'), item.type, item.rotation ?? 0);
    }
    const customLabel = unlabelledTypes.has(item.type) ? '' : item.label;
    const label = customLabel || (unlabelledTypes.has(item.type) || ['line', 'wall', 'door', 'rectangle'].includes(item.type)
      ? '' : itemTypeName(item.type));
    setText(node.querySelector('.printer-map-item-label'), label);
    node.title = customLabel ? `${itemTypeName(item.type)} · ${customLabel}` : itemTypeName(item.type);
    node.setAttribute('aria-label', node.title);
  }

  function joinOpening(walls, { vertical, start, end, crossStart, depth, defaultCentre, cutThrough = false }) {
    const nearby = walls.filter(wall => wall.vertical === vertical
      && wall.centre >= crossStart && wall.centre <= crossStart + depth);
    const before = nearby.filter(wall => wall.from < start
      && (Math.abs(wall.start + wall.length - start) <= gridStep || (cutThrough && wall.to >= start)));
    const after = nearby.filter(wall => wall.to > end
      && (Math.abs(wall.start - end) <= gridStep || (cutThrough && wall.from <= end)));
    // Prefer a wall on each side of the opening when both share a centreline.
    const centres = [...new Set([...before, ...after].map(wall => wall.centre))];
    const joins = centre => Number(before.some(wall => wall.centre === centre))
      + Number(after.some(wall => wall.centre === centre));
    centres.sort((a, b) => joins(b) - joins(a) || Math.abs(a - defaultCentre) - Math.abs(b - defaultCentre));
    const centre = centres[0] ?? defaultCentre;
    for (const wall of before) {
      if (wall.centre !== centre) continue;
      if (after.includes(wall)) (wall.openings ??= []).push([start, end]);
      else wall.to = start;
    }
    for (const wall of after) {
      if (wall.centre === centre && !before.includes(wall)) wall.from = end;
    }
    return centre;
  }

  function drawDoor(item, walls) {
    const rotation = item.rotation ?? (item.height > item.width ? 90 : 0);
    const vertical = rotation % 180 !== 0;
    const reverse = rotation >= 180;
    const swingsNegative = rotation === 0 || rotation === 270;
    const start = vertical ? item.y : item.x;
    const crossStart = vertical ? item.x : item.y;
    const length = vertical ? item.height : item.width;
    const depth = vertical ? item.width : item.height;
    const inset = Math.min(gridStep, depth / 2);
    const defaultCentre = crossStart + (swingsNegative ? depth - inset : inset);
    const centre = joinOpening(walls, { vertical, start, end:start + length, crossStart, depth, defaultCentre });
    const baseline = centre - crossStart;
    const x = vertical ? baseline : reverse ? length : 0;
    const y = vertical ? (reverse ? length : 0) : baseline;
    const jamb = Math.min(gridStep / 3, length / 5);
    const opening = length - 2 * jamb;
    const swingSpace = swingsNegative ? baseline : depth - baseline;
    const swing = Math.min(opening, Math.max(inset / 2, swingSpace));
    // The animated leaf lengthens as it closes, extending past the drawn arc on shallow doors.
    const sweepDepth = swing + (opening - swing) / 2;
    const swingEdge = centre + (swingsNegative ? -sweepDepth : sweepDepth);
    const crossMin = Math.min(centre, swingEdge);
    const crossMax = Math.max(centre, swingEdge);
    const alongMin = start + jamb;
    const alongMax = start + length - jamb;
    const sweep = vertical
      ? { left:crossMin, right:crossMax, top:alongMin, bottom:alongMax }
      : { left:alongMin, right:alongMax, top:crossMin, bottom:crossMax };
    doorways.push({ itemId:item.id, vertical, centre, start, end:start + length, sweep });
    const symbol = itemNodes.get(item.id).querySelector('.printer-map-door-symbol');
    symbol.setAttribute('viewBox', `0 0 ${item.width} ${item.height}`);
    symbol.firstElementChild.setAttribute('transform', `translate(${x} ${y}) rotate(${rotation})`
      + (item.mirrored ? ` translate(${length} 0) scale(-1 1)` : ''));
    const [frame, leaf, arc, hinge] = symbol.firstElementChild.children;
    frame.setAttribute('d', `M0 0H${jamb} M${length - jamb} 0H${length}`);
    leaf.setAttribute('d', `M${jamb} 0V${-swing}`);
    leaf.style.setProperty('--map-door-hinge', `${jamb}px`);
    leaf.style.setProperty('--map-door-closed-scale', opening / swing);
    arc.setAttribute('d', `M${jamb} ${-swing}A${opening} ${swing} 0 0 1 ${length - jamb} 0`);
    hinge.setAttribute('cx', jamb);
  }

  function drawWindow(item, walls) {
    const vertical = item.height > item.width;
    const start = vertical ? item.y : item.x;
    const crossStart = vertical ? item.x : item.y;
    const length = vertical ? item.height : item.width;
    const depth = vertical ? item.width : item.height;
    const centre = joinOpening(walls, {
      vertical, start, end:start + length, crossStart, depth, defaultCentre:crossStart + depth / 2, cutThrough:true
    });
    const baseline = centre - crossStart;
    const halfFrame = Math.min(depth, gridStep) / 2;
    const halfGlass = halfFrame * .7;
    const jamb = Math.min(5, length / 10);
    const paneWidth = (length - 2 * jamb) / 3;
    const glazingOffset = halfGlass / 2;
    const frameGroup = itemNodes.get(item.id).querySelector('.printer-map-window-plan');
    frameGroup.ownerSVGElement.setAttribute('viewBox', `0 0 ${item.width} ${item.height}`);
    frameGroup.setAttribute('transform', vertical ? `translate(${baseline} 0) rotate(90)` : `translate(0 ${baseline})`);
    const [frame, glass, glazing, mullions] = frameGroup.children;
    frame.setAttribute('y', -halfFrame);
    frame.setAttribute('width', length);
    frame.setAttribute('height', 2 * halfFrame);
    glass.setAttribute('x', jamb);
    glass.setAttribute('y', -halfGlass);
    glass.setAttribute('width', 3 * paneWidth);
    glass.setAttribute('height', 2 * halfGlass);
    glazing.setAttribute('d', `M${jamb} ${-glazingOffset}H${length - jamb}M${jamb} ${glazingOffset}H${length - jamb}`);
    mullions.setAttribute('stroke-width', Math.min(4, length / 15));
    mullions.setAttribute('d', [1, 2].map(pane => `M${jamb + pane * paneWidth} ${-halfGlass}V${halfGlass}`).join(' '));
  }

  function wallOpeningMask({ openings, from, to, vertical }) {
    if (!openings?.length) return '';
    // The wall stroke extends half its thickness past each segment endpoint.
    const offset = value => `calc(${(value - from) / gridStep} * var(--map-dot-spacing) + var(--map-line-stroke) / 2)`;
    const stops = [];
    let previousEnd = from;
    for (const [start, end] of openings.sort((a, b) => a[0] - b[0])) {
      const low = Math.max(start, previousEnd);
      const high = Math.min(end, to);
      if (high <= low) continue;
      stops.push(`black ${offset(low)}`, `transparent ${offset(low)} ${offset(high)}`, `black ${offset(high)}`);
      previousEnd = high;
    }
    return stops.length ? `linear-gradient(to ${vertical ? 'bottom' : 'right'}, ${stops.join(', ')})` : '';
  }

  function updateLayoutJoins() {
    const items = currentMap()?.items || [];
    const segments = items.filter(item => item.axis).map(item => {
      const vertical = item.axis === 'vertical';
      const start = vertical ? item.y : item.x;
      const length = vertical ? item.height : item.width;
      const inset = Math.min(gridStep, (length - gridStep) / 2);
      return { item, vertical, start, length, from:start + inset, to:start + length - inset,
        centre:vertical ? item.x + item.width / 2 : item.y + item.height / 2 };
    });
    const extend = (segment, join) => {
      segment.from = Math.min(segment.from, join);
      segment.to = Math.max(segment.to, join);
    };
    for (let index = 0; index < segments.length; index++) {
      const a = segments[index];
      for (let other = index + 1; other < segments.length; other++) {
        const b = segments[other];
        const { item:p } = a;
        const { item:q } = b;
        if (p.type !== q.type || p.x + p.width < q.x || q.x + q.width < p.x
            || p.y + p.height < q.y || q.y + q.height < p.y) continue;
        if (a.vertical !== b.vertical) {
          extend(a, b.centre);
          extend(b, a.centre);
        } else if (a.centre === b.centre) {
          const [first, last] = a.start <= b.start ? [a, b] : [b, a];
          if (first.to < last.from) {
            const join = (first.to + last.from) / 2;
            extend(first, join);
            extend(last, join);
          }
        }
      }
    }
    const walls = segments.filter(segment => segment.item.type === 'wall');
    doorways.length = 0;
    for (const door of items.filter(item => item.type === 'door')) drawDoor(door, walls);
    for (const window of items.filter(item => item.type === 'window')) drawWindow(window, walls);
    personWalls = walls;
    for (const segment of segments) {
      const { item, start, length, from, to } = segment;
      const node = itemNodes.get(item.id);
      node.style.setProperty('--map-line-start', (from - start) / gridStep);
      node.style.setProperty('--map-line-end', (start + length - to) / gridStep);
      node.style.setProperty('--map-line-mask', wallOpeningMask(segment));
    }
  }

  function renderItems() {
    for (const handle of floorResizes) handle.hidden = true;
    const items = currentMap()?.items || [];
    const itemIds = new Set(items.map(item => item.id));
    for (const [id, node] of itemNodes) {
      if (itemIds.has(id)) continue;
      node.remove();
      itemNodes.delete(id);
    }
    for (const item of items) {
      let node = itemNodes.get(item.id);
      if (!node) {
        node = document.createElement('button');
        node.type = 'button';
        node.className = 'printer-map-item';
        node.dataset.mapItemId = item.id;
        node.classList.toggle('is-unlabelled', unlabelledTypes.has(item.type));
        if (!unlabelledTypes.has(item.type)) node.setAttribute('aria-keyshortcuts', 'F2');
        const artwork = printerMapFurnitureArtwork(item.type);
        const symbol = artwork || (item.type === 'door' ? `<svg class="printer-map-door-symbol" aria-hidden="true"
          fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <g>
            <path stroke-width="4"/>
            <path class="printer-map-door-leaf" stroke-width="3"/>
            <path stroke-width="2" stroke-dasharray="3 3"/>
            <circle r="2.5" fill="currentColor"/>
          </g>
        </svg>` : Object.hasOwn(objectSymbols, item.type) ? `<svg class="printer-map-object-symbol"
          viewBox="0 0 48 48" preserveAspectRatio="${item.type === 'window' ? 'none' : 'xMidYMid meet'}"
          aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">${objectSymbols[item.type]}</svg>` : '');
        const resize = item.type === 'floor' || Object.hasOwn(fixedItemSizes, item.type)
          ? '' : '<span data-map-resize="left" aria-hidden="true"></span><span data-map-resize="right" aria-hidden="true"></span>';
        const shelfParts = item.type === 'shelf'
          ? `<span class="printer-map-shelf-parts" aria-hidden="true">${'<span hidden></span>'.repeat(4)}</span>` : '';
        const rackSummary = item.type === 'rack' ? `<span class="printer-map-rack-summary" hidden>
          <span class="printer-map-rack-description"></span>
          <span class="printer-map-rack-alert" aria-hidden="true" hidden></span>
          <span class="printer-map-rack-beds" aria-hidden="true" hidden>${bedClearanceIcon}<span></span></span>
        </span>` : '';
        node.innerHTML = `${symbol}${shelfParts}${rackSummary}<span class="printer-map-item-label"></span>${resize}`;
        if (item.type === 'rack') node.addEventListener('click', () => {
          if (!draft) openRack(currentMap().items.find(entry => entry.id === item.id));
        });
        itemLayer.append(node);
        itemNodes.set(item.id, node);
      }
      node.disabled = busy || (!draft && !item.levels);
      if (item.type === 'rack') {
        node.querySelector('.printer-map-rack-summary').hidden = !item.levels;
        if (!item.levels) node.removeAttribute('data-rack-alert');
      }
      node.toggleAttribute('data-rack-view', Boolean(!draft && item.levels));
      if (draft) node.setAttribute('aria-pressed', String(selected.has(item)));
      else node.removeAttribute('aria-pressed');
      node.classList.toggle('is-single-selection', selected.has(item) && selected.size === 1);
      updateItem(node, item);
    }
    updateLayoutJoins();
    if (displayOnly) return;
    const { width, height } = roomBounds();
    for (const [type, button] of paletteButtons) {
      const tooSmall = Object.hasOwn(fixedItemSizes, type)
        && (fixedItemSizes[type][0] > width || fixedItemSizes[type][1] > height);
      button.disabled = items.length >= 200 || tooSmall;
    }
    const item = singleSelection();
    const editableItem = Boolean(item?.type);
    const editingDoor = item?.type === 'door';
    const canRotate = rotatableFurniture.has(item?.type);
    actions.rotateItem.hidden = !canRotate;
    actions.manageRack.hidden = item?.type !== 'rack';
    lineOrientation.hidden = !item?.axis;
    if (item?.axis) itemFields.lineAxis.value = item.axis;
    doorDirection.hidden = actions.flipDoor.hidden = !editingDoor;
    if (editingDoor) {
      itemFields.doorRotation.value = String(item.rotation ?? (item.height > item.width ? 90 : 0));
      actions.flipDoor.setAttribute('aria-pressed', String(Boolean(item.mirrored)));
    }
    itemEditor.hidden = !editableItem;
    itemEditor.disabled = busy;
    if (editableItem) {
      const angle = canRotate ? ` · ${item.rotation ?? 0}°` : '';
      setText(selectedItem, `Selected ${itemTypeName(item.type).toLowerCase()}${angle}`);
    }
    groupStatus.hidden = selected.size < 2;
    setText(groupStatus, selected.size < 2 ? '' : `${selected.size} selected. Drag one to move them together.`);
  }

  function renderMarkers() {
    const map = currentMap();
    const placements = new Map(map?.placements.map(item => [item.printerId, item]));
    const racks = new Map(map?.items?.filter(item => item.levels)
      .map(item => [item.id, { item, slots:[], levels:new Set(), bays:new Map() }]));
    const printerById = new Map(printers.map(printer => [printer.id, printer]));
    for (const placement of placements.values()) {
      const rack = racks.get(placement.rackId);
      if (!rack) continue;
      rack.slots.push(placement);
      if (!printerById.has(placement.printerId)) continue;
      rack.levels.add(placement.level);
      const bay = rack.bays.get(placement.bay) ?? { top:placement, count:0 };
      if (placement.level > bay.top.level) bay.top = placement;
      bay.count++;
      rack.bays.set(placement.bay, bay);
    }
    for (const [id, rack] of racks) {
      const node = itemNodes.get(id);
      if (!node) continue;
      const devices = rack.slots.map(slot => printerById.get(slot.printerId)).filter(Boolean);
      const alerts = devices.filter(device => device.alert).length;
      const beds = devices.filter(device => device.bedClearance).length;
      const alertCount = alerts ? `${alerts} alert${alerts === 1 ? '' : 's'}` : '';
      const description = [`${devices.length} printer${devices.length === 1 ? '' : 's'}`,
        rack.levels.size === 1 ? `Level ${rack.levels.values().next().value}` : `${rack.item.levels} levels`].join(' · ');
      const summary = [description, alertCount,
        beds && `${beds} bed${beds === 1 ? '' : 's'} to clear`].filter(Boolean).join(' · ');
      setText(node.querySelector('.printer-map-rack-description'), description);
      const alertBadge = node.querySelector('.printer-map-rack-alert');
      node.toggleAttribute('data-rack-alert', Boolean(alertCount));
      alertBadge.hidden = !alertCount;
      setText(alertBadge, alertCount);
      const bedBadge = node.querySelector('.printer-map-rack-beds');
      bedBadge.hidden = !beds;
      setText(bedBadge.lastElementChild, beds.toString());
      node.title = summary;
      if (!draft) node.setAttribute('aria-label', `View ${rackName(map, rack.item)} · ${summary}`);
    }
    const assigned = new Set(maps.filter(saved => saved.id !== map?.id)
      .flatMap(saved => saved.placements.map(item => item.printerId)));
    const unplaced = printers.filter(printer => !assigned.has(printer.id) && !placements.has(printer.id));
    const activeRack = rackView.dialog.open ? racks.get(openRackId) : null;
    if (activeRack) {
      const choices = draft ? printers.filter(printer => !assigned.has(printer.id)
        && !placements.get(printer.id)?.rackId).map(printer => [printer.id, printer.name]) : [];
      rackView.render(activeRack.item, Boolean(draft), busy, activeRack.slots,
        new Map(printers.map(printer => [printer.id, printer.name])), choices);
    } else if (rackView.dialog.open) rackView.dialog.close();
    if (draft) renderAvailablePrinters(unplaced);

    viewport.hidden = !map;
    if (shelf) shelf.hidden = Boolean(map);
    const parent = map ? canvas : shelf;
    const visible = map ? printers.filter(printer => placements.has(printer.id)) : unplaced;
    const visibleIds = new Set(visible.map(printer => printer.id));
    for (const [id, marker] of markers) {
      if (visibleIds.has(id)) continue;
      stopTileEffects(marker);
      marker.tile.remove();
      markers.delete(id);
    }
    for (const printer of visible) {
      const marker = markers.get(printer.id) || makeMarker(printer.id);
      const source = printer.imageKey ? `/assets/printers/${printer.imageKey}.webp` : null;
      if (source && marker.image.getAttribute('src') !== source) marker.image.src = source;
      marker.image.hidden = !source;
      marker.placeholder.toggleAttribute('hidden', Boolean(source));
      setText(marker.label, printer.name);
      marker.label.title = printer.name;
      marker.alert.hidden = !printer.alert;
      marker.printing.hidden = !printer.printing;
      setText(marker.queued, `${printer.queued} queued`);
      updateTileActivity(marker, printer, map?.id);
      if (!displayOnly) {
        marker.details.disabled = marker.alert.disabled = marker.queued.disabled = Boolean(draft);
        marker.details.setAttribute('aria-label', `Open printer details for ${printer.name}`);
        marker.alert.setAttribute('aria-label', `View alerts for ${printer.name}`);
        marker.queued.setAttribute('aria-label', `View queue for ${printer.name} (${printer.queued} queued)`);
        if (clearBed) {
          marker.clearance.disabled = Boolean(draft);
          marker.clearance.setAttribute('aria-label', `Mark bed cleared for ${printer.name}`);
          marker.clearance.setAttribute('aria-disabled', String(pendingClearances.has(printer.id)));
        }
      }
      const placement = placements.get(printer.id);
      const rack = racks.get(placement?.rackId);
      const bay = rack?.bays.get(placement.bay);
      const frontSlot = rack && rack === activeRack ? rackView.slot(placement) : null;
      const projected = Boolean(bay && !draft && !frontSlot && bay.top === placement);
      const tile = marker.tile;
      tile.hidden = Boolean(rack && !frontSlot && !projected);
      tile.classList.toggle('is-rack-projected', projected);
      marker.bayLevel.hidden = !projected || rack.levels.size === 1;
      if (!marker.bayLevel.hidden) {
        const below = bay.count - 1;
        setText(marker.bayLevel, `L${placement.level}${below ? ` · +${below}` : ''}`);
        marker.bayLevel.setAttribute('aria-label',
          `Level ${placement.level}${below ? ` · ${below} printer${below === 1 ? '' : 's'} below` : ''}`);
      }
      if (projected) positionRackPrinter(tile, rack.item, placement.bay);
      else if (placement && !rack) updateMarkerPosition(tile, placement);
      if (draft && !frontSlot) {
        marker.tile.setAttribute('role', 'button');
        marker.tile.tabIndex = busy ? -1 : 0;
        marker.tile.setAttribute('aria-disabled', String(busy));
        marker.tile.setAttribute('aria-pressed', String(selected.has(placement)));
        marker.tile.setAttribute('aria-label', [
          printer.name,
          printer.alert && 'Alert', printer.printing && 'Printing', printer.bedClearance && 'Bed needs clearing',
          `${printer.queued} queued`
        ].filter(Boolean).join(', '));
      } else {
        for (const attr of ['role', 'tabindex', 'aria-disabled', 'aria-pressed', 'aria-label']) marker.tile.removeAttribute(attr);
      }
      const container = frontSlot || parent;
      if (tile.parentElement !== container) container.append(tile);
    }

    if (displayOnly) return;
    const selectedPrinter = visible.find(printer => printer.id === singleSelection()?.printerId);
    selection.hidden = !selectedPrinter;
    if (selectedPrinter) setText(selection.querySelector('strong'), selectedPrinter.name);
    actions.unplace.disabled = busy;
    if (!busy && loaded) {
      setText(status, map
        ? `${visible.length} ${visible.length === 1 ? 'printer' : 'printers'} on this map`
        : `${maps.length ? '' : 'No room maps yet. '}${unplaced.length} unplaced ${unplaced.length === 1 ? 'printer' : 'printers'}`);
    }
  }

  function positionRackPrinter(tile, rack, bay) {
    const bounds = rackBayBounds(rack, bay);
    const width = parseFloat(canvasStyle.getPropertyValue('--map-marker-width')) / personScale;
    const height = parseFloat(canvasStyle.getPropertyValue('--map-marker-height')) / personScale;
    const header = 18 / personScale;
    const scale = Math.min(1, (bounds.width - 4 / personScale) / width, (bounds.height - header) / height);
    tile.hidden = scale <= 0;
    tile.style.setProperty('--rack-marker-scale', scale);
    updateMarkerPosition(tile, {
      x:bounds.x + (bounds.width - width * scale) / 2,
      y:bounds.y + (bounds.height + header - height * scale) / 2
    });
  }

  function render() {
    const editing = Boolean(draft);
    roomControls.hidden = editing;
    setOptions(room, [...maps.map(map => [map.id, map.name]), ['', 'Unplaced printers']], activeId);
    room.disabled = !loaded || busy || editing;
    create.hidden = !loaded || editing || !canEdit();
    edit.hidden = create.hidden || !currentMap();
    enterFullscreen.hidden = !loaded || editing || !currentMap();
    monitoringLink.hidden = edit.hidden;
    monitoringLink.disabled = busy;
    enterFullscreen.disabled = busy;
    create.disabled = edit.disabled = reload.disabled = busy;
    form.hidden = help.hidden = !editing;
    form.querySelector('fieldset').disabled = busy;
    canvas.classList.toggle('is-editing', editing);
    renderRoomGeometry();
    actions.delete.hidden = !draft?.id;
    renderItems();
    renderMarkers();
    syncPerson();
  }

  function endEdit() {
    if (rackView.dialog.open) rackView.dialog.close();
    finishItemLabel(false);
    clearPaletteDrag();
    available.open = false;
    availableOptions.replaceChildren();
    draft = null;
    selected.clear();
    drag = null;
    box.hidden = true;
    benchGuide.hidden = true;
    error.textContent = '';
    render();
  }

  function startEdit(saved) {
    if (!canEdit() || busy || !loaded) return;
    draft = saved ? structuredClone(saved) : { id:'', name:'', placements:[] };
    draft.items ??= [];
    draft.columns ??= defaultRoomSteps;
    draft.rows ??= defaultRoomSteps;
    draft.compactPrinters ??= false;
    name.value = draft.name;
    mapColumns.value = draft.columns;
    mapRows.value = draft.rows;
    printerDensity.value = draft.compactPrinters ? 'compact' : 'standard';
    error.textContent = '';
    render();
    name.focus();
  }

  async function load() {
    if (busy || draft) return;
    busy = true;
    error.textContent = '';
    status.textContent = 'Loading maps…';
    render();
    try {
      const data = await api(endpoint);
      maps = data.maps;
      let preferred = activeId;
      if (!loaded) {
        try { preferred = localStorage.getItem(preferenceKey); } catch {}
      }
      activeId = preferred === '' || maps.some(map => map.id === preferred) ? preferred : maps[0]?.id || '';
      loaded = true;
      reload.hidden = true;
    } catch (failure) {
      status.textContent = '';
      error.textContent = failure.message;
      reload.hidden = false;
    } finally {
      busy = false;
      render();
    }
  }

  async function save(remove = false) {
    if (!draft || busy || !canEdit()) return;
    if (remove && !confirm(`Delete the saved map “${draft.name}”? Its printers will return to Unplaced printers.`)) return;
    finishItemLabel();
    busy = true;
    error.textContent = '';
    status.textContent = remove ? 'Deleting map…' : 'Saving map…';
    render();
    try {
      const id = draft.id;
      const { maps: saved } = await api(id ? `${endpoint}/${encodeURIComponent(id)}` : endpoint, {
        method:remove ? 'DELETE' : id ? 'PUT' : 'POST',
        body:JSON.stringify(remove ? { revision:draft.revision }
          : { ...draft, name:name.value })
      });
      maps = saved;
      activeId = remove ? '' : id || maps.at(-1).id;
      rememberRoom();
      endEdit();
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      busy = false;
      render();
      if (!draft) room.focus();
    }
  }

  function singleSelection() {
    if (selected.size === 1) return selected.values().next().value;
  }

  function placementFor(marker) {
    return marker.dataset.printerId
      ? draft.placements.find(item => item.printerId === marker.dataset.printerId)
      : draft.items.find(item => item.id === marker.dataset.mapItemId);
  }

  function nodeFor(placement) {
    return placement.printerId ? markers.get(placement.printerId)?.tile : itemNodes.get(placement.id);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x:Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      y:Math.min(rect.height, Math.max(0, event.clientY - rect.top))
    };
  }

  function drawBox(start, end) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    Object.assign(box.style, { left:`${left}px`, top:`${top}px`, width:`${width}px`, height:`${height}px` });
    box.hidden = width < 3 || height < 3;
  }

  function moveSelection(entries, dx, dy, showGuide = false) {
    const { width, height } = roomBounds();
    let alignment;
    if (entries.length === 1) {
      const [{ placement, x, y }] = entries;
      const step = placementStep(placement.type);
      placement.y = snap(y + dy, height, placement.height, step);
      if (placement.printerId) alignment = printerBenchSnap(x + dx, placement.y, width);
      placement.x = alignment?.x ?? snap(x + dx, width, placement.width, step);
    } else {
      // Clamp one shared grid delta so the group cannot shear at a map edge.
      const minX = Math.max(...entries.map(entry => -entry.x));
      const minY = Math.max(...entries.map(entry => -entry.y));
      const maxX = Math.min(...entries.map(({ placement, x }) => width - x - (placement.width || 0)));
      const maxY = Math.min(...entries.map(({ placement, y }) => height - y - (placement.height || 0)));
      const limit = (value, min, max) => Math.max(Math.ceil(min / gridStep),
        Math.min(Math.floor(max / gridStep), Math.round(value / gridStep))) * gridStep;
      const xDelta = limit(dx, minX, maxX);
      const yDelta = limit(dy, minY, maxY);
      for (const { placement, x, y } of entries) {
        placement.x = x + xDelta;
        placement.y = y + yDelta;
      }
    }
    for (const { placement } of entries) {
      const node = nodeFor(placement);
      if (node) updateMarkerPosition(node, placement);
    }
    if (showGuide) showBenchGuide(alignment?.centreBench);
    if (entries.length === 1 && entries[0].placement.type === 'floor' && floorResizes.some(handle => !handle.hidden)) {
      positionFloorResize(entries[0].placement);
    }
    if (entries.some(({ placement }) => placement.axis || ['door', 'window'].includes(placement.type))) updateLayoutJoins();
  }

  function placementStep(type) {
    return type === 'chair' || type === 'stool' ? gridStep / 2 : gridStep;
  }

  function snap(value, boundary, extent = 0, step = gridStep) {
    // Seat positions can also land halfway between the regular grid dots.
    const offset = gridOffset % step;
    const nearest = Math.round((value - offset) / step) * step + offset;
    const limit = Math.floor((boundary - offset - extent) / step) * step + offset;
    if (limit < offset) return boundary - extent;
    return Math.min(limit, Math.max(offset, nearest));
  }

  function printerBenchSnap(x, y, roomWidth) {
    const tileWidth = parseFloat(canvasStyle.getPropertyValue('--map-marker-width')) / personScale;
    const tileHeight = parseFloat(canvasStyle.getPropertyValue('--map-marker-height')) / personScale;
    const tileCentre = x + tileWidth / 2;
    let alignment;
    let bestOverlap = 0;
    for (const bench of draft.items) {
      if (bench.type !== 'bench' || tileCentre < bench.x || tileCentre > bench.x + bench.width) continue;
      const overlap = Math.min(y + tileHeight, bench.y + bench.height) - Math.max(y, bench.y);
      if (overlap <= bestOverlap) continue;
      const centredX = Math.round(bench.x + (bench.width - tileWidth) / 2);
      const offset = Math.round((x - centredX) / gridStep) * gridStep;
      const snappedX = centredX + offset;
      if (snappedX < 0 || snappedX > roomWidth) continue;
      alignment = { x:snappedX, centreBench:offset === 0 ? bench : null };
      bestOverlap = overlap;
    }
    return alignment;
  }

  function showBenchGuide(bench) {
    benchGuide.hidden = !bench;
    if (!bench) return;
    updateMarkerPosition(benchGuide, { x:bench.x + bench.width / 2, y:bench.y });
    benchGuide.style.setProperty('--map-item-height', bench.height / gridStep);
  }

  function resizeItem(item, width, height, anchor) {
    const bounds = roomBounds();
    const dimension = (value, limit) => Math.min(Math.floor(limit / gridStep),
      Math.max(1, Math.round(value / gridStep))) * gridStep;
    const maxWidth = anchor?.edge === 'left' ? anchor.right : bounds.width - (anchor?.x ?? 0);
    item.width = dimension(width, maxWidth);
    item.height = dimension(height, bounds.height - (anchor?.y ?? 0));
    if (item.axis === 'vertical') item.width = Math.min(2 * gridStep, bounds.width);
    if (item.axis === 'horizontal') item.height = Math.min(2 * gridStep, bounds.height);
    if (anchor?.edge === 'left') item.x = anchor.right - item.width;
    if (item.x + item.width > bounds.width) item.x = snap(item.x, bounds.width, item.width);
    if (item.y + item.height > bounds.height) item.y = snap(item.y, bounds.height, item.height);
    updateItem(itemNodes.get(item.id), item);
    if (item.axis || ['door', 'window'].includes(item.type)) updateLayoutJoins();
  }

  function findPrinterSpaces(count) {
    const { width, height } = roomBounds();
    const tileWidth = parseFloat(canvasStyle.getPropertyValue('--map-marker-width')) / personScale;
    const tileHeight = parseFloat(canvasStyle.getPropertyValue('--map-marker-height')) / personScale;
    const gap = 8 / personScale;
    const occupiedRackIds = new Set(draft.placements.map(item => item.rackId).filter(Boolean));
    const occupied = draft.placements.filter(item => !item.rackId)
      .map(({ x, y }) => ({ x, y, width:tileWidth, height:tileHeight }));
    occupied.push(...draft.items.filter(item => occupiedRackIds.has(item.id)));
    const positions = [];
    for (let y = gridOffset; y < height; y += gridStep) {
      for (let x = gridOffset; x < width; x += gridStep) {
        if (occupied.some(item => x < item.x + item.width + gap && x + tileWidth + gap > item.x
            && y < item.y + item.height + gap && y + tileHeight + gap > item.y)) continue;
        positions.push({ x, y });
        if (positions.length === count) return positions;
        occupied.push({ x, y, width:tileWidth, height:tileHeight });
      }
    }
  }

  function addPrinters() {
    if (!draft || busy) return;
    const ids = [...availableOptions.querySelectorAll('input:checked')].map(input => input.value);
    if (!ids.length) return;
    const positions = findPrinterSpaces(ids.length);
    if (!positions) {
      setText(error, 'Not enough free space for the selected printers. Select fewer printers, move tiles, switch to Compact, or enlarge the map.');
      return;
    }
    setText(error, '');
    const placements = ids.map((printerId, index) => ({ printerId, ...positions[index] }));
    draft.placements.push(...placements);
    selected = new Set(placements);
    available.open = false;
    render();
    nodeFor(placements[0])?.focus();
  }

  function markerAt(event) {
    if (floorResizes.includes(event.target)) {
      const item = singleSelection();
      return item ? nodeFor(item) : null;
    }
    return event.target.closest('.printer-map-marker, .printer-map-item');
  }

  function startItemLabel(node) {
    if (!draft || busy || !node?.dataset.mapItemId) return;
    const item = placementFor(node);
    if (!item || unlabelledTypes.has(item.type)) return;
    finishItemLabel();
    selected = new Set([item]);
    renderMarkers();
    renderItems();
    labelItem = item;
    updateMarkerPosition(inlineLabel, item);
    inlineLabel.style.setProperty('--map-item-width', item.width / gridStep);
    inlineLabel.style.setProperty('--map-item-height', item.height / gridStep);
    inlineLabel.value = item.label || node.querySelector('.printer-map-item-label').textContent;
    inlineLabel.hidden = false;
    inlineLabel.focus();
    inlineLabel.select();
  }

  function finishItemLabel(commit = true) {
    if (!labelItem) return;
    const item = labelItem;
    const node = nodeFor(item);
    labelItem = null;
    inlineLabel.hidden = true;
    if (commit) {
      const value = inlineLabel.value.trim();
      if (value !== node.querySelector('.printer-map-item-label').textContent) item.label = value;
      updateItem(node, item);
    }
    return node;
  }

  canvas.addEventListener('dblclick', event => {
    if (!event.target.closest('[data-map-resize]')) startItemLabel(markerAt(event));
  });
  inlineLabel.addEventListener('blur', () => finishItemLabel());
  inlineLabel.addEventListener('keydown', event => {
    if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finishItemLabel(event.key === 'Enter')?.focus({ preventScroll:true });
  });

  page.addEventListener('click', async event => {
    if (draft && rackView.dialog.contains(event.target)) return;
    const marker = markerAt(event);
    if (!marker) return;
    if (draft) {
      if (busy) return;
      const placement = placementFor(marker);
      if (!placement) return;
      if (event.ctrlKey || event.metaKey) {
        if (selected.has(placement)) selected.delete(placement);
        else selected.add(placement);
      } else if (!selected.has(placement)) selected = new Set([placement]);
      renderMarkers();
      renderItems();
    } else if (!busy && marker.dataset.printerId) {
      const action = event.target.closest('[data-map-printer-action]')?.dataset.mapPrinterAction;
      if (!action) return;
      const printerId = marker.dataset.printerId;
      if (action === 'clear-bed') {
        const printer = printers.find(item => item.id === printerId);
        if (!clearBed || !printer?.bedClearance || pendingClearances.has(printerId)) return;
        pendingClearances.add(printerId);
        markers.get(printerId).clearance.setAttribute('aria-disabled', 'true');
        try {
          await clearBed(printerId, printer.name);
        } catch (error) {
          alert(error.message);
        } finally {
          pendingClearances.delete(printerId);
          markers.get(printerId)?.clearance.setAttribute('aria-disabled', 'false');
        }
        return;
      }
      if (rackView.dialog.open) rackView.dialog.close();
      if (action === 'details') {
        openPrinter(printerId);
        return;
      }
      if (fullscreenDialog.open) fullscreenDialog.close();
      if (action === 'alerts') openAlerts(printerId);
      else if (action === 'queue') openQueue(printerId);
    }
  });
  canvas.addEventListener('pointerdown', event => {
    if (!draft || busy || drag || event.button !== 0 || !event.isPrimary || event.target === inlineLabel) return;
    finishItemLabel();
    const marker = markerAt(event);
    const placement = marker && placementFor(marker);
    const unselectedFloor = placement?.type === 'floor' && !selected.has(placement)
      && !event.ctrlKey && !event.metaKey;
    if ((!marker || unselectedFloor) && event.pointerType !== 'touch') {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drag = { id:event.pointerId, boxStart:canvasPoint(event), floor:unselectedFloor ? placement : null };
      return;
    }
    if (!marker || event.ctrlKey || event.metaKey) return;
    if (!placement) return;
    if (!selected.has(placement)) selected = new Set([placement]);
    marker.focus({ preventScroll:true });
    const captureTarget = floorResizes.includes(event.target) ? event.target : marker;
    captureTarget.setPointerCapture(event.pointerId);
    const edge = event.target.closest('[data-map-resize]')?.dataset.mapResize;
    drag = { placement, id:event.pointerId, start:canvasPoint(event),
      entries:[...selected].map(entry => ({ placement:entry, x:entry.x, y:entry.y })),
      width:placement.width, height:placement.height,
      resizeAnchor:edge && { edge, x:placement.x, y:placement.y, right:placement.x + placement.width },
    };
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || busy) return;
    const point = canvasPoint(event);
    if (drag.boxStart) {
      drawBox(drag.boxStart, point);
      return;
    }
    const dx = (point.x - drag.start.x) * gridStep / gridPixels;
    const dy = (point.y - drag.start.y) * gridStep / gridPixels;
    if (drag.resizeAnchor) {
      const width = drag.width + (drag.resizeAnchor.edge === 'left' ? -dx : dx);
      resizeItem(drag.placement, width, drag.height + dy, drag.resizeAnchor);
      return;
    }
    moveSelection(drag.entries, dx, dy, true);
  });
  canvas.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    benchGuide.hidden = true;
    if (!drag.boxStart) return;
    const point = canvasPoint(event);
    drawBox(drag.boxStart, point);
    selected.clear();
    if (!box.hidden) {
      const bounds = box.getBoundingClientRect();
      for (const placement of [...draft.placements.filter(item => !item.rackId), ...draft.items]) {
        const rect = nodeFor(placement)?.getBoundingClientRect();
        if (rect && rect.left >= bounds.left && rect.right <= bounds.right
            && rect.top >= bounds.top && rect.bottom <= bounds.bottom) selected.add(placement);
      }
    } else if (drag.floor && Math.hypot(point.x - drag.boxStart.x, point.y - drag.boxStart.y) < 3) {
      selected.add(drag.floor);
    }
    box.hidden = true;
    drag = null;
    if (selected.size) nodeFor(selected.values().next().value)?.focus({ preventScroll:true });
    renderMarkers();
    renderItems();
  });
  function clearDrag(event) {
    if (drag?.id !== event.pointerId) return;
    box.hidden = true;
    benchGuide.hidden = true;
    drag = null;
    renderMarkers();
    renderItems();
  }
  canvas.addEventListener('pointercancel', clearDrag);
  canvas.addEventListener('lostpointercapture', clearDrag);
  canvas.addEventListener('keydown', event => {
    const marker = markerAt(event);
    if (draft && !busy && marker?.dataset.printerId && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      marker.click();
      return;
    }
    if (event.key === 'F2' && draft && !busy && marker?.dataset.mapItemId) {
      event.preventDefault();
      startItemLabel(marker);
      return;
    }
    const delta = { ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1] }[event.key];
    if (!draft || !marker || !delta || busy) return;
    event.preventDefault();
    const placement = placementFor(marker);
    if (!placement) return;
    if (!selected.has(placement)) selected = new Set([placement]);
    const step = event.shiftKey ? 3 * gridStep : selected.size === 1 ? placementStep(placement.type) : gridStep;
    const entries = [...selected].map(entry => ({ placement:entry, x:entry.x, y:entry.y }));
    moveSelection(entries, delta[0] * step, delta[1] * step);
    renderMarkers();
    renderItems();
    marker.scrollIntoView({ block:'nearest', inline:'nearest' });
  });
  page.addEventListener('keydown', event => {
    if (event.key === 'Escape' && paletteDrag) {
      event.preventDefault();
      suppressPaletteClick = true;
      clearPaletteDrag();
      return;
    }
    if (!draft || event.target === inlineLabel || event.key !== 'Escape' || (!selected.size && !drag?.boxStart)) return;
    event.preventDefault();
    selected.clear();
    if (drag?.boxStart) drag = null;
    box.hidden = true;
    renderMarkers();
    renderItems();
  });
  actions.unplace.addEventListener('click', () => {
    const printer = singleSelection();
    if (!draft || busy || !printer?.printerId) return;
    draft.placements = draft.placements.filter(item => item !== printer);
    selected.clear();
    renderMarkers();
    availableSummary.focus();
  });
  function itemGeometry(type, point) {
    const bounds = roomBounds();
    const [defaultWidth, defaultHeight] = itemTypes[type].size;
    const width = Math.min(defaultWidth, bounds.width);
    const height = Math.min(defaultHeight, bounds.height);
    const offset = (draft.items.length % 5) * 40 + 30;
    const units = gridStep / gridPixels;
    const x = point ? point.x * units - width / 2 : viewport.scrollLeft * units + offset;
    const y = point ? point.y * units - height / 2 : viewport.scrollTop * units + offset;
    const step = placementStep(type);
    return { x:snap(x, bounds.width, width, step), y:snap(y, bounds.height, height, step), width, height };
  }

  function addItem(type, geometry) {
    if (!draft || busy || draft.items.length >= 200) return;
    const item = {
      id:crypto.getRandomValues(new Uint32Array(4)).join('-'), type, label:type === 'label' ? 'Label' : '',
      ...(geometry || itemGeometry(type))
    };
    if (type === 'door') Object.assign(item, { rotation:0, mirrored:false });
    if (type === 'wall' || type === 'line') item.axis = 'horizontal';
    draft.items.push(item);
    selected = new Set([item]);
    render();
    nodeFor(item).focus({ preventScroll:Boolean(geometry) });
  }

  function dropGeometry(event, type) {
    if (!draft || busy || !viewport.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
    const { left, top, right, bottom } = itemLayer.getBoundingClientRect();
    if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) return;
    return itemGeometry(type, { x:event.clientX - left, y:event.clientY - top });
  }

  function clearPaletteDrag() {
    const active = paletteDrag;
    paletteDrag = null;
    itemPreview.hidden = true;
    if (active?.button.hasPointerCapture(active.id)) active.button.releasePointerCapture(active.id);
  }

  palette.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-map-item-type]');
    if (!button || !draft || busy || paletteDrag || event.button !== 0 || !event.isPrimary) return;
    suppressPaletteClick = false;
    paletteDrag = { button, id:event.pointerId, x:event.clientX, y:event.clientY, moved:false };
    button.setPointerCapture(event.pointerId);
  });
  palette.addEventListener('pointermove', event => {
    if (paletteDrag?.id !== event.pointerId) return;
    if (!paletteDrag.moved && Math.hypot(event.clientX - paletteDrag.x, event.clientY - paletteDrag.y) < 5) return;
    paletteDrag.moved = true;
    const type = paletteDrag.button.dataset.mapItemType;
    const geometry = dropGeometry(event, type);
    itemPreview.hidden = !geometry;
    if (geometry) {
      updateMarkerPosition(itemPreview, geometry);
      itemPreview.style.setProperty('--map-item-width', geometry.width / gridStep);
      itemPreview.style.setProperty('--map-item-height', geometry.height / gridStep);
      setText(itemPreview, itemTypeName(type));
    }
  });
  palette.addEventListener('pointerup', event => {
    if (paletteDrag?.id !== event.pointerId) return;
    const type = paletteDrag.button.dataset.mapItemType;
    suppressPaletteClick = paletteDrag.moved;
    const geometry = paletteDrag.moved ? dropGeometry(event, type) : null;
    clearPaletteDrag();
    if (geometry) addItem(type, geometry);
  });
  palette.addEventListener('lostpointercapture', event => {
    if (paletteDrag?.id === event.pointerId) clearPaletteDrag();
  });
  palette.addEventListener('click', event => {
    const button = event.target.closest('[data-map-item-type]');
    if (!button) return;
    if (event.detail > 0 && suppressPaletteClick) {
      suppressPaletteClick = false;
      return;
    }
    addItem(button.dataset.mapItemType);
  });
  actions.removeItem.addEventListener('click', () => {
    const item = singleSelection();
    if (!draft || busy || !item?.type) return;
    if (labelItem === item) finishItemLabel(false);
    draft.items = draft.items.filter(entry => entry !== item);
    if (item.type === 'rack') draft.placements = draft.placements.filter(entry => entry.rackId !== item.id);
    selected.clear();
    renderItems();
    renderMarkers();
    paletteButtons.get(item.type).focus();
  });
  actions.manageRack.addEventListener('click', () => {
    const rack = singleSelection();
    if (draft && rack?.type === 'rack') openRack(rack);
  });
  itemFields.doorRotation.addEventListener('change', () => {
    const item = singleSelection();
    if (item?.type !== 'door' || busy) return;
    item.rotation = Number(itemFields.doorRotation.value);
    updateLayoutJoins();
  });
  itemFields.lineAxis.addEventListener('change', () => {
    const item = singleSelection();
    if (!item?.axis || busy) return;
    item.axis = itemFields.lineAxis.value;
    resizeItem(item, item.height, item.width);
    renderItems();
  });
  actions.flipDoor.addEventListener('click', () => {
    const item = singleSelection();
    if (item?.type !== 'door' || busy) return;
    item.mirrored = !item.mirrored;
    actions.flipDoor.setAttribute('aria-pressed', String(item.mirrored));
    updateLayoutJoins();
  });
  actions.rotateItem.addEventListener('click', () => {
    const item = singleSelection();
    if (!draft || busy || !rotatableFurniture.has(item?.type)) return;
    const { width, height } = roomBounds();
    if (item.height > width || item.width > height) {
      setText(error, `Enlarge the room to fit the rotated ${itemTypeName(item.type).toLowerCase()}.`);
      return;
    }
    [item.width, item.height] = [item.height, item.width];
    item.rotation = ((item.rotation ?? 0) + 90) % 360;
    const step = placementStep(item.type);
    if (item.x + item.width > width) item.x = snap(item.x, width, item.width, step);
    if (item.y + item.height > height) item.y = snap(item.y, height, item.height, step);
    setText(error, '');
    renderItems();
  });
  room.addEventListener('change', () => {
    activeId = room.value;
    rememberRoom();
    viewport.scrollTo(0, 0);
    render();
  });
  create.addEventListener('click', () => startEdit());
  edit.addEventListener('click', () => startEdit(currentMap()));
  reload.addEventListener('click', load);
  availableOptions.addEventListener('change', updateAvailableCount);
  availableSummary.addEventListener('click', event => { if (busy) event.preventDefault(); });
  available.addEventListener('focusout', event => {
    if (event.relatedTarget && !available.contains(event.relatedTarget)) available.open = false;
  });
  available.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !available.open) return;
    event.preventDefault();
    event.stopPropagation();
    available.open = false;
    availableSummary.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (available.open && !available.contains(event.target)) available.open = false;
  });
  actions.add.addEventListener('click', addPrinters);
  actions.cancel.addEventListener('click', () => {
    endEdit();
    room.focus();
    load();
  });
  actions.delete.addEventListener('click', () => save(true));
  mapColumns.addEventListener('change', applyRoomDimensions);
  mapRows.addEventListener('change', applyRoomDimensions);
  printerDensity.addEventListener('change', () => {
    if (!draft || busy) return;
    draft.compactPrinters = printerDensity.value === 'compact';
    renderRoomGeometry();
    renderMarkers();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (applyRoomDimensions()) save();
  });

  return {
    load,
    update(nextPrinters) {
      printers = nextPrinters;
      if (!page.hidden && loaded) {
        renderMarkers();
        syncPerson();
      }
    }
  };
}
