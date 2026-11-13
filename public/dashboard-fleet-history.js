export const FLEET_HISTORY_INTERVAL = 5 * 60 * 1000;
export const FLEET_HISTORY_WINDOW = 24 * 60 * 60 * 1000;
export const FLEET_HISTORY_METRICS = ['online', 'printing', 'attention'];

export function dashboardPrinterNeedsAttention(printer, bedClearance) {
  const status = String(printer?.status?.status || '').toLowerCase();
  return !printer?.online || ['error', 'pause', 'paused'].includes(status) || Boolean(bedClearance);
}

export function dashboardTrend(history, metric) {
  if (!history?.samples?.length || !FLEET_HISTORY_METRICS.includes(metric)) return null;
  const firstAt = history.endAt - FLEET_HISTORY_WINDOW;
  const maxCount = Math.max(1, ...history.samples.map(sample => sample.all));
  const paths = [];
  let previousAt = -Infinity;
  for (const sample of history.samples) {
    const x = (2 + (sample.at - firstAt) * 92 / FLEET_HISTORY_WINDOW).toFixed(2);
    const y = (34 - sample[metric] * 30 / maxCount).toFixed(2);
    if (sample.at - previousAt > FLEET_HISTORY_INTERVAL) paths.push([]);
    paths.at(-1).push({x, y});
    previousAt = sample.at;
  }
  const values = history.samples.map(sample => sample[metric]);
  return {
    line:paths.filter(points => points.length > 1)
      .map(points => 'M' + points.map(({x,y}) => x + ',' + y).join('L')).join(' '),
    dots:paths.filter(points => points.length === 1).map(([point]) => point),
    description:`Last 24 hours. Recorded range ${Math.min(...values)} to ${Math.max(...values)}. Latest sample ${Number(values.at(-1))}.`
  };
}
