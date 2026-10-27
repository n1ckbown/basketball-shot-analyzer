"""Draw draft ball and hoop boxes on the collected images with Grounding DINO, saved as COCO JSON.

Run from server/: python -m training.autolabel
"""

import json
from pathlib import Path

import torch
from PIL import Image, ImageDraw
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "openimages"
LABELER_MODEL = "IDEA-Research/grounding-dino-base"  # Apache-2.0
# "rim" gives tight boxes on the ring and net; "hoop" often boxes the whole pole and backboard.
PROMPT = "basketball. basketball rim."
BOX_THRESHOLD = 0.35
TEXT_THRESHOLD = 0.25
# Batches of 4 overflowed 8 GB of GPU memory on large photos, and Windows then spills into much slower system RAM.
BATCH_SIZE = 1
PROGRESS_EVERY = 200
PREVIEW_COUNT = 40
CATEGORIES = [{"id": 0, "name": "ball"}, {"id": 1, "name": "hoop"}]
# Width/height ranges a real ball (round) or rim (round to wide ellipse) can have; tall boxes are usually people.
ASPECT_RANGES = {0: (0.6, 1.7), 1: (0.7, 5.0)}
MAX_AREA_FRACTION = 0.25


def category_for(text_label) -> int | None:
    # "basketball rim" also contains "basketball", so check for the rim first.
    if "rim" in text_label or "hoop" in text_label:
        return 1
    if "basketball" in text_label:
        return 0
    return None


def is_plausible(box, category_id, image_width, image_height) -> bool:
    """Reject boxes whose shape or size can't be a ball or rim (Grounding DINO often boxes players)."""
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    if width <= 0 or height <= 0 or width * height > MAX_AREA_FRACTION * image_width * image_height:
        return False
    low, high = ASPECT_RANGES[category_id]
    return low <= width / height <= high


def to_coco_annotation(box, category_id, image_id, annotation_id) -> dict:
    x1, y1, x2, y2 = box
    return {
        "id": annotation_id,
        "image_id": image_id,
        "category_id": category_id,
        "bbox": [x1, y1, x2 - x1, y2 - y1],
        "area": (x2 - x1) * (y2 - y1),
        "iscrowd": 0,
    }


def save_preview(image, annotations, path):
    image = image.copy()
    draw = ImageDraw.Draw(image)
    for a in annotations:
        x, y, w, h = a["bbox"]
        draw.rectangle([x, y, x + w, y + h], outline="orange" if a["category_id"] == 0 else "cyan", width=4)
    image.save(path)


@torch.inference_mode()
def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained(LABELER_MODEL)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(LABELER_MODEL).to(device).eval()
    paths = sorted((DATA_DIR / "images").glob("*.jpg"))
    previews = DATA_DIR / "previews_autolabel"
    previews.mkdir(exist_ok=True)

    coco = {"images": [], "annotations": [], "categories": CATEGORIES}
    for start in range(0, len(paths), BATCH_SIZE):
        batch = paths[start : start + BATCH_SIZE]
        images = []
        for path in batch:
            try:
                images.append(Image.open(path).convert("RGB"))
            except OSError as error:
                print(f"skip {path.name}: {error}")
        if not images:
            continue
        inputs = processor(images=images, text=[PROMPT] * len(images), return_tensors="pt").to(device)
        outputs = model(**inputs)
        results = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=BOX_THRESHOLD,
            text_threshold=TEXT_THRESHOLD,
            target_sizes=[image.size[::-1] for image in images],
        )
        for path, image, result in zip(batch, images, results):
            annotations = []
            for box, text in zip(result["boxes"].tolist(), result["text_labels"]):
                category = category_for(text)
                if category is not None and is_plausible(box, category, image.width, image.height):
                    annotations.append(to_coco_annotation(box, category, 0, 0))
            if not annotations:
                continue  # Nothing basketball-like found; leave the image out.
            image_id = len(coco["images"])
            coco["images"].append({"id": image_id, "file_name": path.name, "width": image.width, "height": image.height})
            for a in annotations:
                a.update(id=len(coco["annotations"]), image_id=image_id)
                coco["annotations"].append(a)
            if image_id < PREVIEW_COUNT:
                save_preview(image, annotations, previews / path.name)
        if start % PROGRESS_EVERY < BATCH_SIZE:
            print(f"labeled {start + len(batch)}/{len(paths)}, kept {len(coco['images'])}", flush=True)

    (DATA_DIR / "labels.json").write_text(json.dumps(coco))
    counts = {c["name"]: sum(a["category_id"] == c["id"] for a in coco["annotations"]) for c in CATEGORIES}
    print(f"kept {len(coco['images'])} of {len(paths)} images; boxes: {counts}")


if __name__ == "__main__":
    main()
