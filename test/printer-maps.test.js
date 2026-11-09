import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePrinterMaps, printerMapsFile, readPrinterMaps, savePrinterMap } from '../src/printer-maps.js';

test('printer map writes preserve room geometry and enforce placement and revision constraints', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-printer-maps-'));
  t.after(() => fs.rm(dataDir, { recursive:true, force:true }));
  const printerIds = new Set(['a1', 'u1']);
  const save = (input, id) => savePrinterMap(dataDir, { id, input, printerIds });
  assert.deepEqual(await readPrinterMaps(dataDir), { version:1, maps:[] });
  const placement = { printerId:'a1', x:234, y:670 };
  const { maps:[first] } = await save({ name:' Workshop ', placements:[placement] });
  assert.equal(first.name, 'Workshop');
  assert.deepEqual(first.items, []);
  assert.deepEqual([first.columns, first.rows, first.compactPrinters], [50, 50, false]);
  assert.deepEqual((await readPrinterMaps(dataDir)).maps, [first]);
  await fs.writeFile(path.join(dataDir, printerMapsFile), JSON.stringify({
    version:1, maps:[{ id:first.id, name:first.name, revision:first.revision, placements:[{ ...placement, rotation:90 }] }]
  }));
  assert.deepEqual((await readPrinterMaps(dataDir)).maps, [first]);
  await assert.rejects(save({ name:'Workshop', placements:[] }), { statusCode:409 });
  await assert.rejects(save({ name:'Upstairs', placements:[placement] }), { statusCode:409 });
  await assert.rejects(save({ name:'Upstairs', placements:[{ ...placement, x:1001 }] }), { statusCode:400 });
  await assert.rejects(save({ name:'Upstairs', placements:[null] }), { statusCode:400 });
  const moved = { ...placement, x:1000, y:0 };
  const { maps:[updated] } = await save({ ...first, placements:[moved] }, first.id);
  assert.deepEqual(updated.placements, [moved]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, printerMapsFile), 'utf8')).maps, [updated]);
  await assert.rejects(save(first, first.id), { statusCode:409 });
  assert.deepEqual((await readPrinterMaps(dataDir)).maps, [updated]);
  printerIds.delete('a1');
  const { maps:[pruned] } = await save(updated, updated.id);
  assert.deepEqual(pruned.placements, []);
  await assert.rejects(save({ name:'Upstairs', placements:[placement] }), { statusCode:409 });
});

test('existing maps omit retired aisles and new layouts cannot add them', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-map-aisles-'));
  t.after(() => fs.rm(dataDir, { recursive:true, force:true }));
  const aisle = { id:'aisle', type:'aisle', label:'Walkway', x:20, y:40, width:180, height:40 };
  const shelf = { id:'shelf', type:'shelf', label:'', x:20, y:100, width:180, height:60 };
  const placement = { printerId:'a1', x:200, y:100 };
  const room = { id:'workshop', name:'Workshop', revision:1, placements:[placement], items:[aisle, shelf] };
  const displayToken = 'a'.repeat(43);
  const file = path.join(dataDir, printerMapsFile);
  await fs.writeFile(file, JSON.stringify({ version:1, maps:[{ ...room, displayToken }] }));

  const { maps:[read] } = await readPrinterMaps(dataDir, { includeDisplayLinks:true });
  assert.deepEqual(read.items, [shelf]);
  assert.deepEqual(read.placements, [placement]);
  assert.equal(read.displayToken, displayToken);
  const save = input => savePrinterMap(dataDir, { id:room.id, input, printerIds:new Set(['a1']) });
  await assert.rejects(save(room), { statusCode:400 });
  await save(read);
  const { maps:[stored] } = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(stored.items, [shelf]);
  assert.equal(stored.displayToken, displayToken);
});

test('room items round-trip, remain map-scoped and reject invalid geometry', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-room-items-'));
  t.after(() => fs.rm(dataDir, { recursive:true, force:true }));
  const save = (input, id) => savePrinterMap(dataDir, { id, input, printerIds:new Set() });
  const item = { id:'bench-1', type:'bench', label:'Finishing', x:50, y:80, width:300, height:120 };
  const objects = ['plant-pot', 'window', 'chair', 'stool', 'computer', 'controller', 'shelf', 'bin'].map((type, index) => ({
    id:type, type, label:`Fixture ${index + 1}`, x:50 + index * 100, y:260, width:80, height:80,
    ...(type === 'chair' ? { rotation:90, height:60 } : type === 'computer' ? { rotation:270, width:60 } : {}),
    ...(type === 'stool' ? { width:60, height:60 } : {})
  }));
  const floor = { id:'floor', type:'floor', label:'Workshop floor', x:0, y:0, width:1000, height:1000 };
  const items = [item, ...objects, floor];
  const room = { name:'Main room', placements:[], items };
  const { maps:[first] } = await save(room);
  assert.deepEqual(first.items, items);
  await save({ ...room, name:'Second room' });
  assert.deepEqual((await readPrinterMaps(dataDir)).maps.map(map => map.items), [items, items]);
  const { maps:[renamed] } = await save({ name:'New name', revision:first.revision, placements:[] }, first.id);
  assert.deepEqual(renamed.items, items);
  await assert.rejects(save({ ...room, items:[item, item] }), { statusCode:400 });
  await assert.rejects(save({ ...room, items:[{ ...item, width:980 }] }), { statusCode:400 });
  await assert.rejects(save({ ...room, items:[{ ...item, type:'unknown' }] }), { statusCode:400 });
  await assert.rejects(save({ ...room, items:[{ ...objects[2], rotation:45 }] }), { statusCode:400 });
  const { maps:[cleared] } = await save({ ...renamed, items:[] }, renamed.id);
  assert.deepEqual(cleared.items, []);
  const roomSized = { ...item, x:0, y:0, width:1000, height:1000 };
  const { maps:[fullRoom] } = await save({ ...cleared, columns:75, rows:60, compactPrinters:true, items:[roomSized] }, cleared.id);
  assert.deepEqual(fullRoom.items, [roomSized]);
  assert.deepEqual((await readPrinterMaps(dataDir)).maps[0].items, [roomSized]);
  const { maps:[legacyEdit] } = await save({ name:'Legacy edit', revision:fullRoom.revision, placements:[] }, cleared.id);
  assert.deepEqual([legacyEdit.columns, legacyEdit.rows, legacyEdit.compactPrinters], [75, 60, true]);
  await assert.rejects(save({ ...legacyEdit, columns:49 }, cleared.id), { statusCode:400 });
  await assert.rejects(save({ ...legacyEdit, rows:201 }, cleared.id), { statusCode:400 });
});

test('seating uses fixed rotated footprints and keeps legacy seats inside the room', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-map-seating-'));
  t.after(() => fs.rm(dataDir, { recursive:true, force:true }));
  const chair = { id:'chair', type:'chair', x:40, y:40, width:20, height:20, rotation:90 };
  const stool = { id:'stool', type:'stool', x:0, y:0, width:80, height:100 };
  const room = { name:'Seating', columns:5, rows:5, placements:[], items:[chair, stool] };
  const { maps:[saved] } = await savePrinterMap(dataDir, { input:room, printerIds:new Set() });
  assert.deepEqual(saved.items.map(({ x, y, width, height }) => [x, y, width, height]),
    [[20, 40, 80, 60], [0, 0, 60, 60]]);
  const tiny = { ...room, columns:3, rows:3, items:[chair] };
  await assert.rejects(savePrinterMap(dataDir, { input:tiny, printerIds:new Set() }), /too small/);
  const { maps:[legacy] } = normalizePrinterMaps({ version:1, maps:[{ ...tiny, id:'old', revision:1 }] });
  assert.deepEqual([legacy.columns, legacy.rows], [4, 3]);
  assert.deepEqual(legacy.items[0], { ...chair, label:'', x:0, y:0, width:80, height:60 });
});

test('legacy computers keep their keyboard edge aligned as their footprint shrinks', () => {
  const sizes = [[70, 90, 80, 60], [50, 70, 60, 80], [70, 50, 80, 60], [90, 70, 60, 80]];
  const items = [0, 90, 180, 270].map(rotation => ({
    id:`computer-${rotation}`, type:'computer', x:50, y:50, rotation,
    width:rotation % 180 ? 100 : 120, height:rotation % 180 ? 120 : 100
  }));
  const normalized = normalizePrinterMaps({ version:1, maps:[
    { id:'room', name:'Workshop', revision:1, placements:[], items }
  ] });
  assert.deepEqual(normalized.maps[0].items.map(({ x, y, width, height }) => [x, y, width, height]), sizes);
  assert.deepEqual(normalizePrinterMaps(normalized), normalized);
});

test('doors preserve legacy orientation and save an explicit swing direction and hinge', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-map-doors-'));
  t.after(() => fs.rm(dataDir, { recursive:true, force:true }));
  const door = { id:'door-1', type:'door', label:'Entrance', x:50, y:80, width:80, height:120 };
  await fs.writeFile(path.join(dataDir, printerMapsFile), JSON.stringify({
    version:1, maps:[{ id:'room-1', name:'Workshop', placements:[], revision:1, items:[door] }]
  }));
  const { maps:[room] } = await readPrinterMaps(dataDir);
  assert.deepEqual(room.items, [{ ...door, rotation:90, mirrored:false }]);
  const adjusted = { ...door, rotation:270, mirrored:true };
  const save = item => savePrinterMap(dataDir, {
    id:room.id, input:{ ...room, items:[item] }, printerIds:new Set()
  });
  await assert.rejects(save({ ...adjusted, rotation:45 }), { statusCode:400 });
  await assert.rejects(save({ ...adjusted, mirrored:'true' }), { statusCode:400 });
  await save(adjusted);
  assert.deepEqual((await readPrinterMaps(dataDir)).maps[0].items, [adjusted]);
});

test('wall and line thickness normalize to two steps, including legacy items at room edges', () => {
  const room = { id:'room-1', name:'Workshop', placements:[], revision:1, items:[
    { id:'wall', type:'wall', x:40, y:980, width:120, height:20 },
    { id:'line', type:'line', axis:'vertical', x:180, y:40, width:100, height:100 }
  ] };
  const { maps:[normalized] } = normalizePrinterMaps({ version:1, maps:[room] });
  assert.deepEqual(normalized.items, [
    { ...room.items[0], label:'', axis:'horizontal', y:960, height:40 },
    { ...room.items[1], label:'', width:40 }
  ]);
});
