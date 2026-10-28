"""Score shot finding and make/miss calls against hand-labeled sessions.

    python -m app.evaluate data/session2.mov data/session2_shots.txt [more video/labels pairs...]

Labels have one shot per line, "m:ss make" or "m:ss miss", at roughly when the ball was released.
Each video's detections are cached next to it as <video stem>_<model folder>.json, so re-scoring
after a rule change takes seconds instead of minutes.
"""

import json
import sys
from pathlib import Path

import cv2

from app.detection import DETECTOR_MODEL, Detection
from app.shots import Shot, find_shots

# The analyzer times a shot when the ball reaches the rim, usually 1 to 3 seconds after the labeled release.
MATCH_BEFORE = 3
MATCH_AFTER = 4


def clock(seconds: float) -> str:
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def read_labels(path) -> list[tuple[float, bool]]:
    """(seconds, made) per labeled shot."""
    labels = []
    for line in Path(path).read_text().splitlines():
        if line.strip():
            time, result = line.split()[:2]
            minutes, seconds = time.split(":")
            labels.append((int(minutes) * 60 + float(seconds), result == "make"))
    return labels


def cached_detections(video: Path) -> list[tuple[int, list[Detection]]]:
    cache = video.with_name(f"{video.stem}_{Path(DETECTOR_MODEL).name}.json")
    if not cache.exists():
        from app.detection import Detector, detect_video  # Imported here so cached runs don't load torch.

        frames = detect_video(video, Detector())
        cache.write_text(json.dumps([[i, [[d.label, d.score, d.box] for d in ds]] for i, ds in frames]))
    return [(i, [Detection(label, score, tuple(box)) for label, score, box in ds])
            for i, ds in json.loads(cache.read_text())]


def score(shots: list[Shot], labels: list[tuple[float, bool]], fps: float) -> dict:
    """Pair each found shot with the nearest unpaired label in its time window, then count."""
    paired: dict[int, Shot] = {}
    extra = []
    for shot in shots:
        t = shot.frame / fps
        candidates = [k for k, (lt, _) in enumerate(labels) if k not in paired and -MATCH_BEFORE <= t - lt <= MATCH_AFTER]
        if candidates:
            paired[min(candidates, key=lambda k: abs(t - labels[k][0]))] = shot
        else:
            extra.append(shot)
    problems = [f"{clock(lt)} {'make' if made else 'miss'} -> "
                + (f"called {'make' if paired[k].made else 'miss'} at {clock(paired[k].frame / fps)}" if k in paired else "not found")
                for k, (lt, made) in enumerate(labels) if k not in paired or paired[k].made != made]
    problems += [f"extra shot at {clock(s.frame / fps)} ({'make' if s.made else 'miss'})" for s in extra]
    return {
        "labeled": len(labels),
        "found": len(paired),
        "extra": len(extra),
        "right": sum(paired[k].made == made for k, (_, made) in enumerate(labels) if k in paired),
        "problems": problems,
    }


def main(args: list[str]) -> None:
    totals = {"labeled": 0, "found": 0, "extra": 0, "right": 0}
    for video, labels in zip(args[::2], args[1::2], strict=True):
        fps = cv2.VideoCapture(video).get(cv2.CAP_PROP_FPS)
        result = score(find_shots(cached_detections(Path(video)), fps), read_labels(labels), fps)
        print(f"{video}: found {result['found']}/{result['labeled']}, {result['extra']} extra, "
              f"make/miss right on {result['right']}/{result['labeled']}")
        for problem in result["problems"]:
            print(f"  {problem}")
        for key in totals:
            totals[key] += result[key]
    n = totals["labeled"]
    print(f"total: found {totals['found']}/{n} ({100 * totals['found'] / n:.0f}%), {totals['extra']} extra, "
          f"make/miss right on {totals['right']}/{n} ({100 * totals['right'] / n:.0f}%)")


if __name__ == "__main__":
    main(sys.argv[1:])
