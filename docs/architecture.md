# Architecture

## Two builds, one DSP core

```text
engine/src/dsp.cpp
  ├─ native C++ library → pulsemix CLI → FastAPI subprocess
  └─ Emscripten library → dsp.js + dsp.wasm → browser AudioWorklet

Browser React UI ── same-origin /api/* ── nginx (or Vite dev proxy) ── FastAPI
Browser audio buffer → WASM DSP → analyzers → device speakers
FastAPI → libsndfile decode → native DSP → float WAV export
FastAPI → SQLite + asset files → /data named volume
```

Linux containers do not need the Mac's sound device or display server. Playback happens in Web Audio. The API has no GTK or PortAudio dependency. The original GTK program is an optional, separate historical build target.

## Upload and playback

1. The API streams an upload to an opaque UUID directory with a 100 MiB limit.
2. The native CLI validates the decoded format, duration, frame count, channels, and sample rate. Analysis reads fixed-size blocks, generating 1,024 min/max waveform buckets plus source peak, RMS, and correlation.
3. The CLI produces a stereo float WAV for browser decoding; original samples and source rate are retained. Mono is duplicated. Original audio, preview, and metadata persist under `/data`.
4. The browser decodes that preview to its AudioContext rate and loads a compiled WASM module into AudioWorklet. Processing controls send parameter messages; actual samples never travel over HTTP during playback.
5. UI analyzers poll fixed-length arrays. Visualization memory does not grow with playback time. Decode memory does scale with track size, hence the frame/duration limits.

AudioWorklet receives a precompiled WebAssembly module and instantiates it synchronously through Emscripten's hook. Heap buffers are allocated once at initialization. The C++ engine belongs to the worklet thread, so UI messages do not create C++ data races. The WASM heap is fixed at 16 MiB; audio file buffers live in Web Audio, not the WASM heap.

## Export

The browser sends validated settings to `POST /api/assets/{id}/export`. FastAPI starts the native executable with an argument list (no shell). The CLI processes the original file in blocks, using the same algorithms and the original sample rate. Export produces a full-length stereo float WAV, even when a playback loop is enabled.

Two CLI jobs may run concurrently per API process, with a 60-second execution timeout. Queued work waits for a slot. Temporary export files are removed after the response; leftovers are cleaned on API startup. This app uses a single API worker. Larger background jobs and multi-worker coordination would be a future extension.

## Persistence

SQLite stores assets, projects, and presets. Projects reference immutable uploaded assets, contain all DSP settings, and retain loop points. Referenced assets cannot be removed until their projects are removed. A named Docker volume contains both SQLite and audio files, so container recreation preserves them.

The API uses short-lived per-operation connections and SQLite WAL mode. It is a local, single-user workbench; services bind only to localhost in Compose. Production deployment would need its own access-control and storage design.

## Containers

- API build stage: Debian, CMake, compiler, libsndfile headers, CTest.
- API runtime: Python, libsndfile runtime, compiled CLI, non-root user.
- WASM stage: pinned AMD64 Emscripten SDK; emulated only while compiling on ARM64.
- Web dependency/development stage: Node and lockfile-installed packages.
- Web build stage: TypeScript checks and Vite compilation.
- Web runtime: unprivileged nginx serving static files and proxying `/api`.
- Browser test stage: cached Playwright browser tools, separate from runtime.

Compose waits for API readiness before starting web. Only web publishes a host port in the default stack. Internal DNS resolves `api:8000`; `localhost` inside web refers to web itself. The browser test service shares web's network namespace, so its browser can access a genuine localhost origin required by AudioWorklet.

## API overview

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Storage/engine availability |
| `GET/POST /api/assets` | Library / upload and analysis |
| `GET/DELETE /api/assets/{id}` | Asset metadata / remove unused asset |
| `GET /api/assets/{id}/audio` | Canonical playback WAV |
| `POST /api/assets/{id}/export` | Render with supplied parameters |
| `GET/POST /api/projects` | List / save sessions |
| `PUT/DELETE /api/projects/{id}` | Update / remove session |
| `GET/POST /api/presets` | Built-in and user presets / save preset |
| `DELETE /api/presets/{id}` | Remove custom preset |

OpenAPI documentation is available on port 8000 in development mode.
