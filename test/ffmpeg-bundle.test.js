import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { validateFfmpegBundle, ffmpegBundleDir, verifyDecoderArchitecture } from '../scripts/build-ffmpeg.mjs';

const root = new URL('../', import.meta.url);
const pin = JSON.parse(await fs.readFile(new URL('scripts/ffmpeg-source.json',root),'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');

test('decoder architecture checks distinguish Linux AMD64/ARM64 and reject invalid executables', () => {
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f,69,76,70,2,1]).copy(elf);
  elf.writeUInt16LE(62,18);
  assert.equal(verifyDecoderArchitecture(elf,'linux-x64'),true);
  assert.equal(verifyDecoderArchitecture(elf,'linux-arm64'),false);
  elf.writeUInt16LE(183,18);
  assert.equal(verifyDecoderArchitecture(elf,'linux-arm64'),true);
  assert.equal(verifyDecoderArchitecture(elf,'windows-x64'),false);
  assert.equal(verifyDecoderArchitecture(Buffer.alloc(0),'windows-x64'),false);
});

test('vendored FFmpeg source matches the pinned official archive', async () => {
  assert.equal(pin.url,`https://ffmpeg.org/releases/ffmpeg-${pin.version}.tar.xz`);
  assert.equal(hash(await fs.readFile(new URL('third-party/ffmpeg/source.tar.xz',root))),pin.sha256);
  assert.throws(() => ffmpegBundleDir('../outside'), /Unsupported/);
});

test('decoder packaging rejects altered bundles, missing x86 assembly/notices and GPL builds', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'pfc-ffmpeg-metadata-'));
  t.after(() => fs.rm(directory,{ recursive:true,force:true }));
  const metadata = path.join(directory,'share','ffmpeg');
  await fs.mkdir(metadata,{ recursive:true });
  await fs.mkdir(path.join(directory,'bin'));
  const binary = Buffer.alloc(128);
  binary.write('MZ'); binary.writeUInt32LE(64,60); binary.write('PE\0\0',64); binary.writeUInt16LE(0x8664,68);
  const recipe = await fs.readFile(new URL('scripts/ffmpeg-build.sh',root));
  const manifest = { ...pin,binary:'ffmpeg.exe',binarySha256:hash(binary),
    target:'windows-x64',recipeSha256:hash(recipe) };
  const manifestPath = path.join(metadata,'manifest.json');
  const binaryPath = path.join(directory,'bin','ffmpeg.exe');
  const archivePath = path.join(metadata,`ffmpeg-${pin.version}.tar.xz`);
  await fs.writeFile(manifestPath,JSON.stringify(manifest));
  await fs.writeFile(binaryPath,binary);
  await fs.copyFile(new URL('third-party/ffmpeg/source.tar.xz',root),archivePath);
  await fs.writeFile(path.join(metadata,'ffmpeg-build.sh'),recipe);
  for (const filename of ['NOTICE.txt','LICENSE.md','COPYING.LGPLv2.1','COPYING.LGPLv3',
    'COPYING.GPLv3','ffmpeg-source.json','config.mak','build-packages.txt',
    'mingw-w64-common-copyright.txt','gcc-mingw-w64-base-copyright.txt']) {
    await fs.writeFile(path.join(metadata,filename),'test metadata');
  }
  const configPath = path.join(metadata,'config.h');
  const validConfig='#define FFMPEG_LICENSE "LGPL version 2.1 or later"\n#define HAVE_X86ASM 1\n';
  await fs.writeFile(configPath,validConfig);
  const argsPath = path.join(metadata,'configure-arguments.txt');
  await fs.writeFile(argsPath,'--enable-schannel');
  assert.equal(await validateFfmpegBundle(directory,'windows-x64'),directory);
  const altered = Buffer.from(binary); altered[127] = 1;
  await fs.writeFile(binaryPath,altered);
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/checksum/);
  await fs.writeFile(binaryPath,binary);
  await fs.writeFile(archivePath,'altered');
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/checksum/);
  await fs.copyFile(new URL('third-party/ffmpeg/source.tar.xz',root),archivePath);
  await fs.writeFile(path.join(metadata,'ffmpeg-build.sh'),'altered');
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/recipe/);
  await fs.writeFile(path.join(metadata,'ffmpeg-build.sh'),recipe);
  await assert.rejects(validateFfmpegBundle(directory,'linux-x64'),/source\/target/);
  await fs.writeFile(configPath,'#define FFMPEG_LICENSE "GPL version 3 or later"');
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/LGPL build/);
  await fs.writeFile(configPath,validConfig.replace('HAVE_X86ASM 1','HAVE_X86ASM 0'));
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/assembly support/);
  await fs.writeFile(configPath,validConfig);
  await fs.writeFile(argsPath,'--enable-nonfree');
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/LGPL build/);
  await fs.writeFile(argsPath,'--enable-schannel');
  await fs.unlink(path.join(metadata,'NOTICE.txt'));
  await assert.rejects(validateFfmpegBundle(directory,'windows-x64'),/ENOENT/);
});
