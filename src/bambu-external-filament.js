import { getBambuReport, sendBambuCommand } from './bambu-mqtt.js';

// Generic Bambu preset IDs and recommended nozzle ranges. Unlike AMS RFID
// material, external-spool metadata must be entered manually.
export const BAMBU_EXTERNAL_FILAMENT_PRESETS = Object.freeze({
  PLA: { id:'GFL99', min:190, max:250 },
  'PLA-CF': { id:'GFL98', min:190, max:250 },
  PETG: { id:'GFG99', min:220, max:260 },
  'PETG-CF': { id:'GFG98', min:240, max:270 },
  ABS: { id:'GFB99', min:240, max:270 },
  ASA: { id:'GFB98', min:240, max:270 },
  TPU: { id:'GFU99', min:200, max:250 },
  PVA: { id:'GFS99', min:190, max:250 },
  PA: { id:'GFN99', min:270, max:300 },
  'PA-CF': { id:'GFN98', min:270, max:300 },
  PC: { id:'GFC99', min:260, max:280 }
});

export function bambuExternalFilamentCommand({ toolIndex, material, color, currentTray = {} } = {}) {
  if (Number(toolIndex) !== 0 || toolIndex === null || toolIndex === undefined) {
    throw new Error('Bambu external spool uses tool index 0');
  }
  const type = String(material || '').trim().toUpperCase();
  const preset = BAMBU_EXTERNAL_FILAMENT_PRESETS[type];
  if (!preset) throw new Error('Choose a supported Bambu external-spool filament type.');
  const rgb = String(color || '').trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(rgb)) throw new Error('Choose a valid six-digit filament colour.');
  const unchangedType = String(currentTray.tray_type || '').trim().toUpperCase() === type;
  const currentId = String(currentTray.tray_info_idx || '').trim();
  // Preserve an existing vendor/material variant when only the colour changes.
  const infoId = unchangedType && /^[A-Z0-9]{5}$/.test(currentId) ? currentId : preset.id;
  const currentMin = Number(currentTray.nozzle_temp_min);
  const currentMax = Number(currentTray.nozzle_temp_max);
  const retainTemps = unchangedType && Number.isInteger(currentMin) && Number.isInteger(currentMax)
    && currentMin >= 150 && currentMax <= 300 && currentMax >= currentMin;
  return {
    print: {
      sequence_id:String(Date.now()),
      command:'ams_filament_setting',
      ams_id:255,
      slot_id:0,
      tray_id:254,
      tray_info_idx:infoId,
      tray_color:rgb + 'FF',
      nozzle_temp_min:retainTemps ? currentMin : preset.min,
      nozzle_temp_max:retainTemps ? currentMax : preset.max,
      tray_type:type
    }
  };
}

export async function setBambuExternalFilament(printer, request, {
  getReport = getBambuReport,
  sendCommand = sendBambuCommand,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const model = String(printer?.model || '').trim().toUpperCase();
  if (!['P1P', 'P1S', 'X1C'].includes(model)) throw new Error('External-spool filament control is supported only for P1P/P1S/X1C.');
  const before = await getReport(printer);
  const state = String((before.print || before).gcode_state || '').trim().toUpperCase();
  if (!['IDLE', 'READY'].includes(state)) throw new Error('Set external-spool filament only while the Bambu printer is idle.');
  const tray = (before.print || before).vt_tray || (before.print || before).virtual_tray || {};
  const command = bambuExternalFilamentCommand({ ...request, currentTray:tray });
  await sendCommand(printer, command);

  // MQTT PUBLISH is not an acknowledgement that the printer accepted the
  // write. Do not claim success until subsequent printer telemetry matches.
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(650);
    const report = await getReport(printer);
    const updated = (report.print || report).vt_tray || (report.print || report).virtual_tray;
    if (!updated) continue;
    const actualType = String(updated.tray_type || '').trim().toUpperCase();
    const actualColor = String(updated.tray_color || '').trim().replace(/^#/, '').toUpperCase();
    if (actualType === command.print.tray_type && actualColor.slice(0, 6) === command.print.tray_color.slice(0, 6)) {
      return { material:actualType, color:'#' + actualColor.slice(0, 6), verified:true };
    }
  }
  throw new Error('Bambu did not confirm the external-spool filament change. Check LAN Only / Developer Mode and retry.');
}
