import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { printerStorePath } from './store.js';
import { KeyedSerialExecutor } from './concurrency.js';

const SETTINGS_FILE = path.join(path.dirname(printerStorePath), 'library-pricing.json');
const executor = new KeyedSerialExecutor();
export const SUPPORTED_PRICING_CURRENCIES = Object.freeze(['GBP', 'USD', 'EUR', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'HKD', 'SGD', 'INR', 'KRW', 'TWD', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'AED', 'SAR', 'ILS', 'ZAR', 'BRL', 'MXN', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'RUB', 'CLP', 'COP']);
const DEFAULT_SETTINGS = Object.freeze({ profitPercent:null, profitMethod:'markup', taxRate:0, hourlyCostRate:0, labourHourlyRate:null, currency:'GBP' });

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
    // New Labour lines store time only. Never reinterpret legacy Labour
    // quantity/unitCost: existing saved prices must not change silently.
    if (label.toLowerCase()==='labour' && entry.minutes !== undefined) {
      const minutes=Number(entry.minutes);
      if (typeof entry.minutes==='boolean' || entry.minutes === '' || entry.minutes === null
        || !Number.isInteger(minutes) || minutes < 1 || minutes > 10000) {
        throw new Error('Labour minutes must be an integer between 1 and 10000');
      }
      return {label:'Labour',minutes};
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
  // Legacy settings contain no taxRate: a zero default preserves existing
  // quoted prices until an operator explicitly configures the tax rate.
  const rawTax=value.taxRate;
  const taxRate=rawTax === undefined || rawTax === null || rawTax === '' ? 0 : Number(rawTax);
  if (typeof rawTax === 'boolean' || !Number.isFinite(taxRate) || taxRate<0 || taxRate>100) {
    throw new Error('Tax rate must be a percentage between 0 and 100');
  }
  // Earlier saved configurations have no hourly rate. Their sell prices
  // must remain unchanged until the operator opts in to print time costing.
  const rawHourlyCost=value.hourlyCostRate;
  const hourlyCostRate=rawHourlyCost === undefined || rawHourlyCost === null || rawHourlyCost === ''
    ? 0 : Number(rawHourlyCost);
  if (typeof rawHourlyCost === 'boolean' || !Number.isFinite(hourlyCostRate)
      || hourlyCostRate < 0 || hourlyCostRate > 1000000) {
    throw new Error('Hourly print cost rate must be between zero and 1000000');
  }
  // null means no labour rate has been set yet, unlike an explicitly
  // configured zero rate. Older settings files had no such field.
  const rawLabourRate=value.labourHourlyRate;
  const labourHourlyRate=rawLabourRate === undefined || rawLabourRate === null || rawLabourRate === ''
    ? null : Number(rawLabourRate);
  if (labourHourlyRate!==null && (typeof rawLabourRate==='boolean' || !Number.isFinite(labourHourlyRate)
      || labourHourlyRate < 0 || labourHourlyRate > 1000000)) {
    throw new Error('Labour hourly rate must be between zero and 1000000');
  }
  const currency=String(value.currency == null || value.currency === '' ? 'GBP' : value.currency).trim().toUpperCase();
  if (!SUPPORTED_PRICING_CURRENCIES.includes(currency)) {
    throw new Error('Choose a supported currency in Reports & finance Price settings');
  }
  return {profitPercent:profitPercent == null ? null : round(profitPercent,2),
    profitMethod:method,taxRate:round(taxRate,2),hourlyCostRate:round(hourlyCostRate,2),
    labourHourlyRate:labourHourlyRate===null ? null : round(labourHourlyRate,2),currency};
}

// Older versions only configured currency per filament. Preserve a single
// existing catalogue currency as the initial global choice where possible.
// Mixed-currency legacy catalogues cannot be converted without FX rates;
// default to GBP and show the operator a review warning in Price settings.
async function initialLegacyCurrency() {
  try {
    const stored=JSON.parse(await fs.readFile(path.join(path.dirname(SETTINGS_FILE),'filaments.json'),'utf8'));
    const used=new Set((Array.isArray(stored?.filaments) ? stored.filaments : [])
      .map(item=>String(item.currency || '').trim().toUpperCase())
      .filter(code=>SUPPORTED_PRICING_CURRENCIES.includes(code)));
    return used.size===1 ? [...used][0] : DEFAULT_SETTINGS.currency;
  } catch(error) {
    if (error?.code==='ENOENT')return DEFAULT_SETTINGS.currency;
    throw error;
  }
}
export async function getLibraryPricingSettings() {
  let json=null;
  try {
    json=JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
  } catch(error){
    if(error?.code!=='ENOENT')throw error;
  }
  if (json?.currency == null || json.currency === '') {
    const currency=await initialLegacyCurrency();
    return normalizePricingSettings({...json,currency});
  }
  return normalizePricingSettings(json);
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
 * Sundry entries are consumed PER SLICED PRINT (not per selling lot).
 * New Labour entries use whole minutes multiplied by a global labour hourly
 * rate. Legacy Labour quantity/unitCost entries retain their old fixed cost
 * until the user explicitly replaces them with minutes in the file editor.
 * Sundry unit prices and filament costs use the single global pricing
 * currency. No FX conversion is performed when that setting changes:
 * operators must update nominal prices to the chosen currency. Historical
 * print cost snapshots retain their original currency and amounts.
 * Without a complete filament estimate no selling price is assumed.
 * Hourly print costs use the slicer-estimated print duration, in the same
 * currency as the filament estimate. Without a duration, a nonzero hourly
 * rate prevents a complete sell price instead of silently underpricing.
 * Tax applies AFTER markup or target margin, before dividing the inclusive
 * price into sale lots and rounding to the currency's smallest unit.
 */
export function estimateLibrarySalePrice(file, settings) {
  const costs=normalizeSundryCosts(file?.sundryCosts);
  const lotsPerPrint=normalizeSaleLots(file?.lotsPerPrint);
  const options=normalizePricingSettings(settings);
  const needsLabourRate=costs.some(entry=>entry.label==='Labour' && entry.minutes !== undefined);
  const labourCost=options.labourHourlyRate===null && needsLabourRate ? null : round(costs.reduce(
    (sum,entry)=>sum+(entry.label==='Labour' && entry.minutes !== undefined
      ? round(entry.minutes*options.labourHourlyRate/60) : 0),0));
  const sundriesCost=labourCost===null ? null : round(costs.reduce((sum,entry)=>
    sum+(entry.minutes !== undefined ? 0 : entry.quantity*entry.unitCost),0)+labourCost);
  const filament=file?.costEstimate || {};
  const currency=filament.complete===true && filament.currency ? options.currency : null;
  const rawDuration=file?.requirements?.estimatedPrintSeconds;
  const estimatedPrintSeconds=typeof rawDuration==='number' && Number.isFinite(rawDuration)
    && rawDuration>0 && rawDuration<365*86400 ? rawDuration : null;
  const printTimeCost=options.hourlyCostRate===0 ? 0 : estimatedPrintSeconds===null
    ? null : round(estimatedPrintSeconds*options.hourlyCostRate/3600);
  let issue=null;
  if (options.profitPercent === null) issue='Set a global profit percentage to calculate selling prices';
  else if (filament.complete!==true || !Number.isFinite(filament.totalCost) || !filament.currency) {
    issue='Filament cost is unavailable; a complete selling price cannot be calculated';
  } else if (printTimeCost===null) {
    issue='Estimated print time is unavailable; a non-zero hourly cost rate requires a slicer duration';
  } else if (labourCost===null) {
    issue='Set the global labour hourly rate in Reports & finance to price this file\'s labour minutes';
  }
  const totalCost=issue ? null : round(filament.totalCost + sundriesCost + printTimeCost);
  const nominalExTax=issue ? null : options.profitMethod==='margin'
    ? totalCost/(1-options.profitPercent/100)
    : totalCost*(1+options.profitPercent/100);
  const nominalIncTax=nominalExTax===null ? null : nominalExTax*(1+options.taxRate/100);
  // Round the price of EACH individually sold lot so the displayed whole-
  // print total always agrees with lots × the displayed tax-inclusive price.
  // Honour currency minor units (e.g. JPY/KRW have no decimal cents).
  const currencyDigits=currency ? new Intl.NumberFormat('en-GB',{style:'currency',currency})
    .resolvedOptions().maximumFractionDigits : 2;
  const sellingPricePerLot=nominalIncTax===null ? null : round(nominalIncTax/lotsPerPrint,currencyDigits);
  const sellingPrice=sellingPricePerLot===null ? null : round(sellingPricePerLot*lotsPerPrint,currencyDigits);
  const sellingPriceExTaxPerLot=nominalExTax===null ? null : round(nominalExTax/lotsPerPrint,currencyDigits);
  const sellingPriceExTax=sellingPriceExTaxPerLot===null ? null
    : round(sellingPriceExTaxPerLot*lotsPerPrint,currencyDigits);
  const taxAmount=sellingPrice===null || sellingPriceExTax===null ? null
    : round(sellingPrice-sellingPriceExTax,currencyDigits);
  return {
    complete:!issue,
    issue,
    currency,
    filamentCost:filament.complete ? filament.totalCost : null,
    sundriesCost,
    labourCost,
    labourHourlyRate:options.labourHourlyRate,
    hourlyCostRate:options.hourlyCostRate,
    estimatedPrintSeconds,
    printTimeCost,
    totalCost,
    profitPercent:options.profitPercent,
    profitMethod:options.profitMethod,
    taxRate:options.taxRate,
    taxAmount,
    sellingPriceExTax,
    sellingPriceExTaxPerLot,
    lotsPerPrint,
    sellingPrice,
    sellingPricePerLot
  };
}

export const libraryPricingSettingsPath = SETTINGS_FILE;
