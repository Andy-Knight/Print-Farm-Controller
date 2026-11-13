import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FleetHistory } from '../src/fleet-history.js';
import {
  dashboardTrend, FLEET_HISTORY_INTERVAL as interval, FLEET_HISTORY_WINDOW as day
} from '../public/dashboard-fleet-history.js';

test('fleet history samples completed polls, preserves gaps on restart and scopes counts to group members', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-fleet-history-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  let now = 2 * day;
  const printers = [
    {id:'a', online:true, lastSeen:'observed', status:{status:'printing'}},
    {id:'b', online:true, lastSeen:'observed', status:{status:'heating'}, chamberPreheat:{active:true}},
    {id:'c', online:false, consecutiveFailures:1},
    {id:'d', online:false}
  ];
  const options = {
    filePath:path.join(dir, 'history.json'),
    getPrinters:() => printers,
    getBedClearance:() => [{printerId:'b'}],
    now:() => now
  };
  const history = new FleetHistory(options);
  await history.record();
  assert.deepEqual(history.getHistory().samples, []);
  printers.pop();
  await history.record();
  await history.record();
  assert.deepEqual(history.getHistory().samples, [
    {at:now, all:3, online:2, printing:1, attention:2}
  ]);
  now += 2 * interval;
  printers[0].status = {status:'paused'};
  const restarted = new FleetHistory(options);
  await restarted.start();
  await restarted.stop();
  assert.deepEqual(restarted.getHistory(['a', 'b']).samples, [
    {at:now - 2 * interval, all:2, online:2, printing:1, attention:1},
    {at:now, all:2, online:2, printing:0, attention:2}
  ]);
  assert.equal(restarted.getHistory([]).samples.at(-1).all, 0);
  now += day;
  assert.deepEqual(restarted.getHistory().samples, []);
  await restarted.record();
  const stored = JSON.parse(await fs.readFile(options.filePath, 'utf8'));
  assert.deepEqual(stored.samples.map(sample => sample.at), [now]);
});

test('sparklines plot zeroes, leave gaps and retain individual observations', () => {
  const endAt = 2 * day;
  const samples = [
    {at:endAt - 4 * interval, all:4, printing:0},
    {at:endAt - 3 * interval, all:4, printing:2},
    {at:endAt, all:4, printing:1}
  ];
  const chart = dashboardTrend({endAt, samples}, 'printing');
  assert.match(chart.line, /^M[\d.]+,34\.00L[\d.]+,19\.00$/);
  assert.deepEqual(chart.dots, [{x:'94.00',y:'26.50'}]);
  assert.equal(dashboardTrend({endAt,samples:[]}, 'printing'), null);
  assert.equal(dashboardTrend({endAt,samples}, 'all'), null);
});
