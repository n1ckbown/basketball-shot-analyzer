"""Fine-tune RT-DETRv2 on the auto-labeled ball/hoop images.

Run from server/: python -m training.train
The best model (lowest validation loss) is saved to data/models/ball-hoop-v2; use it with
DETECTOR_MODEL=<that folder>.
"""

import json
import random
import time
from functools import partial
from pathlib import Path

import torch
from PIL import Image, ImageDraw
from torch.utils.data import DataLoader, Dataset
from transformers import AutoImageProcessor, AutoModelForObjectDetection

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
BASE_MODEL = "PekingU/rtdetr_v2_r18vd"
OUTPUT_DIR = DATA_DIR / "models" / "ball-hoop-v2"
# The first run (30 epochs) was best at epoch 3, then overfit the noisy labels.
EPOCHS = 10
BATCH_SIZE = 8
LEARNING_RATE = 5e-5
GRADIENT_CLIP = 0.1
VAL_FRACTION = 0.1
PREVIEW_COUNT = 30
PREVIEW_MIN_SCORE = 0.4


def split_ids(ids, val_fraction, seed=0) -> tuple[list, list]:
    shuffled = sorted(ids)
    random.Random(seed).shuffle(shuffled)
    val_count = max(1, round(len(shuffled) * val_fraction))
    return shuffled[val_count:], shuffled[:val_count]


def flip_annotations(annotations, image_width) -> list[dict]:
    """Mirror COCO boxes for a horizontally flipped image."""
    flipped = []
    for a in annotations:
        x, y, w, h = a["bbox"]
        flipped.append({**a, "bbox": [image_width - x - w, y, w, h]})
    return flipped


class CocoDetectionDataset(Dataset):
    def __init__(self, coco, image_ids, image_dir, augment):
        self.images = {i["id"]: i for i in coco["images"]}
        self.annotations = {}
        for a in coco["annotations"]:
            self.annotations.setdefault(a["image_id"], []).append(a)
        self.image_ids = image_ids
        self.image_dir = image_dir
        self.augment = augment

    def __len__(self):
        return len(self.image_ids)

    def __getitem__(self, index):
        info = self.images[self.image_ids[index]]
        image = Image.open(self.image_dir / info["file_name"]).convert("RGB")
        annotations = self.annotations.get(info["id"], [])
        if self.augment and random.random() < 0.5:
            image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            annotations = flip_annotations(annotations, image.width)
        return image, {"image_id": info["id"], "annotations": annotations}


# Module-level (not a closure) so Windows can pickle it into DataLoader worker processes.
def collate(processor, batch):
    images, targets = zip(*batch)
    return processor(images=list(images), annotations=list(targets), return_tensors="pt")


def run_epoch(model, loader, device, optimizer=None) -> float:
    model.train(optimizer is not None)
    total, batches = 0.0, 0
    for batch in loader:
        labels = [{k: v.to(device) for k, v in label.items()} for label in batch["labels"]]
        with torch.set_grad_enabled(optimizer is not None), torch.autocast(device, dtype=torch.bfloat16):
            loss = model(pixel_values=batch["pixel_values"].to(device), labels=labels).loss
        if optimizer is not None:
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), GRADIENT_CLIP)
            optimizer.step()
        total += loss.item()
        batches += 1
    return total / max(batches, 1)


@torch.inference_mode()
def save_previews(model, processor, coco, image_ids, image_dir, device, folder):
    folder.mkdir(parents=True, exist_ok=True)
    model.eval()
    images = {i["id"]: i for i in coco["images"]}
    for image_id in image_ids[:PREVIEW_COUNT]:
        image = Image.open(image_dir / images[image_id]["file_name"]).convert("RGB")
        inputs = processor(images=[image], return_tensors="pt").to(device)
        result = processor.post_process_object_detection(
            model(**inputs), threshold=PREVIEW_MIN_SCORE, target_sizes=[image.size[::-1]]
        )[0]
        draw = ImageDraw.Draw(image)
        for score, label, box in zip(result["scores"].tolist(), result["labels"].tolist(), result["boxes"].tolist()):
            name = model.config.id2label[label]
            draw.rectangle(box, outline="orange" if name == "ball" else "cyan", width=4)
            draw.text((box[0], box[1] - 12), f"{name} {score:.2f}", fill="yellow")
        image.save(folder / images[image_id]["file_name"])


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    coco = json.loads((DATA_DIR / "openimages" / "labels.json").read_text())
    image_dir = DATA_DIR / "openimages" / "images"
    train_ids, val_ids = split_ids([i["id"] for i in coco["images"]], VAL_FRACTION)
    print(f"{len(train_ids)} training images, {len(val_ids)} validation images, device {device}")

    id2label = {c["id"]: c["name"] for c in coco["categories"]}
    processor = AutoImageProcessor.from_pretrained(BASE_MODEL)
    model = AutoModelForObjectDetection.from_pretrained(
        BASE_MODEL, id2label=id2label, label2id={v: k for k, v in id2label.items()}, ignore_mismatched_sizes=True
    ).to(device)

    collate_batch = partial(collate, processor)
    train_loader = DataLoader(
        CocoDetectionDataset(coco, train_ids, image_dir, augment=True),
        batch_size=BATCH_SIZE,
        shuffle=True,
        collate_fn=collate_batch,
        num_workers=4,
        persistent_workers=True,
    )
    val_loader = DataLoader(
        CocoDetectionDataset(coco, val_ids, image_dir, augment=False),
        batch_size=BATCH_SIZE,
        collate_fn=collate_batch,
        num_workers=2,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=1e-4)

    best = float("inf")
    for epoch in range(1, EPOCHS + 1):
        started = time.time()
        train_loss = run_epoch(model, train_loader, device, optimizer)
        val_loss = run_epoch(model, val_loader, device)
        note = ""
        if val_loss < best:
            best = val_loss
            model.save_pretrained(OUTPUT_DIR)
            processor.save_pretrained(OUTPUT_DIR)
            note = " (best, saved)"
        minutes = (time.time() - started) / 60
        print(f"epoch {epoch}/{EPOCHS}: train {train_loss:.3f}, val {val_loss:.3f}, {minutes:.1f} min{note}", flush=True)

    best_model = AutoModelForObjectDetection.from_pretrained(OUTPUT_DIR).to(device)
    save_previews(best_model, processor, coco, val_ids, image_dir, device, OUTPUT_DIR / "previews")
    print(f"done; best val loss {best:.3f}; model and previews in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
