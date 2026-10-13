# Contributing

## Run the development stack

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Use localhost:5173 for the UI and localhost:8000/docs for the API. See [architecture](docs/architecture.md) for component boundaries. Keep DSP independent of file decoding and GUI/API code. Processing callbacks must remain allocation-, lock-, and I/O-free.

## Verify changes

- Engine changes: run CTest in `engine-test` and the native/WASM parity browser test.
- API changes: run `api-test` with its real native executable.
- UI/audio lifecycle changes: build the web image (includes strict TypeScript checks), then run the Playwright suite against a separate test stack as described in the README.
- Docker changes: validate both Compose files and start their affected stacks.

```bash
docker compose config --quiet
docker compose -f compose.yaml -f compose.dev.yaml config --quiet
```

Check Safari and Chrome on macOS for audible playback, seek/loop behavior, and file export before a release. Headless Chromium tests exercise the AudioWorklet graph but do not replace listening through physical speakers.

## Dependencies

Frontend versions are exact in `web/package.json`; `web/package-lock.json` captures transitive resolution. Python direct dependencies are exact in the requirements files; transitive Python packages are resolved by pip during builds. Base images use explicit release tags, not immutable digests. Dependabot proposes updates; rebuild and verify after accepting them.

## Release

After checks pass, update version metadata in CMake, the frontend package, and API metadata together. Create an intentional `vX.Y.Z` tag to trigger the image-publishing workflow. It publishes `ghcr.io/<owner>/<repo>-api` and `-web` for ARM64/AMD64 using the repository's package permissions. Do not commit generated WASM, audio, databases, credentials, or local `.env` files.

## Next learning projects

- Crossfade seek and loop boundaries; add deterministic discontinuity tests.
- Add user-selectable EQ frequencies and a compressor with documented attack/release behavior.
- Add browser automation for WebKit and Firefox.
- Make export a cancellable background job with progress for longer tracks.
- Add FLAC export, LUFS analysis, and sample-rate conversion.
- Package the shared engine in a modern native desktop interface.
