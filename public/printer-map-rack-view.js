import { maxRackBays, maxRackLevels, rackSlotKey } from './printer-map-rack.js';

export function createRackView(page, { onClose, onResize, onAssign, setOptions }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'printer-map-rack-dialog';
  dialog.setAttribute('aria-labelledby', 'printerMapRackTitle');
  dialog.innerHTML = `<div class="printer-map-rack-panel">
    <div class="dialog-head">
      <h2 id="printerMapRackTitle">Rack front view</h2>
      <button type="button" class="ui-button ui-button-secondary ui-button-medium secondary">Close</button>
    </div>
    <fieldset class="printer-map-toolbar printer-map-rack-settings" aria-label="Rack layout">
      <label>Levels <select name="levels"></select></label>
      <label>Bays per level <select name="bays"></select></label>
    </fieldset>
    <p class="error" role="alert"></p>
    <div class="printer-map-rack-scroll" role="region" aria-label="Rack shelves" tabindex="0">
      <div class="printer-map-rack-levels"></div>
    </div>
  </div>`;
  page.append(dialog);
  const fields = dialog.querySelector('fieldset');
  const { levels, bays } = fields.elements;
  const error = dialog.querySelector('[role="alert"]');
  const frame = dialog.querySelector('.printer-map-rack-levels');
  const slots = new Map();
  let signature;
  const options = limit => Array.from({ length:limit }, (_, index) => [String(index + 1), String(index + 1)]);
  setOptions(levels, options(maxRackLevels), '1');
  setOptions(bays, options(maxRackBays), '2');

  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', onClose);
  fields.addEventListener('change', () => onResize(Number(levels.value), Number(bays.value)));

  function makeSlots(rack, editing) {
    slots.clear();
    frame.replaceChildren();
    frame.style.setProperty('--rack-bays', rack.bays);
    for (let level = rack.levels; level >= 1; level--) {
      const shelf = document.createElement('section');
      shelf.className = 'printer-map-rack-level';
      const label = document.createElement('h3');
      label.textContent = `Level ${level}`;
      const row = document.createElement('div');
      row.className = 'printer-map-rack-bays';
      shelf.append(label, row);
      for (let bay = 1; bay <= rack.bays; bay++) {
        const slot = document.createElement('div');
        slot.className = 'printer-map-rack-slot';
        slot.dataset.rackSlot = rackSlotKey(level, bay);
        const caption = document.createElement('strong');
        caption.textContent = `Bay ${bay}`;
        const empty = document.createElement('span');
        const tile = document.createElement('div');
        slot.append(caption, empty, tile);
        const select = editing ? document.createElement('select') : null;
        if (select) {
          select.setAttribute('aria-label', `Printer for level ${level}, bay ${bay}`);
          select.addEventListener('change', () => onAssign(level, bay, select.value));
          slot.append(select);
        }
        slots.set(slot.dataset.rackSlot, { empty, tile, select });
        row.append(slot);
      }
      frame.append(shelf);
    }
  }

  return {
    dialog,
    render(rack, editing, busy, placements, printerNames, assignable) {
      fields.hidden = !editing;
      fields.disabled = busy;
      levels.value = rack.levels;
      bays.value = rack.bays;
      const next = `${rack.id}:${rack.levels}:${rack.bays}:${editing}`;
      if (next !== signature) {
        signature = next;
        makeSlots(rack, editing);
      }
      const occupied = new Map(placements.map(item => [rackSlotKey(item.level, item.bay), item.printerId]));
      for (const [key, { empty, select }] of slots) {
        const id = occupied.get(key);
        const label = printerNames.get(id);
        empty.hidden = Boolean(label);
        empty.textContent = id ? 'Printer unavailable' : 'Empty slot';
        if (select) {
          const choices = [['', 'Empty slot'], ...(id ? [[id, label ?? 'Printer unavailable']] : []), ...assignable];
          setOptions(select, choices, id ?? '');
          select.disabled = busy;
        }
      }
    },
    slot(placement) {
      return slots.get(rackSlotKey(placement.level, placement.bay))?.tile;
    },
    showError(message) {
      error.textContent = message;
    }
  };
}
