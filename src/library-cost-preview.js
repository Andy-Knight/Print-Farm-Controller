import { listFilaments } from './filament-catalogue.js';
import { buildMaterialCostSnapshot } from './material-costing.js';
import { getLibraryPricingSettings } from './library-pricing.js';

/**
 * Current catalogue estimate for a library file, NOT a historical print cost.
 * Queue jobs snapshot their own cost on start and must never be overwritten.
 * Read the catalogue once for the complete listing, even with many files.
 */
export async function estimateLibraryFileCosts(files, {
  listFilamentsFn = listFilaments,
  costSnapshotFn = buildMaterialCostSnapshot
} = {}) {
  const entries = await listFilamentsFn();
  const {currency:pricingCurrency}=await getLibraryPricingSettings();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return Promise.all(files.map(async (file) => {
    const snapshot = await costSnapshotFn({
      requirements:file.requirements,
      filamentAssignments:file.filamentAssignments
    }, {
      listFilamentsFn:async () => entries,
      getFilamentFn:async (id) => byId.get(id) || null,
      pricingCurrency
    });
    const complete = snapshot.complete === true
      && Boolean(snapshot.currency)
      && typeof snapshot.totalCost === 'number'
      && Number.isFinite(snapshot.totalCost)
      && snapshot.totalCost >= 0;
    const problems = [...new Set((snapshot.tools || []).map((tool) => tool.issue).filter(Boolean))];
    if (!snapshot.usageComplete) problems.unshift('Sliced filament weight is unavailable for one or more tools');
    if (!snapshot.costComplete && !problems.length) {
      problems.push(snapshot.currency === null && (snapshot.tools || []).some((tool) => tool.currency)
        ? 'Assigned filaments use different currencies'
        : 'Filament prices are not available for every tool');
    }
    if (!(snapshot.tools || []).length) problems.push('No usable sliced filament metadata is available');
    return {
      ...file,
      costEstimate: {
        complete,
        totalCost:complete ? snapshot.totalCost : null,
        currency:complete ? snapshot.currency : null,
        grams:snapshot.usageComplete && Number.isFinite(snapshot.totalGrams)
          ? snapshot.totalGrams : null,
        issue:complete ? null : (problems.join('; ') || 'Filament costing is unavailable')
      }
    };
  }));
}
