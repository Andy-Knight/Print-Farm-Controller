import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEventBridge } from '../src/alert-event-bridge.js';

class FakeFleetState {
  constructor(printers) {
    this.printers = structuredClone(printers);
    this.listeners = new Set();
  }

  getFleet() {
    return structuredClone(this.printers);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(printers) {
    this.printers = structuredClone(printers);
    for (const listener of this.listeners) listener(this.getFleet());
  }
}

test('alert event bridge emits only live offline and maintenance transitions', async () => {
  const fleet = new FakeFleetState([
    { id:'p1', name:'Printer 1', online:true, adapterType:'snapmaker-u1', model:'U1' }
  ]);
  let maintenance = 'current';
  const emitted = [];
  const bridge = new AlertEventBridge({
    fleetState:fleet,
    alertService:{
      async emit(alert) {
        emitted.push(structuredClone(alert));
        return { alert, duplicate:false };
      }
    },
    maintenanceService:{
      getPrinterStatus() {
        return { state:maintenance };
      }
    }
  });

  await bridge.start();
  assert.equal(emitted.length, 0);

  fleet.publish([
    { id:'p1', name:'Printer 1', online:false, adapterType:'snapmaker-u1', model:'U1' }
  ]);
  await bridge.observationChain;
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'printer.offline');

  fleet.publish([
    { id:'p1', name:'Printer 1', online:false, adapterType:'snapmaker-u1', model:'U1' }
  ]);
  await bridge.observationChain;
  assert.equal(emitted.length, 1);

  maintenance = 'due_soon';
  fleet.publish([
    { id:'p1', name:'Printer 1', online:false, adapterType:'snapmaker-u1', model:'U1' }
  ]);
  await bridge.observationChain;
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].type, 'maintenance.due_soon');

  maintenance = 'due';
  fleet.publish([
    { id:'p1', name:'Printer 1', online:false, adapterType:'snapmaker-u1', model:'U1' }
  ]);
  await bridge.observationChain;
  assert.equal(emitted.length, 3);
  assert.equal(emitted[2].type, 'maintenance.due');

  await bridge.stop();
});
