import { postPrinterApi, printerAuth } from './printer-api.js';

export const CREATOR5_TOOL_COUNT = 4;
export const CREATOR5_NOZZLE_MAX_C = 320;
export const CREATOR5_BED_MAX_C = 120;
export const CREATOR5_PRO_CHAMBER_MAX_C = 65;

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function slotInfoByIndex(detail = {}) {
  const slots = Array.isArray(detail.matlStationInfo?.slotInfos)
    ? detail.matlStationInfo.slotInfos
    : Array.isArray(detail.slotInfos) ? detail.slotInfos : [];
  const byIndex = new Map();
  for (const [arrayIndex, slot] of slots.entries()) {
    const oneBased = Number(slot?.slotId ?? slot?.slot ?? (arrayIndex + 1));
    const index = Number.isInteger(oneBased) && oneBased >= 1 && oneBased <= CREATOR5_TOOL_COUNT
      ? oneBased - 1
      : arrayIndex;
    if (index >= 0 && index < CREATOR5_TOOL_COUNT) byIndex.set(index, slot || {});
  }
  return byIndex;
}

function normalizeCreatorState(value) {
  const state = String(value || 'unknown').trim().toLowerCase();
  if (['ready','standby','complete','completed'].includes(state)) return 'idle';
  return state;
}

export function normalizeCreator5Status(detail = {}, { model = null, nozzleDiameter = null } = {}) {
  const nozzleTemps = Array.isArray(detail.nozzleTemps) ? detail.nozzleTemps : [];
  const nozzleTargets = Array.isArray(detail.nozzleTargetTemps) ? detail.nozzleTargetTemps : [];
  const slots = slotInfoByIndex(detail);
  const currentSlotRaw = Number(detail.currentSlot ?? detail.matlStationInfo?.currentSlot);
  const activeIndex = Number.isInteger(currentSlotRaw) && currentSlotRaw >= 1 && currentSlotRaw <= CREATOR5_TOOL_COUNT
    ? currentSlotRaw - 1
    : null;
  const designatedNozzle = Number(nozzleDiameter);
  const nozzleSize = Number.isFinite(designatedNozzle) && designatedNozzle > 0 ? designatedNozzle : null;

  const tools = Array.from({ length:CREATOR5_TOOL_COUNT }, (_, index) => {
    const slot = slots.get(index) || {};
    const hasFilament = typeof slot.hasFilament === 'boolean'
      ? slot.hasFilament
      : typeof slot.present === 'boolean' ? slot.present : null;
    const material = cleanText(slot.materialName ?? slot.materialType ?? slot.mt);
    const color = cleanText(slot.materialColor ?? slot.color ?? slot.rgb);
    return {
      index,
      name:`T${index}`,
      actual:numeric(nozzleTemps[index], index === 0 ? numeric(detail.rightTemp) : 0),
      target:numeric(nozzleTargets[index], index === 0 ? numeric(detail.rightTargetTemp) : 0),
      active:activeIndex === index,
      nozzleDiameter:nozzleSize,
      filament:{
        present:hasFilament,
        detecting:false,
        material,
        materialVariant:null,
        color,
        vendor:null,
        manufacturer:null,
        materialSource:material ? 'printer' : null,
        colorSource:color ? 'printer' : null,
        metadataAvailable:Boolean(material || color || hasFilament !== null)
      }
    };
  });

  const activeTool = activeIndex == null ? tools[0] : tools[activeIndex] || tools[0];
  const progressRaw = numeric(detail.printProgress, 0);
  const progress = Math.max(0, Math.min(100, progressRaw <= 1 ? progressRaw * 100 : progressRaw));
  const resolvedModel = cleanText(model || detail.model || detail.typeName) || 'Creator 5';
  const pro = /creator\s*5\s*pro/i.test(resolvedModel) || Number(detail.pid) === 41;

  return {
    status:normalizeCreatorState(detail.status),
    printerName:cleanText(detail.name),
    firmwareVersion:cleanText(detail.firmwareVersion),
    pid:detail.pid ?? null,
    model:resolvedModel,
    fileName:cleanText(detail.printFileName),
    progress,
    currentLayer:numeric(detail.printLayer, 0),
    totalLayers:numeric(detail.targetPrintLayer, 0),
    remainingSeconds:numeric(detail.estimatedTime, 0),
    elapsedSeconds:numeric(detail.printDuration, 0),
    activeTool:activeIndex,
    nozzle:{
      actual:numeric(activeTool?.actual, 0),
      target:numeric(activeTool?.target, 0)
    },
    tools,
    materials:{
      available:tools.some((tool) => tool.filament?.metadataAvailable),
      loadedCount:tools.filter((tool) => tool.filament?.present === true).length,
      toolCount:CREATOR5_TOOL_COUNT,
      metadataCount:tools.filter((tool) => tool.filament?.metadataAvailable).length,
      detecting:false,
      tools:tools.map((tool) => ({ index:tool.index, ...tool.filament }))
    },
    bed:{
      actual:numeric(detail.platTemp, 0),
      target:numeric(detail.platTargetTemp, 0)
    },
    chamber:{
      actual:pro ? nullableNumber(detail.chamberTemp) : null,
      target:pro ? nullableNumber(detail.chamberTargetTemp) : null
    },
    coolingFan:numeric(detail.coolingFanSpeed ?? detail.coolingFan, 0),
    chamberFan:numeric(detail.chamberFanSpeed ?? detail.chamberFan, 0),
    filtration:{
      available:pro,
      readOnly:pro
    },
    cameraAvailable:true
  };
}

export async function getCreator5Status(printer) {
  const response = await postPrinterApi(printer, '/detail', printerAuth(printer));
  return normalizeCreator5Status(response.detail || {}, {
    model:printer.model,
    nozzleDiameter:printer.adapterConfig?.nozzleDiameterDesignation
  });
}

export async function getCreator5Files(printer) {
  const response = await postPrinterApi(printer, '/gcodeList', printerAuth(printer));
  let files = [];
  if (Array.isArray(response.gcodeList)) files = response.gcodeList.filter(Boolean);
  else if (Array.isArray(response.gcodeListDetail)) files = response.gcodeListDetail.map((file) => file?.gcodeFileName).filter(Boolean);
  return {
    files,
    recentFiles:files,
    complete:false,
    source:'http-recent',
    ordering:'last-printed-first',
    warning:'Creator 5 series firmware does not expose the TCP 8899 full-file API. Showing the files returned by the HTTP recent-file list.'
  };
}

export async function verifyCreator5File(printer, fileName) {
  const wanted = String(fileName || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    try {
      const listing = await getCreator5Files(printer);
      if (listing.files.some((file) => String(file).replace(/\\/g, '/').split('/').pop().toLowerCase() === wanted)) {
        return { verified:true, source:'http-recent' };
      }
    } catch (error) {
      lastError = error;
    }
  }
  return {
    verified:false,
    source:null,
    warning:lastError
      ? `Upload accepted, but Creator 5 HTTP verification failed: ${lastError.message}`
      : 'Upload accepted, but the file was not visible in the Creator 5 HTTP file list after verification.'
  };
}

export async function controlCreator5(printer, cmd, args) {
  return postPrinterApi(printer, '/control', {
    ...printerAuth(printer),
    payload:{ cmd, args }
  }, 10000);
}

export async function setCreator5Temperatures(printer, { nozzle, toolIndex, bed, chamber } = {}) {
  const args = {};
  if (nozzle !== undefined) {
    const value = Number(nozzle);
    const index = toolIndex === undefined ? 0 : Number(toolIndex);
    if (!Number.isFinite(value) || value < 0 || value > CREATOR5_NOZZLE_MAX_C) {
      throw new Error(`Nozzle must be 0-${CREATOR5_NOZZLE_MAX_C} C`);
    }
    if (!Number.isInteger(index) || index < 0 || index >= CREATOR5_TOOL_COUNT) {
      throw new Error(`Creator 5 tool index must be 0-${CREATOR5_TOOL_COUNT - 1}`);
    }
    args.nozzles = Array(CREATOR5_TOOL_COUNT).fill(-200);
    args.nozzles[index] = value;
  }
  if (bed !== undefined) {
    const value = Number(bed);
    if (!Number.isFinite(value) || value < 0 || value > CREATOR5_BED_MAX_C) throw new Error(`Bed must be 0-${CREATOR5_BED_MAX_C} C`);
    args.platform = value;
  }
  if (chamber !== undefined) {
    if (!/creator\s*5\s*pro/i.test(String(printer.model || ''))) throw new Error('Heated chamber control is only available on Creator 5 Pro');
    const value = Number(chamber);
    if (!Number.isFinite(value) || value < 0 || value > CREATOR5_PRO_CHAMBER_MAX_C) {
      throw new Error(`Chamber must be 0-${CREATOR5_PRO_CHAMBER_MAX_C} C`);
    }
    args.chamber = value;
  }
  if (!Object.keys(args).length) throw new Error('No temperature value supplied');
  return controlCreator5(printer, 'temperatureCtl_cmd', args);
}

export async function setCreator5JobState(printer, action) {
  const map = { pause:'pause', resume:'continue', cancel:'cancel' };
  const printerAction = map[action];
  if (!printerAction) throw new Error(`Unsupported job action: ${action}`);
  return controlCreator5(printer, 'jobCtl_cmd', { jobID:'', action:printerAction });
}

export async function levelCreator5Bed(printer) {
  return controlCreator5(printer, 'calibration_cmd', {
    levelingDetection:'open',
    vibrationCompensation:'close'
  });
}

function normalizeHexColor(value, fallback = '#808080') {
  const text = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : fallback;
}

export function creator5MaterialMappings({ toolMap, logicalTools = [], physicalTools = [] } = {}) {
  if (!toolMap || typeof toolMap !== 'object') return [];
  const logicalByIndex = new Map((logicalTools || []).map((tool) => [Number(tool.index), tool]));
  const physicalByIndex = new Map((physicalTools || []).map((tool) => [Number(tool.index), tool]));
  const mappings = [];
  for (const [logicalKey, physicalValue] of Object.entries(toolMap)) {
    const toolId = Number(logicalKey);
    const physicalIndex = Number(physicalValue);
    if (!Number.isInteger(toolId) || !Number.isInteger(physicalIndex) || physicalIndex < 0 || physicalIndex >= CREATOR5_TOOL_COUNT) continue;
    const logical = logicalByIndex.get(toolId) || {};
    const physical = physicalByIndex.get(physicalIndex) || {};
    const materialName = cleanText(logical.material || physical.filament?.material) || 'PLA';
    mappings.push({
      toolId,
      slotId:physicalIndex + 1,
      materialName,
      toolMaterialColor:normalizeHexColor(logical.color, normalizeHexColor(physical.filament?.color)),
      slotMaterialColor:normalizeHexColor(physical.filament?.color, normalizeHexColor(logical.color))
    });
  }
  return mappings.sort((a, b) => a.toolId - b.toolId);
}

export async function printCreator5File(printer, fileName, options = {}) {
  const usedLogicalTools = Array.isArray(options.usedLogicalTools) ? [...new Set(options.usedLogicalTools.map(Number).filter(Number.isInteger))] : [];
  let mappings = [];
  if (options.toolMap && (usedLogicalTools.length > 1 || Object.keys(options.toolMap).length > 1)) {
    const status = await getCreator5Status(printer);
    mappings = creator5MaterialMappings({
      toolMap:options.toolMap,
      logicalTools:options.logicalTools,
      physicalTools:status.tools
    });
    if (mappings.length < Math.max(usedLogicalTools.length, Object.keys(options.toolMap).length)) {
      throw new Error('Creator 5 multi-tool mapping is incomplete. Review the Print setup before starting the file.');
    }
  }

  const body = {
    ...printerAuth(printer),
    fileName,
    levelingBeforePrint:options.levelingBeforePrint !== false,
    flowCalibration:options.flowCalibrationBeforePrint === true,
    timeLapseVideo:options.timeLapseBeforePrint === true
  };
  if (mappings.length > 1) body.materialMappings = mappings;
  return postPrinterApi(printer, '/printGcode', body, 10000);
}

export function creator5CameraUrl(printer) {
  return `http://${printer.host}:${printer.cameraPort || 8080}/?action=stream`;
}
