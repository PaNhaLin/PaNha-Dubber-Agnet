/**
 * Browser-local VoxCPM2 WebGPU adapter. Real inference comes from
 * shi3z/voxcpm2web (Apache-2.0), not a fake ONNX compatibility probe.
 * The optional WASM/JS runtime is installed at build time.
 * Model bytes download only after the person presses Load.
 */
export const MODEL_BASE = 'https://huggingface.co/shi3z/VoxCPM2-q8/resolve/main';
const RUNTIME_DIR = '/voxcpm2/runtime/';
let moduleRef;
let model;
let loading;
let generating = false;

function explanation(err) {
  return err instanceof Error ? err.message : String(err);
}

export function isModelReady() {
  return Boolean(model);
}

export async function inspectWebGpu() {
  const status = {
    supported: false,
    adapter: 'Unavailable',
    shaderF16: false,
    maxBufferMiB: null,
    maxStorageBufferMiB: null,
    reason: ''
  };
  if (!globalThis.isSecureContext) {
    status.reason = 'WebGPU requires HTTPS or localhost.';
    return status;
  }
  if (!navigator.gpu) {
    status.reason = 'WebGPU is unavailable in this browser. Try current Chrome or Edge.';
    return status;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
    if (!adapter) {
      status.reason = 'The browser returned no WebGPU adapter.';
      return status;
    }
    const info = adapter.info || {};
    const name = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' · ');
    status.adapter = name || 'WebGPU adapter (name unavailable)';
    if (/swiftshader|llvmpipe|software|basic render driver/i.test(name)) {
      status.reason = 'Only a software GPU was detected. Hardware acceleration is needed.';
      return status;
    }
    status.supported = true;
    status.shaderF16 = Boolean(adapter.features?.has('shader-f16'));
    status.maxBufferMiB = adapter.limits?.maxBufferSize
      ? Math.round(adapter.limits.maxBufferSize / 1048576) : null;
    status.maxStorageBufferMiB = adapter.limits?.maxStorageBufferBindingSize
      ? Math.round(adapter.limits.maxStorageBufferBindingSize / 1048576) : null;
    status.reason = 'Adapter detected. This does not guarantee 5+ GiB of usable GPU memory.';
  } catch (err) {
    status.reason = 'GPU inspection failed: ' + explanation(err);
  }
  return status;
}

export async function inspectRuntime() {
  const marker = await fetch(RUNTIME_DIR + 'installed.json', {cache: 'no-store'});
  if (!marker.ok) {
    return {installed: false, detail: 'WASM runtime is not installed on this server.'};
  }
  const manifest = await marker.json().catch(() => null);
  if (!manifest?.files?.['voxcpm_rs_bg.wasm'] || !manifest?.files?.['voxcpm_rs.js']) {
    return {installed: false, detail: 'Runtime installation marker is incomplete.'};
  }
  const response = await fetch(RUNTIME_DIR + 'voxcpm_rs_bg.wasm', {method: 'HEAD', cache: 'no-store'});
  if (!response.ok || !/application\/wasm/.test(response.headers.get('content-type') || '')) {
    return {installed: false, detail: 'WASM file missing or incorrectly served. The server must use application/wasm.'};
  }
  return {installed: true, detail: 'WASM files present; model not yet initialized.'};
}

export async function loadModel(onProgress = () => {}) {
  if (model) return {sampleRate: model.sample_rate, residentMiB: model.resident_mib};
  if (loading) return loading;
  loading = (async () => {
    const capability = await inspectWebGpu();
    if (!capability.supported) throw new Error(capability.reason);
    const installed = await inspectRuntime();
    if (!installed.installed) throw new Error(installed.detail + ' Run npm run webgpu:install before deployment.');
    onProgress('Initializing local WebAssembly/WebGPU engine', 0, 0);
    let runtime;
    try {
      runtime = await import('/voxcpm2/runtime/voxcpm_rs.js');
      if (typeof runtime.default !== 'function' || typeof runtime.load_model !== 'function') {
        throw new Error('Incompatible WASM exports');
      }
      await runtime.default(RUNTIME_DIR + 'voxcpm_rs_bg.wasm');
      runtime.init('info');
    } catch (err) {
      throw new Error('Unable to initialize WASM runtime: ' + explanation(err));
    }
    const info = (await navigator.gpu.requestAdapter({powerPreference: 'high-performance'}))?.info || {};
    runtime.set_adapter_hint?.(info.vendor || '', info.architecture || '',
      info.device || '', info.description || '', false);
    onProgress('Downloading ~2.45 GiB VoxCPM2 weights from Hugging Face', 0, 0);
    const loaded = await runtime.load_model(
      JSON.stringify({base: MODEL_BASE}), undefined,
      (stage, done, total, detail) => onProgress(String(stage) + ': ' + String(detail || ''), done, total),
      undefined, 'none'
    );
    if (!loaded || typeof loaded.generate !== 'function' || !loaded.sample_rate) {
      throw new Error('WASM returned an invalid VoxCPM2 model session.');
    }
    moduleRef = runtime;
    model = loaded;
    return {sampleRate: model.sample_rate, residentMiB: model.resident_mib};
  })();
  try { return await loading; }
  finally { loading = undefined; }
}

export function encodeWav(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || !samples.length) throw new Error('No speech samples returned.');
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('Invalid model sample rate.');
  }
  if (samples.length > (0xFFFFFFFF - 44) / 2) throw new Error('WAV would exceed 4 GiB.');
  const byteLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buffer);
  const label = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  label(0, 'RIFF'); view.setUint32(4, 36 + byteLength, true);
  label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, byteLength, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], {type: 'audio/wav'});
}

export async function synthesize(text, options = {}) {
  if (!model || !moduleRef) throw new Error('Load the VoxCPM2 WebGPU model first.');
  if (generating) throw new Error('Another WebGPU voice is being generated. Please wait.');
  if (typeof text !== 'string' || !text.trim() || text.length > 1500) {
    throw new Error('Enter 1–1500 characters of Khmer speech text.');
  }
  const cfg = Number(options.cfg ?? 2);
  const steps = Number(options.steps ?? 10);
  if (!(cfg >= 0.5 && cfg <= 5 && Number.isInteger(steps) && steps >= 2 && steps <= 30)) {
    throw new Error('Invalid CFG or diffusion steps.');
  }
  generating = true;
  const start = performance.now();
  try {
    const samples = await model.generate(text.trim(), cfg, steps, 600);
    const wav = encodeWav(samples, model.sample_rate);
    return {wav, sampleRate: model.sample_rate,
      audioSeconds: samples.length / model.sample_rate,
      generationSeconds: (performance.now() - start) / 1000};
  } finally {
    generating = false;
  }
}
