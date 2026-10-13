import asyncio
from contextlib import asynccontextmanager, contextmanager
import json
import logging
import os
from pathlib import Path
import shutil
import sqlite3
import uuid

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

MAX_UPLOAD = 100 * 1024 * 1024
logger = logging.getLogger("pulsemix")


class Parameters(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    master_db: float = Field(0, ge=-60, le=12)
    left_db: float = Field(0, ge=-60, le=6)
    right_db: float = Field(0, ge=-60, le=6)
    balance: float = Field(0, ge=-1, le=1)
    width: float = Field(1, ge=0, le=2)
    low_db: float = Field(0, ge=-12, le=12)
    mid_db: float = Field(0, ge=-12, le=12)
    high_db: float = Field(0, ge=-12, le=12)
    bypass: bool = False
    limiter: bool = True

    def cli_args(self):
        return [str(getattr(self, key)) for key in (
            "master_db", "left_db", "right_db", "balance", "width", "low_db", "mid_db", "high_db"
        )] + [str(int(self.bypass)), str(int(self.limiter))]


class PresetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    parameters: Parameters


class ProjectInput(PresetInput):
    asset_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    loop_start: float = Field(0, ge=0, allow_inf_nan=False)
    loop_end: float = Field(0, ge=0, allow_inf_nan=False)
    loop_enabled: bool = False


BUILTIN_PRESETS = [
    {"id": "neutral", "name": "Neutral", "parameters": Parameters().model_dump(), "builtin": True},
    {"id": "wide", "name": "Wide horizon", "parameters": Parameters(width=1.5, master_db=-3).model_dump(), "builtin": True},
    {"id": "warm", "name": "Warm tape", "parameters": Parameters(low_db=3, high_db=-2, master_db=-3).model_dump(), "builtin": True},
    {"id": "vocal", "name": "Vocal focus", "parameters": Parameters(mid_db=3, low_db=-2, width=0.8, master_db=-3).model_dump(), "builtin": True},
    {"id": "mono", "name": "Mono check", "parameters": Parameters(width=0).model_dump(), "builtin": True},
]


@contextmanager
def connection(app):
    db = sqlite3.connect(app.state.root / "pulsemix.sqlite3", timeout=10)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app):
    app.state.root = Path(os.environ.get("PULSEMIX_DATA_DIR", "data")).resolve()
    app.state.engine = os.environ.get("PULSEMIX_ENGINE", "/usr/local/bin/pulsemix")
    app.state.jobs = asyncio.Semaphore(2)
    for folder in ("assets", "exports"):
        (app.state.root / folder).mkdir(parents=True, exist_ok=True)
    with connection(app) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, analysis TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        """)
    # Export responses are transient, unlike uploaded audio and saved projects.
    for path in (app.state.root / "exports").glob("*.wav"):
        path.unlink(missing_ok=True)
    yield


app = FastAPI(title="PulseMix Audio Workbench", version="2.0.0", lifespan=lifespan)


async def run_engine(request, *args):
    async with request.app.state.jobs:
        process = await asyncio.create_subprocess_exec(
            request.app.state.engine, *map(str, args),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
        except (TimeoutError, asyncio.CancelledError):
            if process.returncode is None:
                process.kill()
            await process.communicate()
            raise
        if process.returncode:
            logger.info("Audio engine rejected request: %s", stderr.decode(errors="replace")[:500])
            raise HTTPException(422, "Audio processing failed. Use a valid mono/stereo WAV or FLAC, up to 5 minutes and 12 million frames, at 8–192 kHz.")
        return stdout


def get_asset(request, asset_id):
    with connection(request.app) as db:
        row = db.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Audio file not found")
    return {"id": row["id"], "name": row["name"], "created_at": row["created_at"], **json.loads(row["analysis"])}


@app.get("/api/health")
def health(request: Request):
    with connection(request.app) as db:
        db.execute("SELECT 1").fetchone()
    if not Path(request.app.state.engine).is_file():
        raise HTTPException(503, "Audio engine is unavailable")
    return {"status": "ok", "version": "2.0.0", "engine": "C++ / libsndfile"}


@app.get("/api/assets")
def assets(request: Request):
    with connection(request.app) as db:
        rows = db.execute("SELECT id, name, analysis, created_at FROM assets ORDER BY created_at DESC").fetchall()
    return [{"id": row["id"], "name": row["name"], "created_at": row["created_at"],
             **{k: v for k, v in json.loads(row["analysis"]).items() if k != "waveform"}} for row in rows]


@app.post("/api/assets", status_code=201)
async def upload(request: Request, file: UploadFile = File(...)):
    asset_id = uuid.uuid4().hex
    folder = request.app.state.root / "assets" / asset_id
    folder.mkdir()
    committed = False
    try:
        size = 0
        with (folder / "source.audio").open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "Maximum upload size is 100 MiB")
                output.write(chunk)
        if size == 0:
            raise HTTPException(422, "The audio file is empty")
        analysis = json.loads(await run_engine(request, "analyze", folder / "source.audio"))
        # Browser decoding is predictable: canonical stereo float WAV, preserving source rate.
        await run_engine(request, "render", folder / "source.audio", folder / "preview.wav",
                         *Parameters(bypass=True, limiter=False).cli_args())
        name = (file.filename or "Untitled.wav").replace("\\", "/").split("/")[-1][:180] or "Untitled.wav"
        with connection(request.app) as db:
            db.execute("INSERT INTO assets (id, name, analysis) VALUES (?, ?, ?)",
                       (asset_id, name, json.dumps(analysis)))
        committed = True
        return get_asset(request, asset_id)
    except TimeoutError:
        raise HTTPException(504, "Audio processing timed out")
    finally:
        await file.close()
        if not committed:
            shutil.rmtree(folder, ignore_errors=True)


@app.get("/api/assets/{asset_id}")
def asset(request: Request, asset_id: str):
    return get_asset(request, asset_id)


@app.get("/api/assets/{asset_id}/audio")
def audio(request: Request, asset_id: str):
    item = get_asset(request, asset_id)
    return FileResponse(request.app.state.root / "assets" / item["id"] / "preview.wav", media_type="audio/wav")


@app.delete("/api/assets/{asset_id}", status_code=204)
def delete_asset(request: Request, asset_id: str):
    item = get_asset(request, asset_id)
    with connection(request.app) as db:
        for row in db.execute("SELECT payload FROM projects"):
            if json.loads(row["payload"])["asset_id"] == item["id"]:
                raise HTTPException(409, "Delete projects using this audio before removing it")
        db.execute("DELETE FROM assets WHERE id = ?", (item["id"],))
    shutil.rmtree(request.app.state.root / "assets" / item["id"], ignore_errors=True)


@app.post("/api/assets/{asset_id}/export")
async def export(request: Request, asset_id: str, parameters: Parameters):
    item = get_asset(request, asset_id)
    output = request.app.state.root / "exports" / f"{uuid.uuid4().hex}.wav"
    try:
        await run_engine(request, "render", request.app.state.root / "assets" / item["id"] / "source.audio",
                         output, *parameters.cli_args())
    except TimeoutError:
        output.unlink(missing_ok=True)
        raise HTTPException(504, "Export timed out")
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return FileResponse(output, media_type="audio/wav", filename=f"{Path(item['name']).stem}-pulsemix.wav",
                        background=BackgroundTask(output.unlink, missing_ok=True))


def validate_project(request, payload):
    item = get_asset(request, payload.asset_id)
    if payload.loop_start > payload.loop_end or payload.loop_end > item["duration"] + 0.001:
        raise HTTPException(422, "Loop points must be ordered and within the audio duration")
    if payload.loop_enabled and payload.loop_end - payload.loop_start < 0.05:
        raise HTTPException(422, "Loop must be at least 50 ms long")


@app.get("/api/projects")
def projects(request: Request):
    with connection(request.app) as db:
        rows = db.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    return [{"id": row["id"], "updated_at": row["updated_at"], **json.loads(row["payload"])} for row in rows]


@app.post("/api/projects", status_code=201)
def create_project(request: Request, payload: ProjectInput):
    validate_project(request, payload)
    project_id = uuid.uuid4().hex
    with connection(request.app) as db:
        db.execute("INSERT INTO projects (id, payload) VALUES (?, ?)", (project_id, payload.model_dump_json()))
    return {"id": project_id, **payload.model_dump()}


@app.put("/api/projects/{project_id}")
def update_project(request: Request, project_id: str, payload: ProjectInput):
    validate_project(request, payload)
    with connection(request.app) as db:
        result = db.execute("UPDATE projects SET payload = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
                            (payload.model_dump_json(), project_id))
        if not result.rowcount:
            raise HTTPException(404, "Project not found")
    return {"id": project_id, **payload.model_dump()}


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(request: Request, project_id: str):
    with connection(request.app) as db:
        if not db.execute("DELETE FROM projects WHERE id = ?", (project_id,)).rowcount:
            raise HTTPException(404, "Project not found")


@app.get("/api/presets")
def presets(request: Request):
    with connection(request.app) as db:
        rows = db.execute("SELECT * FROM presets ORDER BY rowid DESC").fetchall()
    return BUILTIN_PRESETS + [{"id": row["id"], "builtin": False, **json.loads(row["payload"])} for row in rows]


@app.post("/api/presets", status_code=201)
def create_preset(request: Request, payload: PresetInput):
    preset_id = uuid.uuid4().hex
    with connection(request.app) as db:
        db.execute("INSERT INTO presets VALUES (?, ?)", (preset_id, payload.model_dump_json()))
    return {"id": preset_id, "builtin": False, **payload.model_dump()}


@app.delete("/api/presets/{preset_id}", status_code=204)
def delete_preset(request: Request, preset_id: str):
    with connection(request.app) as db:
        if not db.execute("DELETE FROM presets WHERE id = ?", (preset_id,)).rowcount:
            raise HTTPException(404, "Custom preset not found")
