import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const target = new URL('public/vendor/', root);
await mkdir(new URL('wasm/', target), { recursive: true });
await mkdir(new URL('models/', target), { recursive: true });

const vision = new URL('node_modules/@mediapipe/tasks-vision/', root);
for (const file of ['vision_bundle.js']) {
  await copyFile(new URL(file, vision), new URL(file, target));
}
for (const file of await readdir(new URL('wasm/', vision))) {
  // Classic workers use the SIMD and non-SIMD runtimes, not the module runtime.
  if (!file.includes('_module_') && /\.(js|wasm)$/.test(file)) {
    await copyFile(new URL(`wasm/${file}`, vision), new URL(`wasm/${file}`, target));
  }
}
await copyFile(new URL('node_modules/smartcrop/smartcrop.js', root), new URL('smartcrop.js', target));
await copyFile(new URL('node_modules/smartcrop/LICENSE', root), new URL('SMARTCROP-LICENSE', target));

const downloads = [
  ['models/face.tflite', 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range_sparse.tflite'],
  ['models/objects.tflite', 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite'],
  ['MEDIAPIPE-LICENSE', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.32/LICENSE'],
];
for (const [file, url] of downloads) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (file.endsWith('.tflite') && bytes.toString('ascii', 4, 8) !== 'TFL3') {
    throw new Error(`Invalid TensorFlow Lite model: ${file}`);
  }
  await writeFile(new URL(file, target), bytes);
  console.log(`${file}: ${bytes.length} bytes`);
}

// Record checksums; later rebuilds must reproduce the reviewed assets.
const files = ['vision_bundle.js', 'smartcrop.js', 'MEDIAPIPE-LICENSE', 'SMARTCROP-LICENSE',
  'models/face.tflite', 'models/objects.tflite',
  ...(await readdir(new URL('wasm/', target))).map(file => `wasm/${file}`)];
const manifest = {};
for (const file of files.sort()) {
  const bytes = await readFile(new URL(file, target));
  manifest[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const manifestUrl = new URL('manifest.json', target);
let previous;
try { previous = JSON.parse(await readFile(manifestUrl, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (previous && JSON.stringify(previous) !== JSON.stringify(manifest)) {
  throw new Error('Vendor assets differ from manifest.json. Review the upstream changes before updating the manifest.');
}
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Local detection assets prepared in ${fileURLToPath(target)}`);
