import io
import ctypes
import struct
import wave

from fastapi.testclient import TestClient
import pytest

from app.main import app, Parameters


def wav(channels=2, sample_rate=48000, frames=512):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        samples = [int(8192 if channel == 0 else -4096) for _ in range(frames) for channel in range(channels)]
        audio.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return stream.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PULSEMIX_DATA_DIR", str(tmp_path))
    with TestClient(app) as client:
        yield client


def uploaded(client, **kwargs):
    response = client.post("/api/assets", files={"file": ("test.wav", wav(**kwargs), "audio/wav")})
    assert response.status_code == 201, response.text
    return response.json()


def float_wav_samples(content):
    # libsndfile writes a float WAV with optional fmt/fact/PEAK chunks.
    assert content[:4] == b"RIFF" and content[8:12] == b"WAVE"
    offset = 12
    while offset + 8 <= len(content):
        name, size = struct.unpack_from("<4sI", content, offset)
        offset += 8
        if name == b"data":
            return struct.unpack_from(f"<{size // 4}f", content, offset)
        offset += size + (size % 2)
    raise AssertionError("Missing WAV data chunk")


def test_upload_analysis_and_mono_conversion(client):
    assert client.get("/api/health").json()["status"] == "ok"
    asset = uploaded(client, channels=1)
    assert asset["channels"] == 1
    assert asset["frames"] == 512
    assert len(asset["waveform"]) == 512
    assert asset["peak"] == [0.25, 0.25]
    samples = float_wav_samples(client.get(f"/api/assets/{asset['id']}/audio").content)
    assert samples[::2] == samples[1::2]
    assert len(client.get("/api/assets").json()) == 1


def test_native_export_gain_width_and_cleanup(client):
    asset = uploaded(client)
    params = Parameters(width=0, master_db=-6.0206, limiter=False).model_dump()
    response = client.post(f"/api/assets/{asset['id']}/export", json=params)
    assert response.status_code == 200
    samples = float_wav_samples(response.content)
    assert samples[0] == pytest.approx(0.03125, abs=1e-5)
    assert samples[0] == samples[1]
    assert not list((app.state.root / "exports").glob("*.wav"))


def test_rejects_invalid_audio_and_parameters(client):
    for content in (b"", b"not an audio file", wav(channels=3), wav(sample_rate=4000)):
        response = client.post("/api/assets", files={"file": ("bad.wav", content)})
        assert response.status_code == 422
    assert not list((app.state.root / "assets").iterdir())
    asset = uploaded(client)
    for params in ({"width": 3}, {"master_db": 90}, {"unknown": 1}):
        assert client.post(f"/api/assets/{asset['id']}/export", json=params).status_code == 422
    assert client.get("/api/assets/../../etc/passwd/audio").status_code == 404
    assert client.get("/api/assets/missing").status_code == 404


def test_upload_size_limit_removes_partial_files(client, monkeypatch):
    monkeypatch.setattr("app.main.MAX_UPLOAD", 100)
    response = client.post("/api/assets", files={"file": ("large.wav", wav())})
    assert response.status_code == 413
    assert not list((app.state.root / "assets").iterdir())


def test_flac_decoding_and_conversion(client, tmp_path):
    class Info(ctypes.Structure):
        _fields_ = [("frames", ctypes.c_int64), ("samplerate", ctypes.c_int),
                    ("channels", ctypes.c_int), ("format", ctypes.c_int),
                    ("sections", ctypes.c_int), ("seekable", ctypes.c_int)]
    library = ctypes.CDLL("libsndfile.so.1")
    library.sf_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(Info)]
    library.sf_open.restype = ctypes.c_void_p
    library.sf_writef_float.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int64]
    library.sf_writef_float.restype = ctypes.c_int64
    library.sf_close.argtypes = [ctypes.c_void_p]
    path = tmp_path / "fixture.flac"
    info = Info(0, 44100, 1, 0x170002, 0, 0)  # FLAC / PCM16
    handle = library.sf_open(str(path).encode(), 0x20, ctypes.byref(info))
    assert handle
    try:
        samples = (ctypes.c_float * 512)(*([0.25] * 512))
        assert library.sf_writef_float(handle, samples, 512) == 512
    finally:
        library.sf_close(handle)
    response = client.post("/api/assets", files={"file": ("fixture.flac", path.read_bytes(), "audio/flac")})
    assert response.status_code == 201
    item = response.json()
    assert item["sample_rate"] == 44100 and item["peak"] == [0.25, 0.25]
    samples = float_wav_samples(client.get(f"/api/assets/{item['id']}/audio").content)
    assert samples[0] == samples[1] == 0.25


def test_projects_presets_and_referenced_asset(client):
    asset = uploaded(client, frames=4800)
    payload = {"name": "Learning session", "asset_id": asset["id"], "parameters": {"width": 1.5},
               "loop_start": 0.01, "loop_end": 0.09, "loop_enabled": True}
    project = client.post("/api/projects", json=payload)
    assert project.status_code == 201
    project_id = project.json()["id"]
    assert client.get("/api/projects").json()[0]["parameters"]["width"] == 1.5
    payload["name"] = "Updated"
    assert client.put(f"/api/projects/{project_id}", json=payload).status_code == 200
    assert client.delete(f"/api/assets/{asset['id']}").status_code == 409
    payload["loop_end"] = 500
    assert client.put(f"/api/projects/{project_id}", json=payload).status_code == 422
    preset = client.post("/api/presets", json={"name": "My width", "parameters": {"width": 1.4}})
    assert preset.status_code == 201
    assert len(client.get("/api/presets").json()) == 6
    assert client.delete(f"/api/presets/{preset.json()['id']}").status_code == 204
    assert client.delete(f"/api/projects/{project_id}").status_code == 204
    assert client.delete(f"/api/assets/{asset['id']}").status_code == 204


def test_persistence_across_restarts(tmp_path, monkeypatch):
    monkeypatch.setenv("PULSEMIX_DATA_DIR", str(tmp_path))
    with TestClient(app) as first:
        asset = uploaded(first)
        project = first.post("/api/projects", json={"name": "Persistent", "asset_id": asset["id"], "parameters": {}}).json()
    with TestClient(app) as second:
        assert second.get("/api/assets").json()[0]["id"] == asset["id"]
        assert second.get("/api/projects").json()[0]["id"] == project["id"]
        assert second.get(f"/api/assets/{asset['id']}/audio").status_code == 200
