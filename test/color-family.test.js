import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_FAMILY_OPTIONS,
  colorDistance,
  colorFamily,
  colorMatchScore,
  colorsCompatible,
  normalizeColor,
  normalizeColorFamily,
  representativeColor,
  resolveColorFamily
} from '../src/color-family.js';

test('colour family catalogue exposes the supported manual designation choices', () => {
  assert.deepEqual(
    COLOR_FAMILY_OPTIONS.map((item) => item.value),
    ['black','white','grey','red','orange','yellow','green','cyan','blue','purple','pink','brown']
  );
  assert.equal(representativeColor('red'), '#FF0000');
  assert.equal(normalizeColorFamily(' Red '), 'red');
  assert.equal(normalizeColorFamily('chartreuse'), null);
});

test('colour family classifier groups shade variants but keeps neighbouring families distinct', () => {
  assert.equal(colorFamily('#FF0000'), 'red');
  assert.equal(colorFamily('#D91E18'), 'red');
  assert.equal(colorFamily('#A80000'), 'red');
  assert.equal(colorFamily('#FF5050'), 'red');
  assert.equal(colorFamily('#FF6600'), 'orange');
  assert.equal(colorFamily('#FFC0CB'), 'pink');
  assert.equal(colorFamily('#0000FF'), 'blue');
  assert.equal(colorFamily('#111111'), 'black');
  assert.equal(colorFamily('#FFFFFF'), 'white');
  assert.equal(colorFamily('#808080'), 'grey');
});

test('explicit manual family works even when no exact shade is stored', () => {
  assert.equal(resolveColorFamily({ color:null, family:'red' }), 'red');
  assert.equal(colorsCompatible('#FF0000', null, { currentFamily:'red' }), true);
  assert.equal(colorsCompatible('#FF0000', null, { currentFamily:'blue' }), false);
  assert.equal(colorMatchScore('#FF0000', null, { currentFamily:'red' }), 0);
});

test('exact shades are retained for perceptual preference inside a compatible family', () => {
  assert.equal(normalizeColor('#ff0000'), '#FF0000');
  assert.ok(colorDistance('#FF0000', '#F02020') < colorDistance('#FF0000', '#A80000'));
  assert.ok(colorMatchScore('#FF0000', '#F02020') < colorMatchScore('#FF0000', '#A80000'));
  assert.equal(colorMatchScore('#FF0000', '#0000FF'), Number.POSITIVE_INFINITY);
});
