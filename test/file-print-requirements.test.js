import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGcodePrintRequirements } from '../src/file-print-requirements.js';

test('G-code requirements retain per-tool filament grams and total usage', () => {
  const parsed = parseGcodePrintRequirements([
    '; filament_type = PLA; PETG',
    '; filament_colour = #FF0000; #0000FF',
    '; nozzle_diameter = 0.4; 0.4',
    '; filament used [g] = 12.5; 3.25',
    'T0',
    'G1 X10',
    'T1',
    'G1 X20'
  ].join('\n'));

  assert.equal(parsed.logicalTools.length, 2);
  assert.equal(parsed.logicalTools[0].filamentGrams, 12.5);
  assert.equal(parsed.logicalTools[1].filamentGrams, 3.25);
  assert.equal(parsed.totalFilamentGrams, 15.75);
});

test('missing filament gram metadata remains unknown rather than zero', () => {
  const parsed = parseGcodePrintRequirements([
    '; filament_type = PLA',
    '; nozzle_diameter = 0.4',
    'T0',
    'G1 X10'
  ].join('\n'));

  assert.equal(parsed.logicalTools[0].filamentGrams, null);
  assert.equal(parsed.totalFilamentGrams, 0);
});
