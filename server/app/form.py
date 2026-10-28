"""Shot form from body pose: find each release, then measure the knees, elbow, timing and follow-through.

Needs the whole body in the picture from the side; the hoop doesn't have to be in view.
"""

import sys
from dataclasses import dataclass

import cv2
import numpy as np
import torch
from transformers import AutoImageProcessor, AutoModelForObjectDetection, VitPoseForPoseEstimation

from app.detection import Detector, detect_video
from app.shots import BALL_MIN_SCORE

# Both Apache-2.0. The ball comes from our ball/hoop model: the COCO model's "sports ball" found the release
# of only 15 of 35 shots on the side-view session, against 32 with ours.
PERSON_MODEL = "PekingU/rtdetr_v2_r18vd"
POSE_MODEL = "usyd-community/vitpose-base-simple"
PERSON_MIN_SCORE = 0.5
CROP_MARGIN = 0.25  # of the person box, so raised arms stay in the crop

# COCO keypoint order.
NOSE, SHOULDERS, ELBOWS, WRISTS, HIPS, KNEES, ANKLES = 0, (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)

# Distances are in torso lengths (shoulders to hips), so they hold at any zoom.
# Release: the ball is in a hand raised above the head, and 0.3 s later it is over a torso length away and higher.
IN_HAND = 0.6
LEFT_HAND = 1.0
RELEASE_WINDOW_SECONDS = 0.3
SAME_SHOT_SECONDS = 1.5
DIP_SECONDS = 1.0  # the knee bend is the deepest point in this long before release
JUMP_SECONDS = 0.7  # the jump's peak is looked for this long either side of release
JUMP_MIN_RISE = 0.08  # feet rising less than this didn't leave the ground
AT_THE_TOP_SECONDS = 0.07  # releases this close to the jump's peak count as at the top
# Frames whose torso differs in size from the release frame's by more than this show someone (or something) else.
SAME_BODY = 0.25
# Hip to ankle is over half a torso length even in a deep bend; shorter means the legs are out of the picture.
MIN_LEG = 0.6


@dataclass(frozen=True)
class Pose:
    keypoints: np.ndarray  # (17, 2) image coordinates
    ball: tuple[float, float] | None  # center of the most confident ball, if any


class PoseTracker:
    """The main person's body keypoints and the ball, per frame."""

    def __init__(self, balls: Detector | None = None):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.person_processor = AutoImageProcessor.from_pretrained(PERSON_MODEL)
        self.person_model = AutoModelForObjectDetection.from_pretrained(PERSON_MODEL).to(self.device).eval()
        labels = self.person_model.config.id2label
        self.person_id = next(k for k, v in labels.items() if v == "person")
        self.balls = balls or Detector()
        self.pose_processor = AutoImageProcessor.from_pretrained(POSE_MODEL)
        self.pose_model = VitPoseForPoseEstimation.from_pretrained(POSE_MODEL).to(self.device).eval()

    @torch.inference_mode()
    def detect(self, frames: list[np.ndarray]) -> list[Pose | None]:
        images = [torch.from_numpy(frame).to(self.device).permute(2, 0, 1) for frame in frames]
        inputs = self.person_processor(images=images, return_tensors="pt", device=self.device).to(self.device)
        results = self.person_processor.post_process_object_detection(
            self.person_model(**inputs), threshold=PERSON_MIN_SCORE, target_sizes=[frame.shape[:2] for frame in frames])
        crops, crop_boxes, origins, balls, found = [], [], [], [], []
        for frame, result, detections in zip(frames, results, self.balls.detect(frames)):
            people = [box for label, box in zip(result["labels"].tolist(), result["boxes"].tolist()) if label == self.person_id]
            ball = max((d for d in detections if d.label == "ball" and d.score >= BALL_MIN_SCORE), key=lambda d: d.score,
                       default=None)
            balls.append(None if ball is None else ((ball.box[0] + ball.box[2]) / 2, (ball.box[1] + ball.box[3]) / 2))
            found.append(bool(people))
            if not people:
                continue
            # The biggest person: in a form video the shooter is the main subject.
            x1, y1, x2, y2 = max(people, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
            w, h = x2 - x1, y2 - y1
            # Pose prep is quicker on a crop around the person than on the whole frame (same keypoints to 2 px).
            cx1, cy1 = int(max(0, x1 - CROP_MARGIN * w)), int(max(0, y1 - CROP_MARGIN * h))
            cx2, cy2 = int(min(frame.shape[1], x2 + CROP_MARGIN * w)), int(min(frame.shape[0], y2 + CROP_MARGIN * h))
            crops.append(np.ascontiguousarray(frame[cy1:cy2, cx1:cx2]))
            crop_boxes.append([[x1 - cx1, y1 - cy1, w, h]])
            origins.append((cx1, cy1))
        poses = []
        if crops:
            pose_inputs = self.pose_processor(crops, boxes=crop_boxes, return_tensors="pt").to(self.device)
            estimates = self.pose_processor.post_process_pose_estimation(self.pose_model(**pose_inputs), boxes=crop_boxes)
            poses = [estimate[0]["keypoints"].cpu().numpy() + origin for estimate, origin in zip(estimates, origins)]
        poses_iter = iter(poses)
        return [Pose(next(poses_iter), ball) if has_person else None for has_person, ball in zip(found, balls)]


def angle(a, b, c) -> float:
    """The angle at b, in degrees, between b->a and b->c."""
    v1, v2 = np.asarray(a) - b, np.asarray(c) - b
    cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cos, -1, 1))))


def torso(kp) -> float:
    return float(np.linalg.norm(kp[list(SHOULDERS)].mean(0) - kp[list(HIPS)].mean(0)))


def shooting_side(kp) -> int:
    """0 or 1: the side whose wrist is higher. Pose models often swap left and right in a side view."""
    return int(kp[WRISTS[1], 1] < kp[WRISTS[0], 1])


@dataclass(frozen=True)
class FormShot:
    frame: int  # release
    knee_bend: float | None  # smallest knee angle in the dip before release, degrees (180 = straight)
    elbow_at_release: float  # shooting elbow angle at release, degrees (180 = straight)
    release_timing: str | None  # "rising", "at the top" or "falling", relative to the jump; None for a set shot
    follow_through: float  # seconds the shooting hand stayed above the head after release


def find_releases(poses: dict[int, Pose], fps: float) -> list[int]:
    """Frames where the ball leaves a raised hand going up."""
    releases = []
    for i in sorted(poses):
        pose = poses[i]
        if pose.ball is None:
            continue
        kp, size = pose.keypoints, torso(pose.keypoints)
        wrist = kp[WRISTS[shooting_side(kp)]]
        if wrist[1] > kp[NOSE, 1] or np.linalg.norm(np.subtract(pose.ball, wrist)) > IN_HAND * size:
            continue
        later = [poses[j] for j in range(i + 1, round(i + RELEASE_WINDOW_SECONDS * fps) + 1)
                 if j in poses and poses[j].ball is not None]
        if any(np.linalg.norm(np.subtract(p.ball, wrist)) > LEFT_HAND * size and p.ball[1] < pose.ball[1] for p in later):
            if releases and i - releases[-1] < SAME_SHOT_SECONDS * fps:
                releases[-1] = i  # the last frame the ball was still in hand
            else:
                releases.append(i)
    return releases


def measure(release: int, poses: dict[int, Pose], fps: float) -> FormShot:
    kp = poses[release].keypoints
    size = torso(kp)
    poses = {i: p for i, p in poses.items() if abs(torso(p.keypoints) / size - 1) <= SAME_BODY}
    side = shooting_side(kp)
    elbow = angle(kp[SHOULDERS[side]], kp[ELBOWS[side]], kp[WRISTS[side]])

    # The dip: both knees bent at once. A single bent knee is a step into the shot, not the shot's leg drive.
    dip = [p for p in (poses[i].keypoints for i in range(round(release - DIP_SECONDS * fps), release + 1) if i in poses)
           if all(np.linalg.norm(p[HIPS[s]] - p[ANKLES[s]]) >= MIN_LEG * size for s in (0, 1))]
    knee_bend = min((max(angle(p[HIPS[s]], p[KNEES[s]], p[ANKLES[s]]) for s in (0, 1)) for p in dip), default=None)

    # A jump is the feet leaving the ground; its peak is where the hips are highest (feet tuck up after the body peaks).
    around = [(i, poses[i].keypoints) for i in range(round(release - JUMP_SECONDS * fps), round(release + JUMP_SECONDS * fps) + 1)
              if i in poses]
    timing = None
    if around:
        feet = [p[list(ANKLES), 1].mean() for _, p in around]
        if (max(feet) - min(feet)) / size >= JUMP_MIN_RISE:
            peak = min(around, key=lambda f: f[1][list(HIPS), 1].mean())[0]
            offset = (release - peak) / fps
            timing = "at the top" if abs(offset) <= AT_THE_TOP_SECONDS else "rising" if offset < 0 else "falling"

    hold = 0
    for i in range(release + 1, release + round(3 * fps)):
        if i not in poses:
            continue
        p = poses[i].keypoints
        if p[WRISTS[shooting_side(p)], 1] > p[NOSE, 1]:
            break
        hold = i - release
    return FormShot(release, None if knee_bend is None else round(knee_bend), round(elbow), timing, round(hold / fps, 1))


def analyze_form(path, tracker, on_progress=None) -> dict:
    """Form of each shot in a video as JSON-ready data."""
    fps = cv2.VideoCapture(str(path)).get(cv2.CAP_PROP_FPS)
    frames = detect_video(path, tracker, on_progress=on_progress)
    poses = {i: pose for i, pose in frames if pose is not None}
    shots = [measure(release, poses, fps) for release in find_releases(poses, fps)]
    return {
        "attempts": len(shots),
        "duration": round(len(frames) / fps, 1),
        "shots": [{"time": round(s.frame / fps, 1), "knee_bend": s.knee_bend, "elbow_at_release": s.elbow_at_release,
                   "release_timing": s.release_timing, "follow_through": s.follow_through} for s in shots],
    }


if __name__ == "__main__":
    # Manual check on a real video: python -m app.form path/to/video.mov
    for shot in analyze_form(sys.argv[1], PoseTracker())["shots"]:
        minutes, seconds = divmod(shot["time"], 60)
        print(f"{int(minutes)}:{seconds:04.1f} knees {shot['knee_bend']}°, elbow {shot['elbow_at_release']}°, "
              f"{shot['release_timing'] or 'no jump'}, follow-through {shot['follow_through']} s")
