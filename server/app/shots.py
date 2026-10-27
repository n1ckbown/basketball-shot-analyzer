"""Find shot attempts and decide make or miss from per-frame ball and hoop detections.

Assumes a still camera (phone propped up), so the rim is located once for the whole video.
All distances are in rim widths/heights so the rules work at any zoom or distance.
"""

import statistics
import sys
from dataclasses import dataclass

import cv2

from app.detection import Detection, Detector, detect_video

# A ball near the rim: up to one rim width either side, from two rim heights above to half a height below its top.
NEAR_RIM_SIDE = 1.0
NEAR_RIM_ABOVE = 2.0
NEAR_RIM_BELOW = 0.5
# Real balls score about 0.75; a few fixed spots on the hoop are mistaken for a ball at just over 0.3.
BALL_MIN_SCORE = 0.4
# Frames near the rim with gaps shorter than this belong to the same attempt.
SAME_SHOT_SECONDS = 1.0
# A make starts with the ball in the top half of the rim (or above it), inside its edges;
# a ball that drops past the rim from outside them missed.
ENTRY_DEPTH = 0.5
ENTRY_HALF_WIDTH = 0.6
# Then the ball is seen just below the rim, close to its center, before it falls further.
# Misses that drop off the front rim fall about half a rim width from the center; makes mostly stay within 0.4.
# shortcut: these numbers were tuned on one 9-minute side-view video (33 of 35 shots right); retune once
# there are more labeled sessions, especially from other camera angles.
MAKE_ZONE_DEPTH = 2.0
MAKE_ZONE_HALF_WIDTH = 0.4
MAKE_MIN_FRAMES = 2
MAKE_WAIT_SECONDS = 1.0


@dataclass(frozen=True)
class Shot:
    frame: int  # first frame with the ball at the rim
    made: bool  # a miss followed by a put-back within a second counts as one made shot


def center(box) -> tuple[float, float]:
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


def locate_rim(frames) -> tuple[float, float, float, float] | None:
    """The rim box, from all frames: the hoop's usual position, then the wide (rim-shaped) boxes around it.

    Hoop detections include the backboard and, now and then, look-alikes such as floodlights,
    so the per-frame best box is only used to find where the hoop usually is.
    """
    best = [max((d for d in ds if d.label == "hoop"), key=lambda d: d.score).box
            for _, ds in frames if any(d.label == "hoop" for d in ds)]
    if not best:
        return None
    anchor = [statistics.median(b[k] for b in best) for k in range(4)]
    width, height = anchor[2] - anchor[0], anchor[3] - anchor[1]
    rims = []
    for _, ds in frames:
        for d in ds:
            x, y = center(d.box)
            wide = d.box[2] - d.box[0] >= d.box[3] - d.box[1]
            if d.label == "hoop" and wide and anchor[0] - width < x < anchor[2] + width and anchor[1] - height < y < anchor[3] + height:
                rims.append(d.box)
    boxes = rims or best
    return tuple(statistics.median(b[k] for b in boxes) for k in range(4))


def ball_positions(frames, rim) -> dict[int, tuple[float, float]]:
    """Center of the best ball per frame, skipping boxes wider than the rim (a ball right next to the camera, hands)."""
    rim_width = rim[2] - rim[0]
    positions = {}
    for index, ds in frames:
        balls = [d for d in ds if d.label == "ball" and d.score >= BALL_MIN_SCORE and d.box[2] - d.box[0] <= rim_width]
        if balls:
            positions[index] = center(max(balls, key=lambda d: d.score).box)
    return positions


def find_shots(frames: list[tuple[int, list[Detection]]], fps: float) -> list[Shot]:
    rim = locate_rim(frames)
    if rim is None:
        return []
    x1, y1, x2, y2 = rim
    width, height = x2 - x1, y2 - y1
    rim_x = (x1 + x2) / 2
    balls = ball_positions(frames, rim)

    near = [i for i, (x, y) in sorted(balls.items())
            if x1 - NEAR_RIM_SIDE * width < x < x2 + NEAR_RIM_SIDE * width
            and y1 - NEAR_RIM_ABOVE * height < y < y1 + NEAR_RIM_BELOW * height]
    attempts = []
    for i in near:
        if attempts and i - attempts[-1][-1] <= SAME_SHOT_SECONDS * fps:
            attempts[-1].append(i)
        else:
            attempts.append([i])

    shots = []
    for attempt in attempts:
        start, end = attempt[0], round(attempt[-1] + MAKE_WAIT_SECONDS * fps)
        entered, in_make_zone = False, 0
        for i in range(start, end + 1):
            if i not in balls:
                continue
            x, y = balls[i]
            off_center = abs(x - rim_x) / width
            if y < y1 + ENTRY_DEPTH * height and off_center < ENTRY_HALF_WIDTH:
                entered = True
            elif entered and y > y2 + MAKE_ZONE_DEPTH * height:
                if in_make_zone >= MAKE_MIN_FRAMES:
                    break
                # A missed drop. Later frames only count if the ball goes back up into the rim (a put-back),
                # so a bounce off the ground under the rim is not a make.
                entered, in_make_zone = False, 0
            elif entered and y > y2:
                in_make_zone += off_center < MAKE_ZONE_HALF_WIDTH
        shots.append(Shot(start, in_make_zone >= MAKE_MIN_FRAMES))
    return shots


def analyze_video(path, detector) -> dict:
    """Shots in a video file as JSON-ready data: totals, then the time in seconds and make or miss of each shot."""
    fps = cv2.VideoCapture(str(path)).get(cv2.CAP_PROP_FPS)
    shots = find_shots(detect_video(path, detector), fps)
    return {
        "attempts": len(shots),
        "makes": sum(s.made for s in shots),
        "shots": [{"time": round(s.frame / fps, 1), "made": s.made} for s in shots],
    }


if __name__ == "__main__":
    # Manual check on a real video: python -m app.shots path/to/video.mov
    result = analyze_video(sys.argv[1], Detector())
    for shot in result["shots"]:
        minutes, seconds = divmod(shot["time"], 60)
        print(f"{int(minutes)}:{seconds:04.1f} {'make' if shot['made'] else 'miss'}")
    print(f"{result['makes']} of {result['attempts']} made")
