"""Find shot attempts and decide make or miss from per-frame ball and hoop detections.

Assumes a still camera (phone propped up), so the rim is located once for the whole video.
All distances are in rim widths/heights so the rules work at any zoom or distance.
"""

import statistics
import sys
from dataclasses import dataclass

import cv2
import numpy as np

from app.detection import Detection, Detector, detect_video

# A ball near the rim: up to one rim width either side, from two rim heights above to half a height below its top.
NEAR_RIM_SIDE = 1.0
NEAR_RIM_ABOVE = 2.0
NEAR_RIM_BELOW = 0.5
# Real balls score about 0.75; a few fixed spots on the hoop are mistaken for a ball at just over 0.3.
BALL_MIN_SCORE = 0.4
# Frames near the rim with gaps shorter than this belong to the same attempt. A high bounce off the rim
# can leave the picture for over a second when the rim is near the top of the frame.
SAME_SHOT_SECONDS = 1.5
# A make starts with the ball in the top half of the rim (or above it), inside its edges;
# a ball that drops past the rim from outside them missed.
ENTRY_DEPTH = 0.5
ENTRY_HALF_WIDTH = 0.6
# Then the ball is seen just below the rim, close to its center, before it falls further.
# Misses that drop off the front rim fall about half a rim width from the center; makes mostly stay within 0.4.
# shortcut: these numbers were tuned on a 9-minute side-view video (33 of 35 right) and checked on a 4-minute
# ground-level session (21 of 22 right); retune once there are more labeled sessions and camera angles.
MAKE_ZONE_DEPTH = 2.0
MAKE_ZONE_HALF_WIDTH = 0.4
MAKE_MIN_FRAMES = 2
MAKE_WAIT_SECONDS = 1.0

# Arc: how high the ball rose above the rim, with gravity as the ruler (the curve of a free flight gives meters
# per pixel at any camera angle). On the side-view session this agreed with the ball's own size to about 10%,
# while the rim's size was off by 1.7x because the shooter and the hoop were at different distances.
GRAVITY = 9.81  # m/s^2
BALL_DIAMETER_M = 0.239  # men's size 7
FEET_PER_METER = 3.281
ARC_MIN_SECONDS = 0.5  # of clean flight before the rim
ARC_FIT_TOLERANCE = 0.15  # rim widths a free flight may stray from its parabola
# Gravity's scale over the ball's: detection boxes run about 10% larger than the ball. Outside this range the
# path wasn't a free flight (a lay-up, a tip-in, two balls mixed up), so no arc is given.
ARC_SCALE_AGREEMENT = (0.8, 1.4)


@dataclass(frozen=True)
class Shot:
    frame: int  # first frame with the ball at the rim
    made: bool  # a miss followed by a put-back within 1.5 seconds counts as one made shot
    arc_ft: float | None = None  # how high the ball rose above the rim; None when the top of the flight wasn't seen


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


def ball_positions(frames, rim) -> dict[int, tuple[float, float, float]]:
    """Center and width of the best ball per frame, skipping boxes wider than the rim (a ball right next to the
    camera, hands)."""
    rim_width = rim[2] - rim[0]
    positions = {}
    for index, ds in frames:
        balls = [d for d in ds if d.label == "ball" and d.score >= BALL_MIN_SCORE and d.box[2] - d.box[0] <= rim_width]
        if balls:
            box = max(balls, key=lambda d: d.score).box
            positions[index] = (*center(box), box[2] - box[0])
    return positions


def arc_height(start: int, balls, rim, fps: float) -> float | None:
    """Feet the ball rose above the rim in the flight that reached it at frame `start`, or None if unclear."""
    rim_width = rim[2] - rim[0]
    flight = [(i / fps, balls[i]) for i in range(round(start - 2 * fps), start + 1) if i in balls]
    # Grow the flight back from the rim for as long as it stays one clean parabola (gravity pulls image y down).
    best = None
    for first in range(len(flight) - 6, -1, -1):
        t = np.array([time for time, _ in flight[first:]])
        y = np.array([ball[1] for _, ball in flight[first:]])
        a, b, c = np.polyfit(t, y, 2)
        if a <= 0 or np.abs(np.polyval((a, b, c), t) - y).max() > ARC_FIT_TOLERANCE * rim_width:
            break
        best = flight[first:], (a, b, c)
    if best is None:
        return None
    points, (a, b, c) = best
    apex_time = -b / (2 * a)
    # The top must be seen, with a few points on each side of it, not guessed from a rising or falling part alone.
    if points[-1][0] - points[0][0] < ARC_MIN_SECONDS or not points[2][0] < apex_time < points[-3][0]:
        return None
    meters_per_pixel = GRAVITY / (2 * a)
    by_ball_size = BALL_DIAMETER_M / float(np.median([ball[2] for _, ball in points]))
    if not ARC_SCALE_AGREEMENT[0] < meters_per_pixel / by_ball_size < ARC_SCALE_AGREEMENT[1]:
        return None
    apex_y = c - b * b / (4 * a)
    arc = (rim[1] - apex_y) * meters_per_pixel * FEET_PER_METER
    return round(arc, 1) if arc > 0 else None


def find_shots(frames: list[tuple[int, list[Detection]]], fps: float) -> list[Shot]:
    rim = locate_rim(frames)
    if rim is None:
        return []
    x1, y1, x2, y2 = rim
    width, height = x2 - x1, y2 - y1
    rim_x = (x1 + x2) / 2
    balls = ball_positions(frames, rim)

    near = [i for i, (x, y, _) in sorted(balls.items())
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
            x, y, _ = balls[i]
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
        shots.append(Shot(start, in_make_zone >= MAKE_MIN_FRAMES, arc_height(start, balls, rim, fps)))
    return shots


# Setup check on one photo before recording.
# shortcut: from two sessions only (a rim 1.5 rim heights from the top of the picture double-counted a high
# bounce, 3.9 was fine; rims 5.7% and 6.9% of the picture width both tracked well); revisit with more sessions.
SETUP_MIN_ROOM_ABOVE = 2.5  # rim heights between the top of the picture and the rim
SETUP_MIN_RIM_WIDTH = 0.04  # fraction of the picture width
# In a single photo the rim box is sometimes missing, or merged with the backboard into a square box;
# rim boxes are clearly wider than tall (1.16 to 1.42 in both sessions).
SETUP_RIM_MIN_ASPECT = 1.1


def check_setup(detections: list[Detection], width: int) -> dict:
    """Whether a photo from the phone shows the hoop, with space above the rim, big enough to track.

    room_above and close_enough are None when the hoop is seen but no clearly rim-shaped box is.
    """
    hoops = [d for d in detections if d.label == "hoop"]
    if not hoops:
        return {"hoop": False, "room_above": False, "close_enough": False}
    # Near the most confident hoop box, so a look-alike elsewhere in the picture isn't taken for the rim.
    ax1, ay1, ax2, ay2 = max(hoops, key=lambda d: d.score).box
    aw, ah = ax2 - ax1, ay2 - ay1
    rims = [d for d in hoops
            if d.box[2] - d.box[0] >= SETUP_RIM_MIN_ASPECT * (d.box[3] - d.box[1])
            and ax1 - aw < center(d.box)[0] < ax2 + aw and ay1 - ah < center(d.box)[1] < ay2 + ah]
    if not rims:
        return {"hoop": True, "room_above": None, "close_enough": None}
    x1, y1, x2, y2 = max(rims, key=lambda d: d.score).box
    return {
        "hoop": True,
        "room_above": y1 >= SETUP_MIN_ROOM_ABOVE * (y2 - y1),
        "close_enough": x2 - x1 >= SETUP_MIN_RIM_WIDTH * width,
    }


def analyze_video(path, detector, on_progress=None) -> dict:
    """Shots in a video file as JSON-ready data: totals, the video length, then the time and result of each shot."""
    fps = cv2.VideoCapture(str(path)).get(cv2.CAP_PROP_FPS)
    frames = detect_video(path, detector, on_progress=on_progress)
    shots = find_shots(frames, fps)
    return {
        "attempts": len(shots),
        "makes": sum(s.made for s in shots),
        "duration": round(len(frames) / fps, 1),
        "shots": [{"time": round(s.frame / fps, 1), "made": s.made, "arc_ft": s.arc_ft} for s in shots],
    }


if __name__ == "__main__":
    # Manual check on a real video: python -m app.shots path/to/video.mov
    result = analyze_video(sys.argv[1], Detector())
    for shot in result["shots"]:
        minutes, seconds = divmod(shot["time"], 60)
        print(f"{int(minutes)}:{seconds:04.1f} {'make' if shot['made'] else 'miss'}")
    print(f"{result['makes']} of {result['attempts']} made")
