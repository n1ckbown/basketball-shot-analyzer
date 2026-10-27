import cv2
import numpy as np
import pytest
import torch

from app import detection
from app.detection import Detection, detect_video, read_frames, to_detections


def write_video(path, frame_count):
    """Write a tiny video whose frame i is filled with blue value i, so frames can be told apart."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 30, (32, 24))
    for i in range(frame_count):
        writer.write(np.full((24, 32, 3), (i * 20, 0, 0), dtype=np.uint8))  # BGR
    writer.release()
    return path


def test_read_frames_returns_rgb_frames_in_order(tmp_path):
    frames = list(read_frames(write_video(tmp_path / "clip.avi", 5)))

    assert [index for index, _ in frames] == [0, 1, 2, 3, 4]
    assert frames[0][1].shape == (24, 32, 3)
    # Blue was written in BGR position 0, so after conversion it is in RGB position 2.
    assert frames[3][1][0, 0, 2] == pytest.approx(60, abs=8)


def test_read_frames_can_skip_frames(tmp_path):
    frames = read_frames(write_video(tmp_path / "clip.avi", 5), every_n=2)

    assert [index for index, _ in frames] == [0, 2, 4]


def test_read_frames_rejects_unreadable_file(tmp_path):
    with pytest.raises(ValueError):
        list(read_frames(tmp_path / "missing.mp4"))


def test_to_detections_keeps_only_ball_and_hoop():
    id2label = {0: "person", 1: "sports ball", 2: "hoop"}
    result = {
        "scores": torch.tensor([0.9, 0.8, 0.7]),
        "labels": torch.tensor([0, 1, 2]),
        "boxes": torch.tensor([[0.0, 0, 10, 10], [1.0, 2, 3, 4], [5.0, 6, 7, 8]]),
    }

    detections = to_detections(result, id2label)

    assert [(d.label, round(d.score, 2), d.box) for d in detections] == [
        ("ball", 0.8, (1.0, 2.0, 3.0, 4.0)),
        ("hoop", 0.7, (5.0, 6.0, 7.0, 8.0)),
    ]


class FakeDetector:
    def __init__(self):
        self.batch_sizes = []

    def detect(self, frames):
        self.batch_sizes.append(len(frames))
        return [[Detection("ball", 1.0, (0, 0, 1, 1))] for _ in frames]


def test_detect_video_batches_frames_and_keeps_indexes(tmp_path, monkeypatch):
    monkeypatch.setattr(detection, "BATCH_SIZE", 3)
    fake = FakeDetector()

    results = detect_video(write_video(tmp_path / "clip.avi", 7), fake)

    assert [index for index, _ in results] == list(range(7))
    assert fake.batch_sizes == [3, 3, 1]
    assert all(d[0].label == "ball" for _, d in results)
