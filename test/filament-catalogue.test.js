import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('filament catalogue persists costs and supports update/removal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-filament-catalogue-'));
  process.env.DATA_DIR = dir;
  const moduleUrl = pathToFileURL(path.resolve('src/filament-catalogue.js'));
  moduleUrl.searchParams.set('case', String(Date.now()));
  const catalogue = await import(moduleUrl.href);

  try {
    const pla = await catalogue.createFilament({
      material:'PLA',
      brand:'Example',
      product:'Matte PLA',
      colour:'Black',
      costPerKg:18.95,
      currency:'gbp'
    });
    assert.equal(pla.materialKey, 'PLA');
    assert.equal(pla.currency, 'GBP');
    assert.equal(pla.costPerKg, 18.95);

    const petg = await catalogue.createFilament({
      material:'PETG',
      costPerKg:21,
      currency:'GBP'
    });
    assert.equal((await catalogue.listFilaments()).length, 2);
    assert.equal((await catalogue.getFilament(pla.id)).brand, 'Example');

    const updated = await catalogue.updateFilament(pla.id, { costPerKg:19.5, product:'PLA Pro' });
    assert.equal(updated.costPerKg, 19.5);
    assert.equal(updated.product, 'PLA Pro');
    assert.equal(updated.createdAt, pla.createdAt);
    assert.ok(updated.updatedAt);

    assert.equal(await catalogue.removeFilament(petg.id), true);
    assert.equal((await catalogue.listFilaments()).length, 1);

    const persisted = JSON.parse(await fs.readFile(path.join(dir, 'filaments.json'), 'utf8'));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.filaments[0].id, pla.id);
  } finally {
    delete process.env.DATA_DIR;
    await fs.rm(dir, { recursive:true, force:true });
  }
});
