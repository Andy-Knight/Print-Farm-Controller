import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// This is a lightweight inventory, not a proof of test validity. A source-based
// test can protect important UI contracts, but it cannot prove runtime behavior.
export function inspectTestSource(source, filename = '') {
  const declarations = [...source.matchAll(/^\s*(?:test|it)(\.(?:skip|todo|only))?\s*\(\s*(['"`])(.+?)\2/gm)].map((match) => ({
    name:match[3],
    mode:match[1] ? match[1].slice(1) : 'normal'
  }));
  const importsImplementation = /(?:from\s*|import\s*\(|require\s*\()\s*['"]\.\.\/(?:src|public|ui|emulator|scripts)\//.test(source);
  const executesExtractedCode = /\brunIn(?:New)?Context\s*\(|\bvm\.runIn(?:New)?Context\s*\(|\bnew\s+Function\s*\(/.test(source);
  const launchesProcessOrServer = /\b(?:spawn|spawnSync|execFile|execFileSync|createServer)\s*\(/.test(source);
  const inspectsFiles = /\b(?:readFile|readFileSync|read)\s*\(/.test(source);
  const runtimeExercise = importsImplementation || executesExtractedCode || launchesProcessOrServer;
  const category = runtimeExercise
    ? (inspectsFiles ? 'mixed' : 'runtime')
    : (inspectsFiles ? 'source-inspection' : 'unclassified');
  const patternAssertions = (source.match(/\bassert\.(?:match|doesNotMatch)\s*\(/g) || []).length;
  const allAssertions = (source.match(/\bassert\.[A-Za-z]+\s*\(/g) || []).length;
  return {
    filename,
    declarations:declarations.length,
    skipped:declarations.filter((item) => item.mode === 'skip').length,
    todo:declarations.filter((item) => item.mode === 'todo').length,
    only:declarations.filter((item) => item.mode === 'only').length,
    category,
    patternAssertions,
    assertions:allAssertions,
    names:declarations.map((item) => item.name)
  };
}

export function listTestFiles(directory) {
  return readdirSync(directory, { withFileTypes:true })
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTestFiles(full);
      return entry.isFile() && /\.test\.[cm]?js$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

export function auditTests(root = projectRoot) {
  const files = listTestFiles(path.join(root, 'test'));
  const entries = files.map((file) => inspectTestSource(
    readFileSync(file, 'utf8'),
    path.relative(root, file).split(path.sep).join('/')
  ));
  const counts = { runtime:0, mixed:0, 'source-inspection':0, unclassified:0 };
  const testsByCategory = { runtime:0, mixed:0, 'source-inspection':0, unclassified:0 };
  const names = new Map();
  for (const entry of entries) {
    counts[entry.category] += 1;
    testsByCategory[entry.category] += entry.declarations;
    for (const name of entry.names) {
      const filesWithName = names.get(name) || [];
      filesWithName.push(entry.filename);
      names.set(name, filesWithName);
    }
  }
  const duplicates = [...names.entries()]
    .filter(([, filenames]) => filenames.length > 1)
    .map(([name, filenames]) => ({ name, filenames }));
  return {
    files:entries.length,
    declarations:entries.reduce((sum, entry) => sum + entry.declarations, 0),
    skipped:entries.reduce((sum, entry) => sum + entry.skipped, 0),
    todo:entries.reduce((sum, entry) => sum + entry.todo, 0),
    only:entries.reduce((sum, entry) => sum + entry.only, 0),
    counts,
    testsByCategory,
    duplicates,
    entries
  };
}

function printSummary(audit) {
  console.log('Print Farm Controller — regression test inventory (heuristic)');
  console.log('Files: ' + audit.files + ', test declarations: ' + audit.declarations);
  console.log('Test files by type: runtime=' + audit.counts.runtime +
    ', mixed=' + audit.counts.mixed +
    ', source-inspection=' + audit.counts['source-inspection'] +
    ', unclassified=' + audit.counts.unclassified);
  console.log('Disabled declarations: skip=' + audit.skipped +
    ', todo=' + audit.todo + ', only=' + audit.only);
  console.log('Repeated test names: ' + audit.duplicates.length);
  console.log('');
  console.log('Files with source-only checks (prioritise for behavioral validation):');
  for (const entry of audit.entries.filter((item) => item.category === 'source-inspection')) {
    console.log('  ' + entry.filename + ' — ' + entry.declarations +
      ' declarations; ' + entry.patternAssertions + ' pattern assertions');
  }
  if (audit.duplicates.length) {
    console.log('');
    console.log('Repeated test descriptions (not necessarily duplicate coverage):');
    for (const duplicate of audit.duplicates) {
      console.log('  ' + duplicate.name + ': ' + duplicate.filenames.join(', '));
    }
  }
  console.log('');
  console.log('Source checks may still be useful contracts. This audit does not prove');
  console.log('behavior, exercise physical printers, or detect semantic redundancy.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = auditTests();
  if (process.argv.includes('--json')) console.log(JSON.stringify(audit, null, 2));
  else printSummary(audit);
  if (audit.only > 0) process.exitCode = 1;
}
