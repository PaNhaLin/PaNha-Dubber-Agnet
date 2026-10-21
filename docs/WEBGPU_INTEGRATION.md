# VoxCPM2 WebGPU integration

**Status: experimental browser-local inference, not an ONNX implementation.**

## Implemented
- Choose "VoxCPM2 · WebGPU (on-device)" in the AI Voices tab.
- Inspect WebGPU capability and WebAssembly runtime installation.
- After explicit confirmation download the INT8 VoxCPM2 weights and invoke the real upstream Rust/WebAssembly/WebGPU inference engine.
- Convert returned PCM to WAV, upload it through the existing protected asset API, attach it to the chosen dubbing dialogue line and include it in FFmpeg MP4 exports.
- Keep the existing provider-based voices and browser voice preview unchanged.

## Usage

For Windows, install Node.js 22+; then:

    npm run webgpu:install
    npm start

Open http://localhost:3002 in current Chrome/Edge. Select Voice → VoxCPM2 · WebGPU (on-device), read the capability report, click Load on-device model and wait for the model. Select a dialogue with Khmer text and click Generate Voice for Line. The completed WAV is attached to the selected line and can be used during export.

The Railway Dockerfile installs upstream runtime JS/WASM at build time. The large model is NOT bundled and downloads only after browser user consent, requiring HTTPS.

## Source, capabilities and limitations

Browser runtime: https://github.com/shi3z/voxcpm2web (Apache-2.0), derived from https://github.com/mii-nipah/voxcpm-rs. Model: https://huggingface.co/shi3z/VoxCPM2-q8 based on OpenBMB VoxCPM2. This is NOT the older 0.5B ONNX model.

Upstream reports ~2.45 GiB of model download and ~5.22 GiB peak GPU usage. 8 GiB GPU is recommended. Intel integrated GPU and iPhone support are not verified. A working WebGPU adapter, shader-f16 detection or accessible manifest DO NOT prove the model will execute.

The installer downloads mutable upstream-built JS/WASM; it logs SHA256 and optionally verifies SHA256 when VOXCPM_JS_SHA256 and VOXCPM_WASM_SHA256 are supplied. For production, pin hashes from verified, trusted upstream builds. Original licenses of model and runtime still apply.

Speech generation, reference data and inference are local until the user attaches generated audio to the video, when the completed WAV is uploaded to the password-protected server for MP4 export. No automatic server fallback is performed. Users can manually select existing server TTS if WebGPU is incompatible.

## Acceptance tests
- [x] Real upstream model entry point wired into Dubber.
- [x] Browser load/diagnostics UI and explicit consent for multi-GiB download.
- [x] PCM16 WAV conversion and audio attachment to Dubber timeline.
- [x] WAV unit tests and syntax checks.
- [ ] End-to-end model download and Khmer generation tested on user's Windows Intel GPU.
- [ ] Peak memory, performance and Khmer quality benchmarks on actual device.
- [ ] Persistent model weight caching and long text/voice cloning in Dubber UI.

If the app cannot load the model on the device, select an existing provider voice. The separate Browser Voice Preview does not attach audio to a timeline.
