import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const auth=read('public/auth-gate.js');
const app=read('public/app.js');
const reporting=read('public/reporting.js');
const preact=read('ui/reporting.jsx');
const css=read('public/auth.css');
const html=read('public/index.html');

test('operator and viewer interfaces hide library deletion, queue history purge and global filament writes',()=>{
  assert.match(auth,/\['#clearQueueHistoryBtn','#libraryDeleteSelectedBtn','#filamentForm'\]/);
  assert.match(auth,/session\.user\.role==='administrator'/);
  assert.match(app,/function canPurgeFarmRecords\(/);
  assert.match(app,/libraryDeleteSelectedBtn\.hidden = !canPurgeFarmRecords\(\)/);
  assert.match(app,/clearQueueHistoryBtn\.hidden = !canPurgeFarmRecords\(\)/);
  assert.match(app,/libraryActionBusy \|\| !canPurgeFarmRecords\(\)/);
  assert.match(reporting,/const canManageFilamentCatalogue =/);
  assert.match(reporting,/filamentForm\.hidden = !canManageFilamentCatalogue\(\)/);
  assert.match(reporting,/canManageFilaments:canManageFilamentCatalogue\(\)/);
  assert.match(reporting,/if \(!canManageFilamentCatalogue\(\)\) return;/);
  assert.match(preact,/\{canManage && <div class="mini-actions">/);
  assert.match(preact,/canManage=\{state\.canManageFilaments\}/);
  assert.match(html,/id="filamentReadOnlyHelp"/);
  assert.match(reporting,/readOnlyHelp.hidden=canManageFilamentCatalogue\(\)/);
  assert.match(css,/#filamentForm\[hidden\]/);
  assert.match(css,/#libraryDeleteSelectedBtn\[hidden\]/);
  assert.match(css,/#clearQueueHistoryBtn\[hidden\]/);
});

test('shared filament catalogue stays readable while operator printer assignments remain available',()=>{
  assert.match(reporting,/filaments:reportingFilamentsViewModel\(\)/);
  assert.match(preact,/<FilamentCatalogue items=\{state\.filaments\}/);
  assert.match(app,/data-material-designation-save/);
  assert.match(app,/data-u1-filament-config-save/);
});
