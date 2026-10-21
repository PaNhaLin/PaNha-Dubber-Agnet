# PaNha Dubber Studio Pro — Deployable Web MVP

This is a **functional, deployable web MVP**, not the earlier in-chat visual prototype. It uses a standalone Node.js 20+ HTTP server, a responsive video/timeline editor in the browser, and FFmpeg for server-side rendering. It is an independent implementation inspired by the requested workflow, **not an exact copy** of DAI Dubber Pro or the user's existing unpublished localhost source.

## Experimental VoxCPM2 WebGPU voice

The Voice tab can now generate Khmer speech using an opt-in browser-local WebGPU VoxCPM2 runtime; generated WAV can be attached to the dubbed video timeline. Run npm run webgpu:install before npm start on local Windows, or use the Docker build which installs the WASM runtime. Model weights (~2.45 GiB) download only after pressing Load; peak GPU memory can exceed 5 GiB and Intel integrated GPUs have not been verified. See [WebGPU setup and limitations](docs/WEBGPU_INTEGRATION.md). Other speech providers remain available.

## Working features

- Import local videos to preview without uploading them to the server.
- Add/edit/delete original and Khmer subtitle lines; click, drag and trim subtitle blocks on the timeline.
- Import SRT/VTT and export SRT/VTT.
- Save/load project JSON; automatically save text edits in browser storage (media is **not** included in JSON).
- Keep multiple episodes in one project.
- Export an actual MP4 with burned-in Khmer captions using FFmpeg/libass. Original soundtrack is preserved.
- Attach recorded MP3/WAV/M4A audio to subtitle lines; MP4 export mixes timed voice tracks over original audio.
- Optional OpenAI-compatible AI translation, voice synthesis and transcription, including a compatible PaNha AI Gateway.
- Password protection for costly API routes; Docker packaging for cloud hosting.

## What still requires work

Realistic multilingual speaker diarization, vocal/music separation, frame-accurate waveform editing, automatic lip sync, and reliable automatic Khmer dubbing are **not** implemented. An **experimental browser-local VoxCPM2 WebGPU voice option** is integrated, but its GPU and model-download behavior has not yet been validated on Intel integrated graphics; see [docs/WEBGPU_INTEGRATION.md](docs/WEBGPU_INTEGRATION.md). Providers require credentials or a configured local model server. AI endpoints must support `/chat/completions`, `/audio/transcriptions`, and `/audio/speech`; support varies by gateway. The browser voice preview is not an audio file and is not rendered into exports.

## Run on Windows

1. Install [Node.js LTS](https://nodejs.org/) 20+ and [FFmpeg](https://ffmpeg.org/download.html) and make sure both `node` and `ffmpeg` are in `PATH`.
2. Extract the ZIP to a short writable folder, such as `D:\PaNhaDubberWeb` (no admin rights needed if your account can write there).
3. Double-click `START_WINDOWS.cmd`, or in Command Prompt run `node server.mjs` inside the project folder.
4. Open `http://localhost:3002/`.
5. Import an MP4, add subtitles, choose Export MP4 and wait for rendering.

There is no `npm install` step; the server uses Node.js built-in modules. For best Khmer fonts install Noto Sans Khmer on the machine running FFmpeg. The included Docker image installs Khmer font packages.

## Run with Docker

```bash
# Set APP_PASSWORD to a strong value in your environment or a local .env file first.
docker compose up --build
```

Open `http://localhost:3002/`. For Docker, AI_BASE_URL=127.0.0.1 points **inside the container**, not to the Windows host. To connect a gateway running on the Windows host use `http://host.docker.internal:8878/v1` where supported. The gateway must permit the connection.

## Publish online using a Docker host

1. Push the contents of this folder to your own private GitHub repository (exclude `.env`, secrets, and user media).
2. On Render, Railway, Fly.io, or another service that runs Docker containers, create a new **Docker web service** from that repository.
3. Configure `APP_PASSWORD` with a strong value. The server will refuse to start in `NODE_ENV=production` without a password. Let the host supply `PORT` if it does so automatically.
4. Configure `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `ASR_MODEL`, and `TTS_MODEL` only if you want provider-backed translation/transcription/voice features. Put keys into the host's **server-side environment variables**, never frontend code.
5. Set up a persistent disk or volume for `DATA_DIR=/data` if you need uploads and exports to survive container restarts. Note that the in-memory asset/job registry is reset on restart, so users must re-upload video files after restart, even with a volume.
6. Wait for the container to start, then open the HTTPS URL given by your hosting service. Open Settings in the UI and enter the same Studio access password before making API requests.

You **cannot** connect a public cloud server to `http://localhost:8878` on your Windows PC without a secured reachable gateway/tunnel. Do not expose your private AI Gateway without authentication and HTTPS. Cloud provider costs, CPU/memory limits, upload size/time limits, and temporary storage policies vary. FFmpeg exports require significant RAM/CPU. Low-resource hosting plans may reject large media files or time out.

## Subtitle font quality

The included ASS renderer requests `Noto Sans Khmer`. On Windows without this font the system may substitute a font. Docker installs the `fonts-noto-core` and `fonts-khmeros` packages. Export to a test video first to confirm Khmer text is legible.

## Project security and rights

Only process videos you own or have permission to dub. This app does not scrape streaming sites, download subscription-only media, bypass DRM or circumvent paywalls. Use `APP_PASSWORD` to restrict costly rendering and provider routes when publishing. Files are temporarily stored on the app server during processing. This MVP does not include a multi-user account system, billing, object storage, virus scanning, abuse protection, queue persistence, or auto-deletion of uploads. **Do not launch it publicly for unrestricted use without addressing those security, privacy, and infrastructure requirements.** In production, the server refuses to start unless `APP_PASSWORD` is configured. API media files and completed jobs are eligible for automatic removal after 24 hours while the server is running.

## API endpoints

- `GET /api/status`: backend capabilities
- `POST /api/assets`: binary video/audio upload; set `x-filename` and `x-media-kind`
- `POST /api/translate`: translate original subtitle lines via provider
- `POST /api/transcribe`: transcribe uploaded video via provider
- `POST /api/tts`: generate TTS audio via provider
- `POST /api/render`: start FFmpeg export job
- `GET /api/jobs/:jobId`: poll job status
- `GET /api/exports/:jobId`: download generated MP4

For protected routes, supply `x-studio-password` header. See `.env.example` for environment variables.

## Testing

Run `npm test`. Four unit tests check timing and ASS escaping, and an additional FFmpeg integration test verifies video upload, protected API access, subtitle rendering and MP4 download. AI providers are not covered by the tests. Browser UI smoke testing was limited by the test environment.

Read `PUBLISH_GUIDE.md` for step-by-step Railway and Render publishing instructions.
