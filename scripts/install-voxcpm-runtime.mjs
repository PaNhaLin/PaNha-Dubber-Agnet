/**
 * Opt-in runtime installer for the independent Apache-2.0 VoxCPM2Web code.
 * Downloads only upstream JS/WASM (NOT ~2.45 GiB model weights).
 * Upstream binaries are mutable; verify SHA256 against a trusted release for production use.
 */
import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const base = 'https://shi3z.github.io/voxcpm2web/pkg/';
const target = fileURLToPath(new URL('../public/voxcpm2/runtime/', import.meta.url));
const files = [
  {name: 'voxcpm_rs.js', maxBytes: 3 * 1024 * 1024},
  {name: 'voxcpm_rs_bg.wasm', maxBytes: 32 * 1024 * 1024}
];
await mkdir(target, {recursive: true});
const manifest = {origin: base, installedAt: new Date().toISOString(), files: {}};
for (const file of files) {
  console.log('Fetching ' + file.name);
  const response = await fetch(base + file.name, {signal: AbortSignal.timeout(180000)});
  if (!response.ok || !response.body) throw new Error(file.name + ': HTTP ' + response.status);
  if (Number(response.headers.get('content-length') || 0) > file.maxBytes) throw new Error('Download too large');
  let size = 0;
  const parts = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > file.maxBytes) throw new Error('Download exceeds maximum size: ' + file.name);
    parts.push(chunk);
  }
  const data = Buffer.concat(parts);
  if (file.name.endsWith('.wasm') && data.subarray(0, 4).toString('hex') !== '0061736d') {
    throw new Error('Invalid WebAssembly file signature.');
  }
  if (file.name.endsWith('.js') && !data.toString('utf8', 0, 6000).includes('WebAssembly')) {
    throw new Error('Runtime JavaScript does not look like the expected WebAssembly loader.');
  }
  const hash = createHash('sha256').update(data).digest('hex');
  const expected = process.env[file.name.endsWith('.wasm') ? 'VOXCPM_WASM_SHA256' : 'VOXCPM_JS_SHA256'];
  if (expected && hash !== expected.toLowerCase()) throw new Error('SHA256 mismatch for ' + file.name);
  const output = join(target, file.name);
  await writeFile(output + '.part', data);
  await rename(output + '.part', output);
  manifest.files[file.name] = {bytes: size, sha256: hash};
  console.log(file.name + ' ' + size + ' bytes; sha256 ' + hash);
}
await writeFile(join(target, 'installed.json.part'), JSON.stringify(manifest, null, 2) + '\n');
await rename(join(target, 'installed.json.part'), join(target, 'installed.json'));
await rm(join(target, '.unused'), {force: true});
console.log('WASM/JS installed. Model weights are not downloaded until explicit browser activation.');
