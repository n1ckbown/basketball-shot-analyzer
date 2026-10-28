import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)


RESULT = {"attempts": 2, "makes": 1, "shots": [{"time": 3.0, "made": True}, {"time": 9.5, "made": False}]}


class RunNow:
    """Runs submitted jobs immediately, so tests don't wait on a background thread."""

    def submit(self, fn, *args):
        fn(*args)


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(main, "worker", RunNow())
    monkeypatch.setattr(main, "analyze_video", lambda path: RESULT)
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
    job_id = response.json()["job_id"]
    assert sorted(p.name for p in upload_dir.iterdir()) == [f"{job_id}.json", f"{job_id}.mov"]


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


def test_result_is_available_after_processing():
    job_id = upload(b"fake video bytes").json()["job_id"]

    assert client.get(f"/videos/{job_id}").json() == {"status": "done", **RESULT}


def test_result_says_processing_until_analysis_finishes(upload_dir):
    job_id = "0" * 32
    (upload_dir / f"{job_id}.mov").write_bytes(b"video")

    assert client.get(f"/videos/{job_id}").json() == {"status": "processing"}


def test_failed_analysis_is_reported(monkeypatch):
    def broken(path):
        raise ValueError("Could not open video")

    monkeypatch.setattr(main, "analyze_video", broken)
    job_id = upload(b"not really a video").json()["job_id"]

    assert client.get(f"/videos/{job_id}").json() == {"status": "failed", "error": "Could not open video"}


def test_unknown_or_malformed_job_ids_are_not_found(upload_dir):
    (upload_dir / "secret.json").write_text("{}")

    assert client.get(f"/videos/{'a' * 32}").status_code == 404
    assert client.get("/videos/secret").status_code == 404
    assert client.get("/videos/..%2Fsecret").status_code == 404


def test_setup_check_runs_the_photo_through_the_detector(monkeypatch):
    seen = []
    monkeypatch.setattr(main, "check_setup", lambda image: seen.append(image.shape) or {"hoop": True})
    _, jpeg = cv2.imencode(".jpg", np.zeros((90, 160, 3), np.uint8))

    response = client.post("/setup-check", files={"file": ("photo.jpg", jpeg.tobytes(), "image/jpeg")})

    assert response.json() == {"hoop": True}
    assert seen == [(90, 160, 3)]


def test_setup_check_rejects_files_that_are_not_photos():
    assert client.post("/setup-check", files={"file": ("a.txt", b"hi", "text/plain")}).status_code == 415
    assert client.post("/setup-check", files={"file": ("a.jpg", b"not a jpeg", "image/jpeg")}).status_code == 400


def test_videos_left_unanalyzed_by_a_restart_are_analyzed_on_startup(upload_dir):
    (upload_dir / f"{'1' * 32}.mov").write_bytes(b"video")
    (upload_dir / f"{'2' * 32}.mp4").write_bytes(b"video")
    (upload_dir / f"{'2' * 32}.json").write_text('{"status": "done"}')

    with TestClient(main.app) as restarted:
        assert restarted.get(f"/videos/{'1' * 32}").json() == {"status": "done", **RESULT}
        assert restarted.get(f"/videos/{'2' * 32}").json() == {"status": "done"}  # already analyzed: left alone
