import path from 'node:path';
import { canonicalMaterial } from './file-material-metadata.js';
import {
  colorDistance,
  colorFamily,
  colorMatchScore,
  colorsCompatible,
  normalizeColor,
  resolveColorFamily
} from './color-family.js';

const ACTIVE_STATES = new Set(['printing', 'working', 'building_from_sd', 'pause', 'paused']);
const IDLE_STATES = new Set(['idle', 'ready', 'standby', 'complete', 'completed', 'cancel', 'cancelled', 'canceled', 'stopped']);

function normState(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function printerMatchesTarget(target, printer = {}, state = {}, adapter = {}) {
  if (!target?.adapterType || !target?.model) return true;
  const actualAdapterType = printer?.adapterType || adapter?.type || state?.adapterType || '';
  const actualModel = printer?.model || adapter?.model || state?.model || state?.status?.model || '';
  return normalizeIdentity(target.adapterType) === normalizeIdentity(actualAdapterType)
    && normalizeIdentity(target.model) === normalizeIdentity(actualModel);
}

function isBusy(status = {}) {
  const state = normState(status.status);
  // Moonraker and FlashForge may retain the previous filename after a print
  // completes or is cancelled. An explicit terminal/idle state is authoritative.
  if (IDLE_STATES.has(state)) return false;
  if (status.fileName) return true;
  if (ACTIVE_STATES.has(state)) return true;
  return state !== '';
}

function sameNozzle(a, b) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.001;
}

function requirementText(tool) {
  const parts = [];
  if (tool.material) parts.push(String(tool.material));
  if (tool.color) parts.push(String(tool.color));
  if (tool.nozzleDiameter != null) parts.push(`${Number(tool.nozzleDiameter).toFixed(1)} mm nozzle`);
  return parts.length ? parts.join(', ') : 'loaded filament';
}

function toolMatches(required, physical) {
  const filament = physical?.filament || {};
  if (filament.present === false) return false;
  if (required.nozzleDiameter != null && Number.isFinite(Number(physical?.nozzleDiameter)) && !sameNozzle(required.nozzleDiameter, physical.nozzleDiameter)) return false;
  const requiredMaterial = canonicalMaterial(required.material);
  const currentMaterial = canonicalMaterial(filament.material);
  if (requiredMaterial && currentMaterial && requiredMaterial !== currentMaterial) return false;
  const requiredColor = normalizeColor(required.color);
  const currentColor = normalizeColor(filament.color);
  const requiredFamily = resolveColorFamily({ color:requiredColor, family:required.colorFamily });
  const currentFamily = resolveColorFamily({ color:currentColor, family:filament.colorFamily });
  if (requiredFamily && currentFamily && requiredFamily !== currentFamily) return false;
  return true;
}

function mapLogicalTools(requirements = {}, status = {}) {
  const logicalTools = Array.isArray(requirements.logicalTools) ? requirements.logicalTools : [];
  const physicalTools = Array.isArray(status.tools) ? status.tools : [];
  if (!logicalTools.length) return { ok:true, toolMap:null, reasons:[], review:[] };

  const descriptors = logicalTools.map((logical) => ({
    logical,
    candidates:physicalTools
      .filter((tool) => Number.isInteger(Number(tool.index)))
      .filter((tool) => toolMatches(logical, tool))
      .sort((left, right) => colorMatchScore(logical.color, left?.filament?.color, {
        requiredFamily:logical.colorFamily,
        currentFamily:left?.filament?.colorFamily
      }) - colorMatchScore(logical.color, right?.filament?.color, {
        requiredFamily:logical.colorFamily,
        currentFamily:right?.filament?.colorFamily
      }) || Number(left.index) - Number(right.index))
  }));
  const missing = descriptors.filter((item) => !item.candidates.length);
  if (missing.length) {
    return {
      ok:false,
      toolMap:null,
      review:[],
      reasons:missing.map(({ logical }) => ({
        code:'tool_not_loaded',
        text:`No loaded tool matches file T${logical.index} (${requirementText(logical)})`
      }))
    };
  }

  // Assign the most constrained logical tools first so a broad requirement
  // cannot consume the only physical head that satisfies a later exact match.
  const ordered = [...descriptors].sort((a, b) => a.candidates.length - b.candidates.length || Number(a.logical.index) - Number(b.logical.index));
  const assigned = new Map();
  const usedPhysical = new Set();
  function choose(position) {
    if (position >= ordered.length) return true;
    const descriptor = ordered[position];
    for (const physical of descriptor.candidates) {
      const physicalIndex = Number(physical.index);
      if (usedPhysical.has(physicalIndex)) continue;
      usedPhysical.add(physicalIndex);
      assigned.set(Number(descriptor.logical.index), physical);
      if (choose(position + 1)) return true;
      assigned.delete(Number(descriptor.logical.index));
      usedPhysical.delete(physicalIndex);
    }
    return false;
  }

  if (!choose(0)) {
    return {
      ok:false,
      toolMap:null,
      review:[],
      reasons:[{ code:'tool_mapping_conflict', text:'No unique physical tool mapping satisfies all file tool requirements' }]
    };
  }

  const toolMap = {};
  const review = [];
  for (const logical of logicalTools) {
    const selected = assigned.get(Number(logical.index));
    toolMap[String(logical.index)] = Number(selected.index);
    if (logical.material && !canonicalMaterial(selected.filament?.material)) {
      review.push({ code:'material_unknown', text:`Physical T${selected.index} material is unknown for file T${logical.index} (${logical.material})` });
    }
    if (logical.nozzleDiameter != null && !Number.isFinite(Number(selected.nozzleDiameter))) {
      review.push({ code:'nozzle_unknown', text:`Physical T${selected.index} nozzle size is not reported for file T${logical.index} (${Number(logical.nozzleDiameter).toFixed(1)} mm)` });
    }
  }
  return { ok:review.length === 0, toolMap, reasons:[], review };
}

function sourceMatches(required, source) {
  if (source?.present === false) return false;
  const requiredMaterial = canonicalMaterial(required.material);
  const currentMaterial = canonicalMaterial(source?.material);
  if (requiredMaterial && currentMaterial && requiredMaterial !== currentMaterial) return false;
  const requiredColor = normalizeColor(required.color);
  const currentColor = normalizeColor(source?.color);
  const requiredFamily = resolveColorFamily({ color:requiredColor, family:required.colorFamily });
  const currentFamily = resolveColorFamily({ color:currentColor, family:source?.colorFamily });
  if (requiredFamily && currentFamily && requiredFamily !== currentFamily) return false;
  return true;
}

function mapLogicalMaterials(requirements = {}, status = {}) {
  const logicalTools = Array.isArray(requirements.logicalTools) ? requirements.logicalTools : [];
  const sources = (Array.isArray(status.materialSources) ? status.materialSources : []).filter((source) => source?.present !== false);
  if (!logicalTools.length) return { ok:true, materialMap:null, reasons:[], review:[] };
  const descriptors = logicalTools.map((logical) => ({
    logical,
    candidates:sources
      .filter((source) => sourceMatches(logical, source))
      .sort((left, right) => colorMatchScore(logical.color, left?.color, {
        requiredFamily:logical.colorFamily,
        currentFamily:left?.colorFamily
      }) - colorMatchScore(logical.color, right?.color, {
        requiredFamily:logical.colorFamily,
        currentFamily:right?.colorFamily
      }) || Number(left.protocolIndex) - Number(right.protocolIndex))
  }));
  const missing = descriptors.filter((item) => !item.candidates.length);
  if (missing.length) {
    return {
      ok:false, materialMap:null, review:[],
      reasons:missing.map(({ logical }) => ({ code:'material_slot_not_loaded', text:`No AMS or external-spool slot matches file T${logical.index} (${requirementText(logical)})` }))
    };
  }
  const ordered = [...descriptors].sort((a, b) => a.candidates.length - b.candidates.length || Number(a.logical.index) - Number(b.logical.index));
  const assigned = new Map();
  const used = new Set();
  function choose(position) {
    if (position >= ordered.length) return true;
    const descriptor = ordered[position];
    for (const source of descriptor.candidates) {
      const key = String(source.id ?? source.protocolIndex);
      if (used.has(key)) continue;
      used.add(key);
      assigned.set(Number(descriptor.logical.index), source);
      if (choose(position + 1)) return true;
      assigned.delete(Number(descriptor.logical.index));
      used.delete(key);
    }
    return false;
  }
  if (!choose(0)) {
    return { ok:false, materialMap:null, review:[], reasons:[{ code:'material_mapping_conflict', text:'No unique AMS/external-spool mapping satisfies all file filament requirements' }] };
  }
  const materialMap = {};
  const review = [];
  for (const logical of logicalTools) {
    const source = assigned.get(Number(logical.index));
    materialMap[String(logical.index)] = Number(source.protocolIndex);
    if (logical.material && !canonicalMaterial(source.material)) review.push({ code:'material_unknown', text:`${source.label} material is unknown for file T${logical.index} (${logical.material})` });
    if (logical.color && !normalizeColor(source.color)) review.push({ code:'color_unknown', text:`${source.label} colour is unknown for file T${logical.index} (${logical.color})` });
  }
  const requestedNozzles = [...new Set(logicalTools.filter((item) => item.nozzleDiameter != null).map((item) => Number(item.nozzleDiameter)).filter(Number.isFinite))];
  if (requestedNozzles.length > 1) {
    return { ok:false, materialMap:null, review:[], reasons:[{ code:'multiple_nozzle_requirements', text:'The file requests different nozzle sizes but the Bambu printer has one nozzle' }] };
  }
  if (requestedNozzles.length === 1) {
    const installed = Number(status.tools?.[0]?.nozzleDiameter);
    if (!Number.isFinite(installed)) review.push({ code:'nozzle_unknown', text:`File requires a ${requestedNozzles[0].toFixed(1)} mm nozzle, but installed nozzle size is not reported` });
    else if (!sameNozzle(requestedNozzles[0], installed)) return { ok:false, materialMap:null, review:[], reasons:[{ code:'nozzle_mismatch', text:`Installed nozzle ${installed.toFixed(1)} mm does not match required ${requestedNozzles[0].toFixed(1)} mm` }] };
  }
  return { ok:review.length === 0, materialMap, reasons:[], review };
}

export function evaluateQueueCompatibility({ job, printer, state, adapter, bedClearanceRequired = false, reserved = false, operationBusy = null } = {}) {
  const incompatible = [];
  const blocked = [];
  const review = [];
  const requirements = job?.requirements || job?.stagedFile?.requirements || {};
  const printerTarget = job?.printerTarget || job?.stagedFile?.printerTarget || null;
  const capabilities = adapter?.capabilities || state?.capabilities || {};
  const limits = adapter?.limits || state?.limits || {};

  if (printerTarget && !printerMatchesTarget(printerTarget, printer, state, adapter)) {
    incompatible.push({
      code:'printer_target_mismatch',
      text:`File is designated for ${printerTarget.model}`
    });
  }

  if (!capabilities.fileUpload || !capabilities.localFiles || !capabilities.printLocalFile) {
    incompatible.push({ code:'missing_file_workflow', text:'Printer does not support verified controller file upload and local print start' });
  }
  const extension = path.extname(String(job?.fileName || '')).toLowerCase();
  const acceptedExtensions = Array.isArray(adapter?.uploadExtensions) ? adapter.uploadExtensions.map((item) => String(item).toLowerCase()) : [];
  if (extension && acceptedExtensions.length && !acceptedExtensions.includes(extension)) {
    incompatible.push({ code:'unsupported_file_type', text:`Printer does not support ${extension} uploads` });
  }

  const requiredTools = Array.isArray(requirements.requiredTools) ? requirements.requiredTools : [];
  const requiredToolCount = Number(requirements.toolCount || requiredTools.length || 0);
  if (capabilities.materialSlotMapping && requiredToolCount > 1 && extension !== '.3mf') {
    incompatible.push({ code:'ams_requires_3mf', text:'Bambu multi-material AMS/AMS Lite jobs require a sliced .3mf project file' });
  }
  if (requiredToolCount > 1 && !capabilities.printToolMapping && !capabilities.materialSlotMapping) {
    incompatible.push({ code:'insufficient_tool_support', text:`File requires ${requiredToolCount} tools` });
  }
  if (!capabilities.materialSlotMapping && Number.isFinite(Number(limits.toolCount)) && requiredToolCount > Number(limits.toolCount)) {
    incompatible.push({ code:'insufficient_tool_count', text:`File requires ${requiredToolCount} tools; printer has ${Number(limits.toolCount)}` });
  }

  let toolMap = null;
  let materialMap = null;
  if (!incompatible.length && capabilities.materialSlotMapping && requiredToolCount) {
    if (requirements.usageReliable === false && requiredToolCount > 1) {
      review.push({ code:'unreliable_material_usage', text:'File filament usage could not be determined reliably for unattended AMS scheduling' });
    } else {
      const mapped = mapLogicalMaterials(requirements, state?.status || {});
      materialMap = mapped.materialMap;
      blocked.push(...mapped.reasons);
      review.push(...mapped.review);
    }
  } else if (!incompatible.length && capabilities.printToolMapping && requiredToolCount) {
    if (requirements.usageReliable === false && requiredToolCount > 1) {
      review.push({ code:'unreliable_tool_usage', text:'File tool usage could not be determined reliably for unattended multi-tool scheduling' });
    } else {
      const mapped = mapLogicalTools(requirements, state?.status || {});
      toolMap = mapped.toolMap;
      blocked.push(...mapped.reasons);
      review.push(...mapped.review);
    }
  } else if (!incompatible.length && requiredToolCount === 1) {
    const required = Array.isArray(requirements.logicalTools) ? requirements.logicalTools[0] : null;
    const physical = Array.isArray(state?.status?.tools) ? state.status.tools[0] : null;
    if (required && physical) {
      if (physical.filament?.present === false) blocked.push({ code:'filament_absent', text:'Filament is not loaded' });
      const requiredMaterial = canonicalMaterial(required.material);
      const currentMaterial = canonicalMaterial(physical.filament?.material);
      if (requiredMaterial && !currentMaterial) {
        review.push({ code:'material_unknown', text:`File requires ${required.material}, but loaded material is not known` });
      } else if (requiredMaterial && currentMaterial && requiredMaterial !== currentMaterial) {
        blocked.push({ code:'material_mismatch', text:`Loaded material ${physical.filament.material} does not match required ${required.material}` });
      }
      if (required.nozzleDiameter != null && !Number.isFinite(Number(physical.nozzleDiameter))) {
        review.push({ code:'nozzle_unknown', text:`File requires a ${Number(required.nozzleDiameter).toFixed(1)} mm nozzle, but installed nozzle size is not reported` });
      } else if (required.nozzleDiameter != null && Number.isFinite(Number(physical.nozzleDiameter)) && !sameNozzle(required.nozzleDiameter, physical.nozzleDiameter)) {
        blocked.push({ code:'nozzle_mismatch', text:`Installed nozzle ${Number(physical.nozzleDiameter).toFixed(1)} mm does not match required ${Number(required.nozzleDiameter).toFixed(1)} mm` });
      }
      const requiredColor = normalizeColor(required.color);
      const currentColor = normalizeColor(physical.filament?.color);
      const requiredFamily = resolveColorFamily({ color:requiredColor, family:required.colorFamily });
      const currentFamily = resolveColorFamily({ color:currentColor, family:physical.filament?.colorFamily });
      if (requiredFamily && currentFamily && requiredFamily !== currentFamily) {
        blocked.push({
          code:'color_mismatch',
          text:`Loaded filament colour family ${currentFamily} does not match required ${requiredFamily}`
        });
      }
    }
  }

  if (!state?.online) blocked.push({ code:'offline', text:state?.error || 'Printer is offline' });
  else if (isBusy(state.status || {})) blocked.push({ code:'busy', text:'Printer is not idle' });
  if (bedClearanceRequired) blocked.push({ code:'bed_not_cleared', text:'Bed not cleared' });
  if (operationBusy) blocked.push({ code:'operation_busy', text:`Printer busy — ${operationBusy.label || 'another operation'} in progress` });
  if (reserved) blocked.push({ code:'reserved', text:'Printer is reserved by another queued job' });

  const category = incompatible.length ? 'incompatible' : blocked.length ? 'blocked' : review.length ? 'needs_review' : 'ready';
  return {
    printerId: printer?.id || state?.id || null,
    printerName: state?.name || printer?.name || printer?.id || state?.id || 'Printer',
    category,
    ready: category === 'ready',
    compatible: !incompatible.length,
    toolMap,
    materialMap,
    reasons: [...incompatible, ...review, ...blocked]
  };
}

export const queueCompatibilityHelpers = { colorDistance, colorFamily, colorsCompatible, isBusy, mapLogicalMaterials, mapLogicalTools, normalizeColor, printerMatchesTarget, resolveColorFamily, sameNozzle };
