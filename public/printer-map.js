const endpoint = '/api/printer-maps';
const preferenceKey = 'pfc-printer-map';
const defaultRoomSteps = 50;
const itemSizes = {
  label:[240, 60], zone:[420, 320], bench:[280, 140], rack:[220, 100],
  wall:[340, 40], door:[120, 80], aisle:[400, 120], rectangle:[220, 160], line:[260, 40]
};

export function createPrinterMapPage({ api, canEdit, openPrinter }) {
  const page = document.querySelector('#printerMapPage');
  const room = page.querySelector('#printerMapSelect');
  const create = page.querySelector('#printerMapNew');
  const edit = page.querySelector('#printerMapEdit');
  const reload = page.querySelector('#printerMapReload');
  const enterFullscreen = page.querySelector('#printerMapEnterFullscreen');
  const fullscreenDialog = page.querySelector('#printerMapFullscreen');
  const fullscreenTitle = page.querySelector('#printerMapFullscreenTitle');
  const fullscreenStage = page.querySelector('#printerMapFullscreenStage');
  const exitFullscreen = page.querySelector('#printerMapExitFullscreen');
  const form = page.querySelector('#printerMapEditor');
  const name = form.elements.mapName;
  const available = form.elements.printer;
  const mapColumns = form.elements.mapColumns;
  const mapRows = form.elements.mapRows;
  const printerDensity = form.elements.printerDensity;
  const itemType = form.elements.layoutType;
  const status = page.querySelector('#printerMapStatus');
  const error = page.querySelector('#printerMapError');
  const help = page.querySelector('#printerMapHelp');
  const viewport = page.querySelector('#printerMapViewport');
  const viewportNext = viewport.nextElementSibling;
  const canvas = page.querySelector('#printerMapCanvas');
  const box = page.querySelector('#printerMapBox');
  const groupStatus = page.querySelector('#printerMapGroup');
  const itemLayer = page.querySelector('#printerMapItems');
  const itemEditor = page.querySelector('#printerMapItemEditor');
  const itemFields = itemEditor.elements;
  const doorDirection = page.querySelector('#printerMapDoorDirection');
  const lineOrientation = page.querySelector('#printerMapLineAxis');
  const canvasStyle = getComputedStyle(canvas);
  const gridStep = Number(canvasStyle.getPropertyValue('--map-grid-step'));
  const gridPixels = parseFloat(canvasStyle.getPropertyValue('--map-dot-spacing'));
  const gridOffset = gridStep / 2;
  const shelf = page.querySelector('#printerMapUnplaced');
  const selection = page.querySelector('#printerMapSelection');
  const actions = Object.fromEntries([...page.querySelectorAll('[data-map-action]')]
    .map(button => [button.dataset.mapAction, button]));
  const markers = new Map();
  const itemNodes = new Map();
  let maps = [];
  let printers = [];
  let activeId = '';
  let selected = new Set();
  let draft = null;
  let drag = null;
  let busy = false;
  let loaded = false;
  let nativeFullscreen = false;
  let previousScroll;

  function rememberRoom() {
    try { localStorage.setItem(preferenceKey, activeId); } catch {}
  }

  function currentMap() {
    return draft || maps.find(map => map.id === activeId);
  }

  function setOptions(select, options, value) {
    if (select.options.length !== options.length || options.some(([id, label], index) =>
      select.options[index]?.value !== id || select.options[index]?.text !== label)) {
      select.replaceChildren(...options.map(([id, label]) => new Option(label, id)));
    }
    select.value = value;
    if (select.selectedIndex === -1) select.selectedIndex = 0;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'printer-map-marker';
    button.dataset.printerId = printerId;
    button.innerHTML = `<img class="printer-map-model" alt="" draggable="false" hidden>
    <svg class="printer-map-placeholder" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5zM8 16h8m-4-8v4"/></svg>
    <strong></strong>
    <span class="printer-map-flags">
      <span class="printer-map-alert" hidden>Alert</span>
      <span class="printer-map-printing" hidden>Printing</span>
      <span class="printer-map-queued"></span>
    </span>`;
    const marker = {
      button, image:button.querySelector('img'), placeholder:button.querySelector('.printer-map-placeholder'),
      label:button.querySelector('strong'), alert:button.querySelector('.printer-map-alert'),
      printing:button.querySelector('.printer-map-printing'), queued:button.querySelector('.printer-map-queued')
    };
    markers.set(printerId, marker);
    return marker;
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function fitFullscreen() {
    if (!fullscreenDialog.open) return;
    const canvasWidth = canvas.offsetWidth;
    const canvasHeight = canvas.offsetHeight;
    if (!canvasWidth || !canvasHeight) return;
    const contents = canvas.querySelectorAll('.printer-map-marker, .printer-map-item');
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
    nativeFullscreen = false;
    if (document.fullscreenElement === fullscreenDialog) document.exitFullscreen().catch(() => {});
    fullscreenResize.disconnect();
    fullscreenUpdates.disconnect();
    viewportNext.before(viewport);
    viewport.scrollTo(...previousScroll);
    if (!page.hidden) enterFullscreen.focus({ preventScroll:true });
  });

  function itemTypeName(type) {
    return itemType.querySelector(`option[value="${type}"]`).textContent;
  }

  function updateItem(node, item) {
    updateMarkerPosition(node, item);
    node.style.setProperty('--map-item-width', item.width / gridStep);
    node.style.setProperty('--map-item-height', item.height / gridStep);
    node.dataset.kind = item.type;
    node.dataset.axis = item.axis || (item.height > item.width ? 'vertical' : 'horizontal');
    const doorSymbol = node.querySelector('.printer-map-door-symbol');
    doorSymbol.toggleAttribute('hidden', item.type !== 'door');
    if (item.type === 'door') {
      doorSymbol.style.setProperty('--map-door-angle', `${item.rotation ?? (item.height > item.width ? 90 : 0)}deg`);
      doorSymbol.style.setProperty('--map-door-flip', item.mirrored ? '-1' : '1');
    }
    const label = item.label || (['line', 'wall', 'door', 'rectangle'].includes(item.type) ? '' : itemTypeName(item.type));
    setText(node.querySelector('.printer-map-item-label'), label);
    node.title = item.label ? `${itemTypeName(item.type)} · ${item.label}` : itemTypeName(item.type);
    node.setAttribute('aria-label', node.title);
  }

  function updateLineJoins() {
    const segments = (currentMap()?.items || []).filter(item => item.axis).map(item => {
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
      const node = itemNodes.get(a.item.id);
      node.style.setProperty('--map-line-start', (a.from - a.start) / gridStep);
      node.style.setProperty('--map-line-end', (a.start + a.length - a.to) / gridStep);
    }
  }

  function renderItems() {
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
        node.innerHTML = `<svg class="printer-map-door-symbol" viewBox="0 0 36 36" aria-hidden="true"
          fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" hidden>
          <path d="M1 30h6m22 0h6" stroke-width="3"/>
          <path d="M7 30V8" stroke-width="2"/>
          <path d="M7 8a22 22 0 0 1 22 22" stroke-width="1.5" stroke-dasharray="2 2"/>
          <circle cx="7" cy="30" r="2" fill="currentColor"/>
        </svg><span class="printer-map-item-label"></span><span data-map-resize aria-hidden="true"></span>`;
        itemLayer.append(node);
        itemNodes.set(item.id, node);
      }
      node.disabled = busy || !draft;
      node.setAttribute('aria-pressed', String(selected.has(item)));
      node.classList.toggle('is-single-selection', selected.has(item) && selected.size === 1);
      updateItem(node, item);
    }
    updateLineJoins();
    actions.addItem.disabled = items.length >= 200;
    const item = singleSelection();
    const editableItem = Boolean(item?.type);
    const editingDoor = item?.type === 'door';
    lineOrientation.hidden = !item?.axis;
    itemFields.itemWidth.disabled = item?.axis === 'vertical';
    itemFields.itemHeight.disabled = item?.axis === 'horizontal';
    if (item?.axis) itemFields.lineAxis.value = item.axis;
    doorDirection.hidden = actions.flipDoor.hidden = !editingDoor;
    if (editingDoor) {
      itemFields.doorRotation.value = String(item.rotation ?? (item.height > item.width ? 90 : 0));
      actions.flipDoor.setAttribute('aria-pressed', String(Boolean(item.mirrored)));
    }
    itemEditor.hidden = !editableItem;
    itemEditor.disabled = busy;
    if (editableItem) {
      setText(itemEditor.querySelector('legend'), `Selected ${itemTypeName(item.type).toLowerCase()}`);
      itemFields.itemLabel.value = item.label;
      itemFields.itemWidth.value = Math.round(item.width / gridStep);
      itemFields.itemHeight.value = Math.round(item.height / gridStep);
      const { width, height } = roomBounds();
      itemFields.itemWidth.max = width / gridStep;
      itemFields.itemHeight.max = height / gridStep;
    }
    groupStatus.hidden = selected.size < 2;
    setText(groupStatus, selected.size < 2 ? '' : `${selected.size} selected. Drag one to move them together.`);
  }

  function renderMarkers() {
    const map = currentMap();
    const placements = new Map(map?.placements.map(item => [item.printerId, item]));
    const assigned = new Set(maps.filter(saved => saved.id !== map?.id)
      .flatMap(saved => saved.placements.map(item => item.printerId)));
    const unplaced = printers.filter(printer => !assigned.has(printer.id) && !placements.has(printer.id));
    if (draft) {
      setOptions(available, [['', 'Choose a printer'], ...unplaced.map(printer => [printer.id, printer.name])], available.value);
      available.disabled = !unplaced.length;
      actions.add.disabled = !available.value;
    }

    viewport.hidden = !map;
    shelf.hidden = Boolean(map);
    const parent = map ? canvas : shelf;
    const visible = map ? printers.filter(printer => placements.has(printer.id)) : unplaced;
    const visibleIds = new Set(visible.map(printer => printer.id));
    for (const [id, marker] of markers) {
      if (visibleIds.has(id)) continue;
      marker.button.remove();
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
      marker.button.disabled = busy && Boolean(draft);
      const placement = placements.get(printer.id);
      if (draft) marker.button.setAttribute('aria-pressed', String(selected.has(placement)));
      else marker.button.removeAttribute('aria-pressed');
      if (placement) {
        updateMarkerPosition(marker.button, placement);
        marker.button.setAttribute('aria-label', [
          printer.name,
          printer.alert && 'Alert', printer.printing && 'Printing', `${printer.queued} queued`
        ].filter(Boolean).join(', '));
      } else marker.button.removeAttribute('aria-label');
      if (marker.button.parentElement !== parent) parent.append(marker.button);
    }

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

  function render() {
    const editing = Boolean(draft);
    setOptions(room, [...maps.map(map => [map.id, map.name]), ['', 'Unplaced printers']], activeId);
    room.disabled = !loaded || busy || editing;
    create.hidden = !loaded || editing || !canEdit();
    edit.hidden = create.hidden || !currentMap();
    enterFullscreen.hidden = !loaded || editing || !currentMap();
    enterFullscreen.disabled = busy;
    create.disabled = edit.disabled = reload.disabled = busy;
    form.hidden = help.hidden = !editing;
    form.querySelector('fieldset').disabled = busy;
    canvas.classList.toggle('is-editing', editing);
    renderRoomGeometry();
    actions.delete.hidden = !draft?.id;
    renderMarkers();
    renderItems();
  }

  function endEdit() {
    draft = null;
    selected.clear();
    drag = null;
    box.hidden = true;
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
    return placement.printerId ? markers.get(placement.printerId)?.button : itemNodes.get(placement.id);
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

  function moveSelection(entries, dx, dy) {
    const { width, height } = roomBounds();
    if (entries.length === 1) {
      const [{ placement, x, y }] = entries;
      placement.x = snap(x + dx, width, placement.width);
      placement.y = snap(y + dy, height, placement.height);
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
    if (entries.some(({ placement }) => placement.axis)) updateLineJoins();
  }

  function snap(value, boundary, extent = 0) {
    // Each dot is centred in its grid cell over the tile's usable travel.
    const nearest = Math.round((value - gridOffset) / gridStep) * gridStep + gridOffset;
    const limit = Math.floor((boundary - gridOffset - extent) / gridStep) * gridStep + gridOffset;
    if (limit < gridOffset) return boundary - extent;
    return Math.min(limit, Math.max(gridOffset, nearest));
  }

  function resizeItem(item, width, height, anchored = false) {
    const bounds = roomBounds();
    const dimension = (value, boundary, start) => Math.min(Math.floor((boundary - start) / gridStep),
      Math.max(1, Math.round(value / gridStep))) * gridStep;
    item.width = dimension(width, bounds.width, anchored ? item.x : 0);
    item.height = dimension(height, bounds.height, anchored ? item.y : 0);
    if (item.axis === 'vertical') item.width = Math.min(2 * gridStep, bounds.width);
    if (item.axis === 'horizontal') item.height = Math.min(2 * gridStep, bounds.height);
    if (item.x + item.width > bounds.width) item.x = snap(item.x, bounds.width, item.width);
    if (item.y + item.height > bounds.height) item.y = snap(item.y, bounds.height, item.height);
    updateItem(itemNodes.get(item.id), item);
    if (item.axis) updateLineJoins();
  }

  function findPrinterSpace() {
    const { width, height } = roomBounds();
    const tileWidth = (parseFloat(canvasStyle.getPropertyValue('--map-marker-width')) + 8) * gridStep / gridPixels;
    const tileHeight = (parseFloat(canvasStyle.getPropertyValue('--map-marker-height')) + 8) * gridStep / gridPixels;
    for (let y = gridOffset; y < height; y += gridStep) {
      for (let x = gridOffset; x < width; x += gridStep) {
        if (!draft.placements.some(item => Math.abs(item.x - x) < tileWidth
            && Math.abs(item.y - y) < tileHeight)) return { x, y };
      }
    }
  }

  function addPrinter() {
    if (!draft || busy || !available.value) return;
    const position = findPrinterSpace();
    if (!position) {
      setText(error, 'No free space for this printer. Move existing tiles, switch to Compact, or enlarge the map.');
      return;
    }
    setText(error, '');
    const placement = { printerId:available.value, ...position };
    draft.placements.push(placement);
    selected = new Set([placement]);
    render();
    nodeFor(placement)?.focus();
  }

  function markerAt(event) {
    return event.target.closest('.printer-map-marker, .printer-map-item');
  }

  page.addEventListener('click', event => {
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
    } else if (!busy && marker.dataset.printerId) openPrinter(marker.dataset.printerId);
  });
  canvas.addEventListener('pointerdown', event => {
    if (!draft || busy || drag || event.button !== 0 || !event.isPrimary) return;
    const marker = markerAt(event);
    if (!marker && event.pointerType !== 'touch') {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drag = { id:event.pointerId, boxStart:canvasPoint(event) };
      return;
    }
    if (!marker || event.ctrlKey || event.metaKey) return;
    const placement = placementFor(marker);
    if (!placement) return;
    if (!selected.has(placement)) selected = new Set([placement]);
    marker.focus({ preventScroll:true });
    marker.setPointerCapture(event.pointerId);
    drag = { placement, id:event.pointerId, start:canvasPoint(event),
      entries:[...selected].map(entry => ({ placement:entry, x:entry.x, y:entry.y })),
      width:placement.width, height:placement.height,
      resizing:Boolean(event.target.closest('[data-map-resize]')),
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
    if (drag.resizing) {
      resizeItem(drag.placement, drag.width + dx, drag.height + dy, true);
      return;
    }
    moveSelection(drag.entries, dx, dy);
  });
  canvas.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId || !drag.boxStart) return;
    drawBox(drag.boxStart, canvasPoint(event));
    selected.clear();
    if (!box.hidden) {
      const bounds = box.getBoundingClientRect();
      for (const placement of [...draft.placements, ...draft.items]) {
        const rect = nodeFor(placement)?.getBoundingClientRect();
        if (rect && rect.left >= bounds.left && rect.right <= bounds.right
            && rect.top >= bounds.top && rect.bottom <= bounds.bottom) selected.add(placement);
      }
    }
    box.hidden = true;
    drag = null;
    if (selected.size) nodeFor(selected.values().next().value)?.focus({ preventScroll:true });
    renderMarkers();
    renderItems();
  });
  canvas.addEventListener('lostpointercapture', event => {
    if (drag?.id !== event.pointerId) return;
    box.hidden = true;
    drag = null;
    renderMarkers();
    renderItems();
  });
  canvas.addEventListener('keydown', event => {
    const marker = markerAt(event);
    const delta = { ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1] }[event.key];
    if (!draft || !marker || !delta || busy) return;
    event.preventDefault();
    const placement = placementFor(marker);
    if (!placement) return;
    if (!selected.has(placement)) selected = new Set([placement]);
    const step = gridStep * (event.shiftKey ? 3 : 1);
    const entries = [...selected].map(entry => ({ placement:entry, x:entry.x, y:entry.y }));
    moveSelection(entries, delta[0] * step, delta[1] * step);
    renderMarkers();
    renderItems();
    marker.scrollIntoView({ block:'nearest', inline:'nearest' });
  });
  page.addEventListener('keydown', event => {
    if (!draft || event.key !== 'Escape' || (!selected.size && !drag?.boxStart)) return;
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
    available.focus();
  });
  actions.addItem.addEventListener('click', () => {
    if (!draft || busy || draft.items.length >= 200) return;
    const type = itemType.value;
    const bounds = roomBounds();
    const width = Math.min(itemSizes[type][0], bounds.width);
    const height = Math.min(itemSizes[type][1], bounds.height);
    const offset = (draft.items.length % 5) * 40 + 30;
    const item = {
      id:crypto.getRandomValues(new Uint32Array(4)).join('-'), type, label:type === 'label' ? 'Label' : '',
      x:snap(viewport.scrollLeft * gridStep / gridPixels + offset, bounds.width, width),
      y:snap(viewport.scrollTop * gridStep / gridPixels + offset, bounds.height, height),
      width, height
    };
    if (type === 'door') Object.assign(item, { rotation:0, mirrored:false });
    if (type === 'wall' || type === 'line') item.axis = 'horizontal';
    draft.items.push(item);
    selected = new Set([item]);
    render();
    nodeFor(item).focus();
  });
  actions.removeItem.addEventListener('click', () => {
    const item = singleSelection();
    if (!draft || busy || !item?.type) return;
    draft.items = draft.items.filter(entry => entry !== item);
    selected.clear();
    renderItems();
    actions.addItem.focus();
  });
  itemFields.itemLabel.addEventListener('input', () => {
    const item = singleSelection();
    if (!item?.type || busy) return;
    item.label = itemFields.itemLabel.value;
    updateItem(itemNodes.get(item.id), item);
  });
  itemFields.doorRotation.addEventListener('change', () => {
    const item = singleSelection();
    if (item?.type !== 'door' || busy) return;
    item.rotation = Number(itemFields.doorRotation.value);
    updateItem(nodeFor(item), item);
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
    updateItem(nodeFor(item), item);
  });
  itemEditor.addEventListener('change', event => {
    if (event.target.type !== 'number') return;
    const item = singleSelection();
    if (!item?.type || busy) return;
    const steps = [itemFields.itemWidth.valueAsNumber, itemFields.itemHeight.valueAsNumber];
    const valid = steps.every(value => Number.isSafeInteger(value) && value >= 1);
    if (valid) resizeItem(item, steps[0] * gridStep, steps[1] * gridStep);
    setText(error, valid ? '' : 'Enter a valid positive whole number of grid steps for each dimension.');
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
  available.addEventListener('change', () => { actions.add.disabled = !available.value; });
  actions.add.addEventListener('click', addPrinter);
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
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (applyRoomDimensions()) save();
  });

  return {
    load,
    update(nextPrinters) {
      printers = nextPrinters;
      if (!page.hidden && loaded) renderMarkers();
    }
  };
}
