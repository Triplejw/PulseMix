# Learn Docker with PulseMix

Run commands from the repository root. Start Colima first on macOS (`colima start`), or start Docker Desktop. Verify the pieces:

```bash
docker version
docker compose version
docker buildx version
```

The CLI talks to a daemon. On macOS the daemon runs in a Linux VM. A missing Colima socket usually means the VM is stopped. Homebrew plugins may need the discovery-directory setting described in the README.

## 1. Image versus container

```bash
docker compose build
docker image ls
docker compose up -d --wait
docker compose ps
```

An image is a built filesystem plus launch configuration. A container is a running instance. `build` alone plays no audio and starts no server. PulseMix has separate web and API images; Compose connects their running instances.

**Exercise:** stop web with `docker compose stop web`. Refresh the browser. Start it again with `docker compose start web`. The API stayed running.

## 2. Build context and layers

Inspect `docker/Dockerfile.api`. The final dot below means the repository is the build context; `COPY` paths are relative to it, not the Dockerfile's folder.

```bash
docker build -f docker/Dockerfile.api --target api -t pulsemix-api:lesson .
docker history pulsemix-api:lesson
```

Dependency installation precedes application source copies. Source changes reuse expensive dependency layers. `.dockerignore` excludes Git history, local data, dependencies, and generated files.

**Exercise:** change an API response string, rebuild, and identify the cached layers. Restore your edit afterward. Compare this with changing `api/requirements.txt`.

## 3. Multi-stage builds

```bash
docker build -f docker/Dockerfile.api --target engine-test -t pulsemix-engine:lesson .
docker run --rm pulsemix-engine:lesson
docker run --rm pulsemix-api:lesson python --version
docker run --rm pulsemix-api:lesson sh -c 'command -v g++ || true'
```

The builder contains compilers; the runtime gets just the resulting executable and runtime dependencies. The web runtime contains neither Node nor the Emscripten toolchain. WASM is generated during the build and copied through stages.

**Exercise:** compare `docker image ls` sizes for the engine builder, browser test image, and runtime images. Why should users receive the runtime?

## 4. Ports and service DNS

The browser reaches host port 8080. nginx receives it on container port 8080 and sends API requests to the Compose service name `api` on port 8000.

```bash
docker compose exec web wget -qO- http://api:8000/api/health
curl http://localhost:8080/api/health
```

**Exercise:** explain why `http://localhost:8000` would not reach the API from inside the web container. Then run the app on a different host port:

```bash
docker compose down
PULSEMIX_PORT=8090 docker compose up -d --wait
```

Open localhost:8090. The internal API address is unchanged.

## 5. Volumes and persistence

Upload demo and save a session. Then:

```bash
docker compose down
docker compose up -d --wait
docker volume inspect pulsemix_audio-data
```

Your session remains because `/data` is a named volume, separate from the container's writable layer. The default volume name follows the `pulsemix` project name; a `-p` project override gets its own volume.

**Exercise:** create a second stack with `-p pulsemix-sandbox` and a different host port. Compare its empty library with your original stack. Remove the sandbox with `docker compose -p pulsemix-sandbox down -v` when done. `-v` deletes that project's volume.

## 6. Bind mounts and hot reload

```bash
docker compose down
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Edit `web/src/App.tsx`, then edit `api/app/main.py`. Bind mounts expose the host source directories; Vite and uvicorn reload them. Dependencies and WASM stay in the image, so a host directory cannot hide them.

**Exercise:** add a visible heading, watch it update, then inspect `docker compose -f compose.yaml -f compose.dev.yaml config` to see the merged configuration. C++ changes require a rebuild because they produce compiled artifacts.

## 7. Logs, health, and shells

```bash
docker compose logs --tail=50 api
docker compose ps
docker compose exec api sh
```

Inside the shell, try `id` and `ls /data`, then exit. The API runs as a non-root user. Health checks verify readiness; Compose can wait before starting a dependent service.

**Exercise:** inspect a container with `docker inspect pulsemix-api-1` and locate its mounts, health result, command, and network address.

## 8. Disposable test containers

```bash
docker compose --profile test run --build --rm engine-test
docker compose --profile test run --build --rm api-test
```

Profiles keep test tools out of normal startup. `run` starts a one-off container, and `--rm` removes it after completion. The API integration suite generates tiny audio fixtures and temporary databases; it never uses your main named volume.

For browser tests, follow the separate `pulsemix-test` stack commands in the README. Its browser container shares web's network namespace: localhost really points to the tested server, satisfying browser secure-context requirements without special insecure-origin flags.

## 9. Apple Silicon and multi-platform builds

```bash
docker buildx ls
docker buildx imagetools inspect python:3.12-slim-bookworm
```

The native API and web runtime bases have ARM64 variants. The pinned Emscripten 3.1.74 builder is AMD64-only and deliberately uses emulation. It emits platform-independent WASM, so the compiler architecture does not dictate the final image architecture.

**Exercise:** inspect `.github/workflows/release.yml`. A version tag builds both `linux/amd64` and `linux/arm64` images and publishes them to GHCR. Tags are created intentionally after verification; the workflow file alone publishes nothing.

## Troubleshooting

- **Missing Docker socket:** start Colima/Desktop, then check `docker context ls`.
- **Missing compose/buildx:** install the plugins and merge `cliPluginsExtraDirs` as described in the README.
- **Port in use:** set `PULSEMIX_PORT` to an unused host port.
- **AudioWorklet unavailable:** use localhost or HTTPS and a modern browser.
- **Missing WASM:** rebuild the web image; mounting all of `/app` can hide generated artifacts.
- **First build is slow:** the SDK/browser test images are large; cached rebuilds are much smaller operations.
- **API errors:** inspect API logs and check file-format/size/duration/frame limits.
- **Permission error on `/data`:** use the named volume; an arbitrary host bind mount may need ownership matching UID 10001.
- **Browser suspended audio:** press Play. Switching tabs or audio devices can also suspend a browser context.
