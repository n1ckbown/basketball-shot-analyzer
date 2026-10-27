import pytest
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path)
    return tmp_path


def upload(content, content_type="video/mp4", name="session.mp4"):
    return client.post("/videos", files={"file": (name, content, content_type)})


def test_upload_saves_video_under_job_id(upload_dir):
    response = upload(b"fake video bytes")

    assert response.status_code == 201
    job_id = response.json()["job_id"]
    assert (upload_dir / f"{job_id}.mp4").read_bytes() == b"fake video bytes"


def test_upload_keeps_mov_extension_and_ignores_client_file_name(upload_dir):
    response = upload(b"mov bytes", "video/quicktime", "../../evil.sh")

    assert response.status_code == 201
    assert [p.name for p in upload_dir.iterdir()] == [f"{response.json()['job_id']}.mov"]


def test_upload_rejects_non_video(upload_dir):
    response = upload(b"hello", "text/plain", "notes.txt")

    assert response.status_code == 415
    assert list(upload_dir.iterdir()) == []


def test_upload_rejects_empty_file(upload_dir):
    assert upload(b"").status_code == 400
    assert list(upload_dir.iterdir()) == []


def test_upload_rejects_file_over_limit(upload_dir, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 3)

    assert upload(b"four").status_code == 413
    assert list(upload_dir.iterdir()) == []
