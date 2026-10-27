import os
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
MAX_UPLOAD_BYTES = 1024**3  # 1 GB, roughly 10 minutes of 1080p phone video
VIDEO_EXTENSIONS = {"video/mp4": ".mp4", "video/quicktime": ".mov"}

app = FastAPI(title="Basketball Shot Analyzer server")


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
    with open(UPLOAD_DIR / f"{job_id}{extension}", "wb") as destination:
        shutil.copyfileobj(file.file, destination)
    return {"job_id": job_id}
