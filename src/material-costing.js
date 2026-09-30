import { canonicalMaterial } from './file-material-metadata.js';
import { getFilament, listFilaments } from './filament-catalogue.js';

function labelFor(entry) {
  return [entry?.brand, entry?.product, entry?.material].filter(Boolean).join(' · ') || null;
}

function assignmentFor(assignments, index) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) return null;
  return assignments[index] || assignments[String(index)] || null;
}

export async function buildMaterialCostSnapshot({
  requirements = null,
  filamentAssignments = null
} = {}, {
  getFilamentFn = getFilament,
  listFilamentsFn = listFilaments,
  capturedAt = new Date().toISOString()
} = {}) {
  const logicalTools = Array.isArray(requirements?.logicalTools) ? requirements.logicalTools : [];
  const catalogue = await listFilamentsFn();
  const tools = [];
  const currencies = new Set();
  let totalGrams = 0;
  let resolvedCost = 0;
  let usageComplete = logicalTools.length > 0;
  let costComplete = logicalTools.length > 0;

  for (const logicalTool of logicalTools) {
    const index = Number(logicalTool?.index);
    if (!Number.isInteger(index) || index < 0) continue;
    const rawGrams = logicalTool?.filamentGrams;
    const gramsValue = rawGrams == null ? null : Number(rawGrams);
    const grams = gramsValue != null && Number.isFinite(gramsValue) && gramsValue >= 0 ? gramsValue : null;
    if (grams == null) usageComplete = false;
    else totalGrams += grams;

    const explicitId = assignmentFor(filamentAssignments, index);
    let entry = explicitId ? await getFilamentFn(explicitId) : null;
    let resolution = explicitId ? 'assigned' : null;
    let issue = null;

    if (explicitId && !entry) {
      issue = 'Assigned filament no longer exists in the catalogue';
    } else if (!entry) {
      const key = canonicalMaterial(logicalTool?.material);
      const matches = key ? catalogue.filter((candidate) => candidate.materialKey === key) : [];
      if (matches.length === 1) {
        entry = matches[0];
        resolution = 'unique-material-match';
      } else if (!key) {
        issue = 'The sliced file does not identify this tool material';
      } else if (!matches.length) {
        issue = `No ${logicalTool.material} filament cost is configured`;
      } else {
        issue = `Multiple ${logicalTool.material} catalogue entries exist; assign one to this file`;
      }
    }

    let cost = null;
    if (entry && grams != null) {
      cost = Math.round((((grams / 1000) * Number(entry.costPerKg)) + Number.EPSILON) * 10000) / 10000;
      resolvedCost += cost;
      currencies.add(entry.currency);
    } else {
      costComplete = false;
    }

    tools.push({
      index,
      material:logicalTool?.material || null,
      colour:logicalTool?.color || null,
      grams,
      filamentId:entry?.id || explicitId || null,
      filamentLabel:entry ? labelFor(entry) : null,
      costPerKg:entry ? Number(entry.costPerKg) : null,
      currency:entry?.currency || null,
      cost,
      resolution,
      issue
    });
  }

  if (currencies.size > 1) costComplete = false;
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const complete = usageComplete && costComplete && tools.length > 0;

  return {
    capturedAt,
    complete,
    usageComplete,
    costComplete,
    totalGrams:Math.round((totalGrams + Number.EPSILON) * 1000) / 1000,
    currency,
    totalCost:complete ? Math.round((resolvedCost + Number.EPSILON) * 10000) / 10000 : null,
    resolvedCost:currency ? Math.round((resolvedCost + Number.EPSILON) * 10000) / 10000 : null,
    tools
  };
}
