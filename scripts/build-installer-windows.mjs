import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const version = String(packageInfo.version || '0.0.0-dev');
const scriptPath = path.join(projectRoot, 'installer', 'windows', 'PrintFarmController.iss');
const portableExe = path.join(projectRoot, 'dist', 'windows-x64', 'PrintFarmController.exe');
const outputInstaller = path.join(projectRoot, 'dist', 'installer', `PrintFarmController-Setup-v${version}.exe`);

async function existingFile(candidate) {
  if (!candidate) return null;
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function findInnoCompiler() {
  const candidates = [
    process.env.INNO_SETUP_COMPILER,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe')
  ];

  for (const candidate of candidates) {
    const found = await existingFile(candidate);
    if (found) return found;
  }

  const where = spawnSync('where.exe', ['ISCC.exe'], { encoding:'utf8', windowsHide:true });
  if (where.status === 0) {
    const first = String(where.stdout || '').split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    const found = await existingFile(first);
    if (found) return found;
  }

  throw new Error(
    'Inno Setup 6 compiler (ISCC.exe) was not found. Install Inno Setup 6 or set INNO_SETUP_COMPILER to the full ISCC.exe path.'
  );
}

if (process.platform !== 'win32') {
  throw new Error('The Windows installer must be built on Windows.');
}

await fs.access(portableExe).catch(() => {
  throw new Error('PrintFarmController.exe was not found. Run npm run build:sea:windows first.');
});

const compiler = await findInnoCompiler();
await fs.mkdir(path.dirname(outputInstaller), { recursive:true });

const result = spawnSync(compiler, [`/DMyAppVersion=${version}`, scriptPath], {
  cwd:projectRoot,
  stdio:'inherit',
  windowsHide:true
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Inno Setup exited with code ${result.status}`);

await fs.access(outputInstaller).catch(() => {
  throw new Error(`Installer build completed but expected output was not found: ${outputInstaller}`);
});

console.log('');
console.log(`Windows installer created: ${outputInstaller}`);
console.log('The installer keeps program files protected and grants standard users modify access only to the data directory.');
