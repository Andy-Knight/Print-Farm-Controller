import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(await fs.readFile(path.join(root, 'scripts/ffmpeg-source.json'), 'utf8'));

export function ffmpegBundleDir(target) {
  if (!['windows-x64','linux-x64','linux-arm64'].includes(target)) throw new Error('Unsupported FFmpeg build target');
  return path.join(root, 'build', 'ffmpeg', target);
}

export function verifyDecoderArchitecture(binary, target) {
  if (target === 'windows-x64') {
    if (binary.length < 64 || binary.toString('ascii',0,2) !== 'MZ') return false;
    const pe = binary.readUInt32LE(60);
    return pe + 6 <= binary.length && binary.toString('ascii',pe,pe+4) === 'PE\0\0'
      && binary.readUInt16LE(pe+4) === 0x8664;
  }
  return binary.length >= 20 && binary.subarray(0,6).equals(Buffer.from([0x7f,69,76,70,2,1]))
    && binary.readUInt16LE(18) === (target === 'linux-arm64' ? 183 : 62);
}

export async function validateFfmpegBundle(directory, target) {
  const metadata = path.join(directory, 'share', 'ffmpeg');
  const manifest = JSON.parse(await fs.readFile(path.join(metadata, 'manifest.json'), 'utf8'));
  const binary = target === 'windows-x64' ? 'ffmpeg.exe' : 'ffmpeg';
  if (manifest.version !== pin.version || manifest.sha256 !== pin.sha256 || manifest.url !== pin.url
    || manifest.binary !== binary || manifest.target !== (target === 'windows-x64' ? target : 'linux')) {
    throw new Error('FFmpeg bundle does not match the pinned source/target');
  }
  const digest = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  if (!verifyDecoderArchitecture(await fs.readFile(path.join(directory,'bin',binary)),target)) {
    throw new Error('FFmpeg executable architecture does not match the bundle target');
  }
  if (await digest(path.join(root,'scripts','ffmpeg-build.sh')) !== manifest.recipeSha256
    || await digest(path.join(metadata,'ffmpeg-build.sh')) !== manifest.recipeSha256) {
    throw new Error('FFmpeg bundle build recipe is outdated or modified');
  }
  if (await digest(path.join(directory, 'bin', binary)) !== manifest.binarySha256
    || await digest(path.join(metadata, `ffmpeg-${pin.version}.tar.xz`)) !== pin.sha256) {
    throw new Error('FFmpeg bundle checksum verification failed');
  }
  for (const filename of ['NOTICE.txt','LICENSE.md','COPYING.LGPLv2.1','COPYING.LGPLv3',
    'COPYING.GPLv3','configure-arguments.txt','ffmpeg-build.sh','ffmpeg-source.json','config.h','config.mak','build-packages.txt']) {
    await fs.access(path.join(metadata, filename));
  }
  for (const filename of target === 'windows-x64'
    ? ['mingw-w64-common-copyright.txt','gcc-mingw-w64-base-copyright.txt']
    : ['OpenSSL-copyright.txt']) await fs.access(path.join(metadata,filename));
  const args = await fs.readFile(path.join(metadata,'configure-arguments.txt'),'utf8');
  const config = await fs.readFile(path.join(metadata,'config.h'),'utf8');
  if (/--enable-(gpl|nonfree)\b/.test(args) || !/^#define FFMPEG_LICENSE "LGPL version/m.test(config)) {
    throw new Error('FFmpeg bundle must be an LGPL build without GPL/nonfree options');
  }
  return directory;
}

export async function buildFfmpeg(target) {
  const output = ffmpegBundleDir(target);
  try { return await validateFfmpegBundle(output, target); } catch { /* Build a missing/outdated bundle. */ }
  const platform = target === 'linux-arm64' && process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';
  const decoderTarget = target === 'windows-x64' ? target
    : target === 'linux-arm64' && process.arch !== 'arm64' ? 'linux-arm64' : 'linux';
  const result = spawnSync('docker', ['build', '--platform', platform,
    '-f', 'scripts/ffmpeg.Dockerfile', '--build-arg', `DECODER_TARGET=${decoderTarget}`,
    '--target', 'export', '--output', `type=local,dest=${output}`, '.'], {
    cwd:root, stdio:'inherit', windowsHide:true
  });
  if (result.error || result.status !== 0) throw new Error('FFmpeg source build failed; start Docker Desktop or supply the matching CI build artifact');
  return validateFfmpegBundle(output, target);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildFfmpeg(process.argv[2] || `${process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch}`)
    .then(directory => console.log(`Verified bundled FFmpeg: ${directory}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
