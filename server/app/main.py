import functools
import json
import os
import re
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
MAX_UPLOAD_BYTES = 1024**3  # 1 GB, roughly 10 minutes of 1080p phone video
VIDEO_EXTENSIONS = {"video/mp4": ".mp4", "video/quicktime": ".mov"}
JOB_ID = re.compile(r"[0-9a-f]{32}")

app = FastAPI(title="Basketball Shot Analyzer server")
# One video at a time: they share the GPU, and a second job would only slow the first.
# shortcut: queued jobs are lost if the server restarts (their status stays "processing"); re-queue unfinished
# videos on startup once the server runs unattended.
worker = ThreadPoolExecutor(1)


@functools.cache
def detector():
    from app.detection import Detector  # Imported here so the API starts without loading torch.

    return Detector()


def analyze_video(path):
    from app.shots import analyze_video

    return analyze_video(path, detector())


def process(video: Path):
    """Analyze an uploaded video and save the result next to it as <job_id>.json."""
    try:
        result = {"status": "done", **analyze_video(video)}
    except Exception as error:  # Any failure must reach the app as "failed", not leave the job stuck.
        result = {"status": "failed", "error": str(error)}
    partial = video.with_suffix(".json.part")
    partial.write_text(json.dumps(result))
    partial.replace(video.with_suffix(".json"))  # Readers never see a half-written file.


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/videos", status_code=201)
def upload_video(file: UploadFile):
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
        return {"status": "processing"}
    raise HTTPException(404, "No such video.")
