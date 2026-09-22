import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildControllerBundle, buildDir, projectRoot } from './build-controller-bundle.mjs';

const require = createRequire(import.meta.url);
const { inject } = require('postject');

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const outputDir = path.join(projectRoot, 'dist', 'windows-x64');
const executablePath = path.join(outputDir, 'PrintFarmController.exe');
const blobPath = path.join(buildDir, 'sea-prep.blob');
const seaConfigPath = path.join(buildDir, 'sea-config.json');

function requireWindowsX64Node24() {
  if (process.platform !== 'win32') {
    throw new Error('The initial SEA build target is Windows x64. Run this command from 64-bit Windows.');
  }
  if (process.arch !== 'x64') {
    throw new Error(`The initial SEA build target requires x64 Node.js; current architecture is ${process.arch}.`);
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    throw new Error(`Build with Node.js 24.x for the current production baseline; current runtime is ${process.version}.`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd:projectRoot,
    stdio:'inherit',
    windowsHide:true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with code ${result.status}`);
  }
}

async function copyPortableAssets() {
  await fs.cp(path.join(projectRoot, 'public'), path.join(outputDir, 'public'), { recursive:true });
  await fs.cp(path.join(projectRoot, 'emulator', 'public'), path.join(outputDir, 'emulator', 'public'), { recursive:true });
  await fs.cp(path.join(projectRoot, 'emulator', 'assets'), path.join(outputDir, 'emulator', 'assets'), { recursive:true });
  await fs.copyFile(
    path.join(projectRoot, 'src', 'licensing', 'trusted-public-keys.json'),
    path.join(outputDir, 'trusted-public-keys.json')
  );
}

async function buildWindowsSea() {
  requireWindowsX64Node24();
  const { version, bundlePath } = await buildControllerBundle();

  await fs.rm(outputDir, { recursive:true, force:true });
  await fs.mkdir(outputDir, { recursive:true });
  await fs.rm(blobPath, { force:true });

  const seaConfig = {
    main:bundlePath,
    output:blobPath,
    disableExperimentalSEAWarning:true,
    useSnapshot:false,
    useCodeCache:false,
    execArgvExtension:'none'
  };
  await fs.writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`, 'utf8');

  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  await fs.copyFile(process.execPath, executablePath);
  const blob = await fs.readFile(blobPath);
  await inject(executablePath, 'NODE_SEA_BLOB', blob, {
    sentinelFuse:SEA_FUSE
  });

  await copyPortableAssets();
  await fs.writeFile(
    path.join(outputDir, 'BUILD-INFO.txt'),
    [
      `Print Farm Controller v${version}`,
      `Built with Node.js ${process.version}`,
      'Target: Windows x64 portable SEA',
      '',
      'This first packaging stage intentionally keeps browser/emulator assets',
      'and trusted-public-keys.json external to the executable.',
      'The next hardening stage will embed those resources.',
      ''
    ].join('\r\n'),
    'utf8'
  );

  console.log('');
  console.log(`Portable build created: ${executablePath}`);
  console.log('Run PrintFarmController.exe, then open http://localhost:4242');
}

buildWindowsSea().catch((error) => {
  console.error(`SEA build failed: ${error.message}`);
  process.exitCode = 1;
});
