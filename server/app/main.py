import functools
import json
import os
import re
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, Form, HTTPException, UploadFile

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
MAX_UPLOAD_BYTES = 1024**3  # 1 GB, roughly 10 minutes of 1080p phone video
VIDEO_EXTENSIONS = {"video/mp4": ".mp4", "video/quicktime": ".mov"}
JOB_ID = re.compile(r"[0-9a-f]{32}")
PHOTO_TYPES = {"image/jpeg", "image/png"}
MAX_PHOTO_BYTES = 20 * 2**20

# One video at a time: they share the GPU, and a second job would only slow the first.
worker = ThreadPoolExecutor(1)
# Fraction done of the video being analyzed, by job ID; only the worker thread writes it.
progress: dict[str, float] = {}


@functools.cache
def detector():
    from app.detection import Detector  # Imported here so the API starts without loading torch.

    return Detector()


def analyze_video(path, on_progress):
    from app.shots import analyze_video

    return analyze_video(path, detector(), on_progress)


@functools.cache
def pose_tracker():
    from app.form import PoseTracker

    return PoseTracker(balls=detector())


def analyze_form(path, on_progress):
    from app.form import analyze_form

    return analyze_form(path, pose_tracker(), on_progress)


def check_setup(image):
    from app.shots import check_setup

    return check_setup(detector().detect([image])[0], image.shape[1])


def process(video: Path):
    """Analyze an uploaded video and save the result next to it as <job_id>.json."""
    # A <job_id>.form file marks a form video, so the mode survives a restart.
    mode = "form" if video.with_suffix(".form").exists() else "shots"
    analyze = analyze_form if mode == "form" else analyze_video
    try:
        result = {"status": "done", "mode": mode, **analyze(video, lambda done: progress.__setitem__(video.stem, done))}
    except Exception as error:  # Any failure must reach the app as "failed", not leave the job stuck.
        result = {"status": "failed", "error": str(error)}
    partial = video.with_suffix(".json.part")
    partial.write_text(json.dumps(result))
    partial.replace(video.with_suffix(".json"))  # Readers never see a half-written file.
    progress.pop(video.stem, None)


def requeue_unfinished():
    """Queue videos that were uploaded but not analyzed before the server last stopped, oldest first."""
    if not UPLOAD_DIR.exists():
        return
    videos = [p for p in UPLOAD_DIR.iterdir()
              if p.suffix in VIDEO_EXTENSIONS.values() and not p.with_suffix(".json").exists()]
    for video in sorted(videos, key=lambda p: p.stat().st_mtime):
        worker.submit(process, video)


@asynccontextmanager
async def lifespan(_app):
    requeue_unfinished()
    yield


app = FastAPI(title="Basketball Shot Analyzer server", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/videos", status_code=201)
def upload_video(file: UploadFile, mode: Literal["shots", "form"] = Form("shots")):
    """mode "shots" counts makes and misses (the hoop must be in view); "form" measures the shooter's form."""
    extension = VIDEO_EXTENSIONS.get(file.content_type)
    if extension is None:
        raise HTTPException(415, "Upload an MP4 or MOV video.")
    if not file.size:
        raise HTTPException(400, "The uploaded file is empty.")
    # shortcut: the upload is fully received before this check; enforce the limit in the host's proxy once deployed
    if file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Video is larger than the {MAX_UPLOAD_BYTES // 2**20} MB limit.")

    # The job ID doubles as the file name, so the client's file name is never used on disk.
    job_id = uuid.uuid4().hex
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    video = UPLOAD_DIR / f"{job_id}{extension}"
    if mode == "form":
        video.with_suffix(".form").touch()  # Before the video, so a restart can never find the video without it.
    with open(video, "wb") as destination:
        shutil.copyfileobj(file.file, destination)
    worker.submit(process, video)
    return {"job_id": job_id}


@app.get("/videos/{job_id}")
def video_result(job_id: str):
    # Only well-formed IDs reach the file system, so a crafted ID can't point at other files.
    if not JOB_ID.fullmatch(job_id):
        raise HTTPException(404, "No such video.")
    result = UPLOAD_DIR / f"{job_id}.json"
    if result.exists():
        return json.loads(result.read_text())
    if any((UPLOAD_DIR / f"{job_id}{extension}").exists() for extension in VIDEO_EXTENSIONS.values()):
        return {"status": "processing", "progress": round(progress.get(job_id, 0.0), 2)}
    raise HTTPException(404, "No such video.")


@app.post("/setup-check")
def setup_check(file: UploadFile):
    """Checks one photo from the phone's camera before recording: hoop in view, room above it, big enough."""
    if file.content_type not in PHOTO_TYPES:
        raise HTTPException(415, "Upload a JPEG or PNG photo.")
    data = file.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, f"Photo is larger than the {MAX_PHOTO_BYTES // 2**20} MB limit.")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Could not read the photo.")
    return check_setup(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
