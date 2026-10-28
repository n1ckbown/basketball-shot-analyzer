"""Find the ball and hoop in video frames with an RT-DETR detector."""

import itertools
import os
import sys
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import cv2
import numpy as np
import torch
from transformers import AutoImageProcessor, AutoModelForObjectDetection

# A Hugging Face model ID or a local folder; point this at the fine-tuned ball/hoop model once it exists.
DETECTOR_MODEL = os.environ.get("DETECTOR_MODEL", "PekingU/rtdetr_v2_r18vd")
MIN_SCORE = 0.3
BATCH_SIZE = 8
# Pretrained COCO models call the ball "sports ball"; a fine-tuned model may use other names.
LABEL_ALIASES = {"sports ball": "ball", "ball": "ball", "basketball": "ball", "hoop": "hoop", "rim": "hoop"}


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels


def read_frames(path, every_n=1) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (frame index, RGB frame) for every `every_n`-th frame of a video."""
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {path}")
    try:
        index = 0
        while capture.grab():
            if index % every_n == 0:
                ok, frame = capture.retrieve()
                if ok:
                    yield index, cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            index += 1
    finally:
        capture.release()


def to_detections(result, id2label) -> list[Detection]:
    """Turn one post-processed model result into ball/hoop detections, dropping every other class."""
    detections = []
    for score, label_id, box in zip(result["scores"].tolist(), result["labels"].tolist(), result["boxes"].tolist()):
        label = LABEL_ALIASES.get(id2label[label_id])
        if label:
            detections.append(Detection(label, score, tuple(box)))
    return detections


class Detector:
    def __init__(self, model_name=DETECTOR_MODEL):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = AutoImageProcessor.from_pretrained(model_name)
        self.model = AutoModelForObjectDetection.from_pretrained(model_name).to(self.device).eval()

    @torch.inference_mode()
    def detect(self, frames: list[np.ndarray]) -> list[list[Detection]]:
        # Resizing on the GPU: about 2 ms per 1080p frame instead of 30 ms on the CPU.
        images = [torch.from_numpy(frame).to(self.device).permute(2, 0, 1) for frame in frames]
        inputs = self.processor(images=images, return_tensors="pt", device=self.device).to(self.device)
        outputs = self.model(**inputs)
        sizes = [frame.shape[:2] for frame in frames]
        results = self.processor.post_process_object_detection(outputs, threshold=MIN_SCORE, target_sizes=sizes)
        return [to_detections(result, self.model.config.id2label) for result in results]


def detect_video(path, detector, every_n=1, on_progress=None) -> list[tuple[int, list[Detection]]]:
    """Run the detector over a video in batches; returns (frame index, detections) per sampled frame.

    on_progress, if given, is called after each batch with the fraction of the video done (0 to 1).
    """
    total = cv2.VideoCapture(str(path)).get(cv2.CAP_PROP_FRAME_COUNT)
    results = []
    batches = itertools.batched(read_frames(path, every_n), BATCH_SIZE)
    # Decode the next batch in a second thread while the detector works (OpenCV releases the GIL while decoding).
    with ThreadPoolExecutor(1) as decoder:
        upcoming = decoder.submit(next, batches, None)
        while (batch := upcoming.result()) is not None:
            upcoming = decoder.submit(next, batches, None)
            indexes, frames = zip(*batch)
            results.extend(zip(indexes, detector.detect(list(frames))))
            if on_progress and total:
                on_progress(min(1.0, (indexes[-1] + 1) / total))
    return results


if __name__ == "__main__":
    # Manual check on a real video: python -m app.detection path/to/video.mov
    frames = detect_video(sys.argv[1], Detector())
    for index, detections in frames:
        print(index, ", ".join(f"{d.label} {d.score:.2f} {[round(v) for v in d.box]}" for d in detections))
    for label in ("ball", "hoop"):
        found = sum(any(d.label == label for d in detections) for _, detections in frames)
        print(f"{label}: found in {found} of {len(frames)} frames")
