"""Download Open Images photos tagged with basketball things, keeping only CC BY 2.0 images and their credits.

Needs data/openimages/imagelabels.csv and images.csv (see README). Run from server/: python -m training.collect
"""

import csv
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "openimages"
# Human-verified Open Images image-level tags.
LABELS = {
    "/m/0frqg3": "Basketball (Ball)",
    "/m/0h8jh3r": "Basketball hoop",
    "/m/0h8n450": "Basketball Rim",
    "/m/0329yh": "Basketball court",
    "/m/018w8": "Basketball (Sport)",
    "/m/0ch1v_m": "3x3 basketball",
    "/m/012xhn": "Slam dunk",
}
# CC BY 2.0 allows commercial use with credit; credits are written to attribution.csv.
ALLOWED_LICENSES = {"https://creativecommons.org/licenses/by/2.0/"}
IMAGE_URL = "https://open-images-dataset.s3.amazonaws.com/train/{}.jpg"
DOWNLOAD_THREADS = 16
DOWNLOAD_TIMEOUT_SECONDS = 30


def tagged_image_ids(label_rows) -> set[str]:
    # Confidence is written as both "1" and "1.0" in the file.
    return {r["ImageID"] for r in label_rows if r["LabelName"] in LABELS and float(r["Confidence"]) == 1}


def licensed_images(image_rows, image_ids) -> list[dict]:
    return [r for r in image_rows if r["ImageID"] in image_ids and r["License"] in ALLOWED_LICENSES]


def download(row, folder) -> bool:
    """Fetch from Google's mirror, falling back to the Flickr thumbnail; the mirror only hosts part of the set."""
    destination = folder / f"{row['ImageID']}.jpg"
    if destination.exists():
        return True
    partial = destination.with_suffix(".part")
    for url in (IMAGE_URL.format(row["ImageID"]), row.get("Thumbnail300KURL")):
        if not url:
            continue
        try:
            with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
                partial.write_bytes(response.read())
            partial.replace(destination)
            return True
        except OSError:
            partial.unlink(missing_ok=True)
    print(f"skip {row['ImageID']}: not available")
    return False


def main():
    with open(DATA_DIR / "imagelabels.csv", newline="", encoding="utf-8") as f:
        ids = tagged_image_ids(csv.DictReader(f))
    print(f"{len(ids)} images tagged with basketball labels")
    with open(DATA_DIR / "images.csv", newline="", encoding="utf-8") as f:
        images = licensed_images(csv.DictReader(f), ids)
    print(f"{len(images)} of them are CC BY 2.0")

    with open(DATA_DIR / "attribution.csv", "w", newline="", encoding="utf-8") as f:
        fields = ["ImageID", "OriginalLandingURL", "Author", "AuthorProfileURL", "License", "Title"]
        writer = csv.DictWriter(f, fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(images)

    folder = DATA_DIR / "images"
    folder.mkdir(exist_ok=True)
    with ThreadPoolExecutor(DOWNLOAD_THREADS) as pool:
        done = 0
        for ok in pool.map(lambda row: download(row, folder), images):
            done += ok
            if done % 500 == 0:
                print(f"downloaded {done}/{len(images)}", flush=True)
    print(f"downloaded {done}/{len(images)} images to {folder}")


if __name__ == "__main__":
    main()
