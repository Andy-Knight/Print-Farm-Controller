import test from 'node:test';
import assert from 'node:assert/strict';
import { printerMapTiles } from '../public/printer-map-status.js';
import { computerSeat, createWalkspace } from '../public/printer-map-walkspace.js';

test('map tiles expose the latest successful queued or directly observed completion per printer', () => {
  const printers = ['queued', 'manual', 'failed'].map(id => ({ id, name:id, online:true }));
  const queue = {
    jobs:[
      { printerId:'queued', status:'completed', finishedAt:'2026-11-07T10:00:00Z' },
      { printerId:'queued', status:'completed', finishedAt:'2026-11-07T10:10:00Z' },
      { printerId:'queued', status:'cancelled', finishedAt:'2026-11-07T10:20:00Z' }
    ],
    bedClearance:[
      { printerId:'manual', jobStatus:'completed', finishedAt:'2026-11-07T10:30:00Z' },
      { printerId:'failed', jobStatus:'failed', finishedAt:'2026-11-07T10:40:00Z' }
    ]
  };
  assert.deepEqual(printerMapTiles(printers, queue, []).map(tile => tile.completedAt), [
    Date.parse('2026-11-07T10:10:00Z'), Date.parse('2026-11-07T10:30:00Z'), null
  ]);
});

test('a route crosses a wall at the doorway and can reach the exit threshold', () => {
  const printer = { x:160, y:20, width:30, height:30 };
  const floor = { type:'floor', x:0, y:0, width:220, height:160 };
  const wall = { vertical:true, centre:100, from:0, to:160 };
  const door = { vertical:true, centre:100, start:50, end:110 };
  const room = { width:220, height:160, step:20, items:[floor], printers:[printer], walls:[wall] };
  const start = { x:25, y:25 };
  const closed = createWalkspace({ ...room, doors:[] });
  assert.equal(closed.route(start, closed.approaches(printer)), null);
  const open = createWalkspace({ ...room, doors:[door] });
  assert.ok(open.route(start, open.approaches(printer))?.length > 2);
  const approach = open.doorApproaches(door)[0];
  assert.ok(open.route(start, [approach.id]));
  assert.deepEqual(approach.threshold, { x:100, y:80 });
  assert.deepEqual(approach.outside, { x:120, y:80 });
});

test('a door at the map edge is approached from inside the room', () => {
  const door = { vertical:true, centre:20, start:20, end:80 };
  const room = { width:200, height:160, step:20, printers:[], walls:[], doors:[door] };
  const open = createWalkspace({ ...room, items:[] });
  assert.deepEqual(open.doorApproaches(door).map(approach => approach.outside), [{ x:0, y:50 }]);
  const blocked = createWalkspace({ ...room, items:[{ type:'computer', x:40, y:20, width:80, height:60 }] });
  assert.deepEqual(blocked.doorApproaches(door), []);
});

test('a route leaves space for the character to walk past a rack', () => {
  const rack = { type:'rack', x:80, y:40, width:100, height:80 };
  const room = { width:260, height:200, step:20, items:[rack], printers:[], walls:[], doors:[] };
  const space = createWalkspace(room);
  const start = { x:35, y:125 };
  const end = { x:225, y:125 };
  const route = space.route(start, [space.cellAt(end.x, end.y)]);
  assert.deepEqual(route[0], start);
  assert.deepEqual(route.at(-1), end);
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1], route[i]];
    assert.ok(Math.max(a.x, b.x) <= 55 || Math.min(a.x, b.x) >= 205
      || Math.max(a.y, b.y) <= 15 || Math.min(a.y, b.y) >= 145);
  }
});

test('a printer can be approached near its edge when the centre of its bench is obstructed', () => {
  const printer = { x:280, y:140, width:100, height:160 };
  const rack = { type:'rack', x:260, y:0, width:140, height:360 };
  const bench = { type:'bench', x:40, y:190, width:220, height:170 };
  const walls = [{ vertical:true, centre:420, from:0, to:360 }, { vertical:false, centre:350, from:0, to:420 }];
  const space = createWalkspace({
    width:440, height:360, step:20, items:[rack, bench], printers:[printer], walls, doors:[]
  });
  const route = space.route({ x:105, y:155 }, space.approaches(printer));
  assert.deepEqual(route.at(-1), { x:235, y:145 });
});

test('shelf drop-off uses an adjacent cell on the reachable side of the room', () => {
  const shelf = { type:'shelf', x:120, y:40, width:60, height:40 };
  const wall = { vertical:true, centre:100, from:0, to:160 };
  const room = { width:220, height:160, step:20, items:[shelf], printers:[], walls:[wall] };
  const start = { x:45, y:55 };
  const closed = createWalkspace({ ...room, doors:[] });
  assert.equal(closed.route(start, closed.approaches(shelf, [0, 1], 10)), null);
  const open = createWalkspace({ ...room, doors:[{ vertical:true, centre:100, start:80, end:140 }] });
  assert.ok(open.route(start, open.approaches(shelf, [0, 1], 10)));
});

test('seat matching selects the nearest chair or stool in front of a rotated computer', () => {
  const computer = { x:120, y:100, width:100, height:120, rotation:90 };
  const stool = { type:'stool', x:60, y:140, width:40, height:40 };
  const chair = { type:'chair', x:10, y:140, width:40, height:40 };
  const behind = { type:'chair', x:220, y:140, width:40, height:40 };
  const beside = { type:'chair', x:70, y:240, width:40, height:40 };
  assert.equal(computerSeat(computer, [behind, beside, chair, stool], 20), stool);
  assert.equal(computerSeat(computer, [behind, beside], 20), null);
});

test('a chair in front of a computer set back on a bench is matched by the gap between their edges', () => {
  const computer = { x:120, y:260, width:120, height:100, rotation:180 };
  const chair = { type:'chair', x:140, y:100, width:80, height:100 };
  const distant = { ...chair, y:70 };
  assert.equal(computerSeat(computer, [distant, chair], 20), chair);
  assert.equal(computerSeat(computer, [distant], 20), null);
});
