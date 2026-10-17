# PaNha Dubber Studio Pro Web

Private-beta video dubbing and Khmer subtitle editor, deployable on Railway.

## Deployment
This repository contains the sanitized application source bundle split into `bundle/*.part` files, because the connector uploads files as text. `Dockerfile` restores the source at build time using Brotli (built into Node.js); no secrets are included in the bundle.

Configure `APP_PASSWORD` as a Railway environment variable. The production server refuses to start without it. Open the generated HTTPS domain on a phone; enter the password in the app settings when prompted.

Functionality: local video editing, SRT/VTT, timed captions, FFmpeg MP4 rendering, optional AI endpoints. AI providers require separate credentials and a publicly reachable API endpoint. Media is retained temporarily; do not use as permanent video storage.

Source code can be expanded locally from the bundle: concatenate the numbered `.part` files, base64-decode, Brotli-decompress, and untar. Node 22 has built-in Brotli support.

Do not commit `.env` files, passwords or API keys.
