import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { printerStorePath } from './store.js';
import { KeyedSerialExecutor } from './concurrency.js';

const SETTINGS_FILE = path.join(path.dirname(printerStorePath), 'library-pricing.json');
const executor = new KeyedSerialExecutor();
const DEFAULT_SETTINGS = Object.freeze({ profitPercent:null, profitMethod:'markup' });

function round(value, decimals = 4) {
  return Math.round((value + Number.EPSILON) * (10 ** decimals)) / (10 ** decimals);
}

export function normalizeSaleLots(value) {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value === 'boolean' || !Number.isInteger(Number(value))
      || Number(value) < 1 || Number(value) > 999) {
    throw new Error('Sale lots per print must be an integer between 1 and 999');
  }
  return Number(value);
}

export function normalizeSundryCurrency(value) {
  const currency = String(value || 'GBP').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Sundry currency must use a three-letter ISO code');
  return currency;
}

export function normalizeSundryCosts(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new Error('Sundry costs must be a list of at most 30 items');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Each sundry cost must contain a description, quantity and unit cost');
    }
    const label = String(entry.label || '').trim().replace(/\s+/g, ' ');
    if (!label || label.length > 100 || /[<>]/.test(label)) {
      throw new Error('Sundry description must contain 1–100 characters');
    }
    const quantity = Number(entry.quantity);
    if (typeof entry.quantity === 'boolean' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      throw new Error('Sundry quantity must be an integer between 1 and 10000');
    }
    const rawCost=entry.unitCost;
    const unitCost = Number(rawCost);
    if (rawCost === '' || rawCost === null || typeof rawCost === 'boolean'
        || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1000000) {
      throw new Error('Sundry unit cost must be between zero and 1000000');
    }
    if (!Number.isFinite(unitCost * quantity) || unitCost * quantity > 10000000) {
      throw new Error('Total sundry line cost is too high');
    }
    return {label,quantity,unitCost:round(unitCost)};
  });
}

export function normalizePricingSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pricing settings must be an object');
  }
  const method=String(value.profitMethod || 'markup');
  if (method !== 'markup' && method !== 'margin') {
    throw new Error('Profit method must be markup or margin');
  }
  const raw = value.profitPercent;
  const profitPercent = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (profitPercent !== null && (typeof raw === 'boolean' || !Number.isFinite(profitPercent)
      || profitPercent < 0 || profitPercent > 1000 || (method === 'margin' && profitPercent >= 100))) {
    throw new Error('Profit percentage must be non-negative and below 100% for margin pricing');
  }
  return {profitPercent:profitPercent == null ? null : round(profitPercent,2),profitMethod:method};
}

export async function getLibraryPricingSettings() {
  try {
    const json = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    return normalizePricingSettings(json);
  } catch (error) {
    if (error?.code === 'ENOENT') return {...DEFAULT_SETTINGS};
    throw error;
  }
}

export async function saveLibraryPricingSettings(input) {
  return executor.run('pricing', async () => {
    const settings=normalizePricingSettings(input);
    await fs.mkdir(path.dirname(SETTINGS_FILE),{recursive:true,mode:0o700});
    const temp=SETTINGS_FILE+'.'+crypto.randomUUID()+'.tmp';
    try {
      await fs.writeFile(temp,JSON.stringify(settings,null,2)+'\n',{mode:0o600});
      await fs.rename(temp,SETTINGS_FILE);
    } finally {
      await fs.rm(temp,{force:true}).catch(()=>{});
    }
    return settings;
  });
}

/**
 * Estimate only. Does not affect print-queue historical filament cost snapshots.
 * Sundry entries are quantities required PER SLICED PRINT (not per selling lot).
 * Only price a print when the complete filament estimate exists and currencies
 * are consistent; otherwise never silently understate the real cost.
 */
export function estimateLibrarySalePrice(file, settings) {
  const costs=normalizeSundryCosts(file?.sundryCosts);
  const lotsPerPrint=normalizeSaleLots(file?.lotsPerPrint);
  const sundryCurrency=normalizeSundryCurrency(file?.sundryCurrency);
  const options=normalizePricingSettings(settings);
  const sundriesCost=round(costs.reduce((sum,entry)=>sum+entry.quantity*entry.unitCost,0));
  const filament=file?.costEstimate || {};
  const currency=filament.currency || (sundriesCost ? sundryCurrency : null);
  let issue=null;
  if (options.profitPercent === null) issue='Set a global profit percentage to calculate selling prices';
  else if (filament.complete!==true || !Number.isFinite(filament.totalCost) || !filament.currency) {
    issue='Filament cost is unavailable; a complete selling price cannot be calculated';
  } else if (sundriesCost>0 && sundryCurrency!==filament.currency) {
    issue='Sundry currency '+sundryCurrency+' does not match filament currency '+filament.currency;
  }
  const totalCost=issue ? null : round(filament.totalCost + sundriesCost);
  const nominalSale=issue ? null : options.profitMethod==='margin'
    ? totalCost/(1-options.profitPercent/100)
    : totalCost*(1+options.profitPercent/100);
  // A batch of individually sold lots must add up to its quoted total:
  // round each lot to currency cents, then calculate the batch price.
  const sellingPricePerLot=nominalSale===null ? null : round(nominalSale/lotsPerPrint,2);
  const sellingPrice=sellingPricePerLot===null ? null : round(sellingPricePerLot*lotsPerPrint,2);
  return {
    complete:!issue,
    issue,
    currency,
    filamentCost:filament.complete ? filament.totalCost : null,
    sundriesCost,
    totalCost,
    profitPercent:options.profitPercent,
    profitMethod:options.profitMethod,
    lotsPerPrint,
    sellingPrice,
    sellingPricePerLot
  };
}

export const libraryPricingSettingsPath = SETTINGS_FILE;
