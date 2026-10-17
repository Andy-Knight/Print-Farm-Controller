import { getBambuReport, sendBambuCommand } from './bambu-mqtt.js';
import { bambuExternalFilamentCommand } from './bambu-external-filament.js';

const MODELS = new Set(['P1P', 'P1S', 'X1C']);
const ZERO_TAG = /^0+$/;

/** Fail closed: a missing tag UID means the printer has not proved the slot is manually editable. */
export function bambuAmsRfidState(tray = {}) {
  const tag = String(tray?.tag_uid ?? '').trim().replace(/^0x/i, '');
  const uuid = String(tray?.tray_uuid ?? '').trim().replace(/^0x/i, '');
  if (tag && !/^[0-9a-f]+$/i.test(tag)) return 'unknown';
  if (uuid && !/^[0-9a-f]+$/i.test(uuid)) return 'unknown';
  if ((tag && !ZERO_TAG.test(tag)) || (uuid && !ZERO_TAG.test(uuid))) return 'rfid';
  return tag && ZERO_TAG.test(tag) ? 'manual' : 'unknown';
}

function assertSlotIndex(unitIndex, slotIndex) {
  if (!Number.isInteger(unitIndex) || unitIndex < 0 || unitIndex > 3
    || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3)
    throw new Error('Select a valid AMS unit (1–4) and slot (1–4).');
}

/** AMS presence is a printer signal, not inferred solely from known filament metadata. */
export function bambuAmsSlotPresent(print, unitIndex, slotIndex, tray) {
  if (!tray) return false;
  if (tray.tray_exist_bits !== undefined)
    return Boolean(Number(tray.tray_exist_bits));
  const mask = print?.ams?.tray_exist_bits;
  if (mask !== undefined && /^[0-9a-f]+$/i.test(String(mask)))
    return Boolean((Number.parseInt(String(mask), 16) >>> (unitIndex * 4 + slotIndex)) & 1);
  return Boolean(tray.tray_type || tray.tray_color);
}

export function findBambuAmsSlot(print = {}, unitIndex, slotIndex) {
  assertSlotIndex(unitIndex, slotIndex);
  const units = Array.isArray(print.ams?.ams) ? print.ams.ams : [];
  const unit = units.find((candidate, i) => Number(candidate?.id ?? i) === unitIndex);
  const trays = Array.isArray(unit?.tray) ? unit.tray : [];
  const tray = trays.find((candidate, i) => Number(candidate?.id ?? i) === slotIndex);
  return { tray, present:bambuAmsSlotPresent(print,unitIndex,slotIndex,tray),
    rfidState:bambuAmsRfidState(tray) };
}

function requireManualSlot(print, unitIndex, slotIndex) {
  const slot = findBambuAmsSlot(print, unitIndex, slotIndex);
  if (!slot.present) throw new Error('This AMS slot is empty or not reported by the printer.');
  if (slot.rfidState === 'rfid') throw new Error('RFID-managed AMS filament is read-only.');
  if (slot.rfidState !== 'manual') throw new Error('AMS RFID status is not available; slot configuration is read-only for safety.');
  return slot.tray;
}

export function bambuAmsFilamentCommand({ unitIndex, slotIndex, material, color, currentTray } = {}) {
  assertSlotIndex(unitIndex, slotIndex);
  const base = bambuExternalFilamentCommand({ toolIndex:0, material, color, currentTray });
  return { print:{ ...base.print, ams_id:unitIndex, slot_id:slotIndex, tray_id:slotIndex } };
}

export async function setBambuAmsFilament(printer, request = {}, {
  getReport = getBambuReport,
  sendCommand = sendBambuCommand,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  if (!MODELS.has(String(printer?.model || '').trim().toUpperCase()))
    throw new Error('AMS slot editing is supported only for P1P, P1S and X1C.');
  const { unitIndex, slotIndex, toolIndex = 0 } = request;
  if (toolIndex !== 0) throw new Error('Bambu printers have one physical toolhead.');
  assertSlotIndex(unitIndex, slotIndex);
  const before = await getReport(printer);
  const print = before.print || before;
  if (!['IDLE','READY'].includes(String(print.gcode_state || '').trim().toUpperCase()))
    throw new Error('Set AMS filament only while the printer is idle.');
  const tray = requireManualSlot(print, unitIndex, slotIndex);
  const command = bambuAmsFilamentCommand({ ...request, currentTray:tray });
  await sendCommand(printer, command);
  // An MQTT publish is not acknowledgement of a changed slot. Re-read it.
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(650);
    const response = await getReport(printer);
    const latest = response.print || response;
    const observed = findBambuAmsSlot(latest,unitIndex,slotIndex);
    if (observed.rfidState === 'rfid') throw new Error('RFID filament was detected in this AMS slot during verification.');
    if (!observed.present || observed.rfidState !== 'manual') continue;
    const actualType = String(observed.tray.tray_type || '').trim().toUpperCase();
    const actualColor = String(observed.tray.tray_color || '').trim().replace(/^#/,'').toUpperCase();
    if (actualType === command.print.tray_type && actualColor.slice(0,6) === command.print.tray_color.slice(0,6)) {
      return { unitIndex,slotIndex,material:actualType,color:'#'+actualColor.slice(0,6),verified:true };
    }
  }
  throw new Error('Bambu did not confirm this AMS slot configuration. Check the printer and retry.');
}
