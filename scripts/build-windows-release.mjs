import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const version = String(packageInfo.version || '0.0.0-dev');
const portableExe = path.join(projectRoot, 'dist', 'windows-x64', 'PrintFarmController.exe');
const installerExe = path.join(projectRoot, 'dist', 'installer', `PrintFarmController-Setup-v${version}.exe`);

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', script), ...args], {
    cwd:projectRoot,
    stdio:'inherit',
    windowsHide:true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with code ${result.status}`);
}

if (process.platform !== 'win32') throw new Error('The signed Windows release must be built on Windows.');

runNode('build-sea-windows.mjs');
runNode('sign-windows.mjs', [portableExe]);
runNode('build-installer-windows.mjs');
runNode('sign-windows.mjs', [installerExe]);

console.log('');
console.log(`Signed Windows release ready: ${installerExe}`);
